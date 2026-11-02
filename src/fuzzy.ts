import type { SchemaField } from "./types.js";

/** Auto-map and suggest accept matches at or above this score. */
export const AUTO_MATCH_THRESHOLD = 0.86;

/** Fuzzy matches below this score produce a low_confidence warning. */
export const LOW_CONFIDENCE_BELOW = 0.92;

const GENERIC_TAIL = new Set(["name", "address", "number", "no", "id", "code", "line", "value", "text"]);

export interface HeaderScore {
  score: number;
  /** "none" means the score is below the auto-match threshold. The numeric score is still set. */
  method: "exact" | "synonym" | "fuzzy" | "none";
}

export function roundScore(score: number): number {
  return Math.round(score * 10000) / 10000;
}

/** Lowercase, strip accents and punctuation, collapse separators to single spaces. */
export function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[_\-./\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Optimal string alignment (adjacent transpositions count as one edit).
 * Enough for header typos such as "Frist" / "first".
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const dp: number[][] = Array.from({ length: aLen + 1 }, () => new Array<number>(bLen + 1).fill(0));
  for (let i = 0; i <= aLen; i++) dp[i]![0] = i;
  for (let j = 0; j <= bLen; j++) dp[0]![j] = j;

  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const row = dp[i]!;
      const prev = dp[i - 1]!;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j]!, dp[i - 2]![j - 2]! + 1);
      }
    }
  }
  return dp[aLen]![bLen]!;
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - damerauLevenshtein(a, b) / maxLen;
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function sameTokenSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const token of left) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const token of right) {
    const n = counts.get(token);
    if (!n) return false;
    if (n === 1) counts.delete(token);
    else counts.set(token, n - 1);
  }
  return counts.size === 0;
}

function fuzzyScore(source: string, label: string): number {
  if (!label) return 0;
  let best = 0;
  const sourceTokens = source.split(" ");
  const labelTokens = label.split(" ");
  if (sameTokenSet(sourceTokens, labelTokens)) best = Math.max(best, 0.99);

  const distance = damerauLevenshtein(source, label);
  const sim = 1 - distance / Math.max(source.length, label.length);
  best = Math.max(best, sim);
  if (distance === 1 && Math.min(source.length, label.length) >= 4) {
    best = Math.max(best, 0.9);
  }

  // "City Name" vs "city": the extra token is a generic suffix, not "Email Marketing" vs "email".
  if (
    sourceTokens.length === labelTokens.length + 1 &&
    labelTokens.every((token, index) => sourceTokens[index] === token) &&
    GENERIC_TAIL.has(sourceTokens[sourceTokens.length - 1] ?? "") &&
    label.replace(/ /g, "").length >= 3
  ) {
    best = Math.max(best, 0.93);
  }
  return best;
}

export function scoreHeader(source: string, field: SchemaField): HeaderScore {
  const normalized = normalize(source);
  if (!normalized) return { score: 0, method: "none" };

  const identity = unique([field.id, field.header, field.label].map((value) => normalize(value)));
  const synonyms = unique(field.synonyms.map((value) => normalize(value))).filter((value) => !identity.includes(value));

  if (identity.includes(normalized)) return { score: 1, method: "exact" };
  if (synonyms.includes(normalized)) return { score: 1, method: "synonym" };

  let best = 0;
  for (const label of [...identity, ...synonyms]) {
    best = Math.max(best, fuzzyScore(normalized, label));
  }
  const score = roundScore(best);
  if (score >= AUTO_MATCH_THRESHOLD) return { score, method: "fuzzy" };
  return { score, method: "none" };
}

export interface RankedHeader {
  header: string;
  index: number;
  score: number;
  method: HeaderScore["method"];
}

export function rankHeaders(field: SchemaField, headers: string[]): RankedHeader[] {
  return headers
    .map((header, index) => {
      const scored = scoreHeader(header, field);
      return { header, index, score: scored.score, method: scored.method };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

export interface AutoAssignment {
  fieldIndex: number;
  sourceIndex: number;
  score: number;
  method: "exact" | "synonym" | "fuzzy";
}

/** Greedy one-to-one assignment, highest score first. Ties prefer earlier target fields. */
export function autoAssign(
  headers: string[],
  fields: SchemaField[],
  usedSources: Set<number>,
  usedTargets: Set<string>,
): AutoAssignment[] {
  const candidates: AutoAssignment[] = [];
  fields.forEach((field, fieldIndex) => {
    if (usedTargets.has(field.id)) return;
    headers.forEach((header, sourceIndex) => {
      if (usedSources.has(sourceIndex)) return;
      const scored = scoreHeader(header, field);
      if (scored.method === "none" || scored.score < AUTO_MATCH_THRESHOLD) return;
      candidates.push({
        fieldIndex,
        sourceIndex,
        score: scored.score,
        method: scored.method,
      });
    });
  });

  candidates.sort((a, b) => b.score - a.score || a.fieldIndex - b.fieldIndex || a.sourceIndex - b.sourceIndex);
  const assigned: AutoAssignment[] = [];
  for (const candidate of candidates) {
    const field = fields[candidate.fieldIndex];
    if (!field || usedTargets.has(field.id) || usedSources.has(candidate.sourceIndex)) continue;
    usedTargets.add(field.id);
    usedSources.add(candidate.sourceIndex);
    assigned.push(candidate);
  }
  return assigned;
}
