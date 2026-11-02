import { CliError } from "./errors.js";
import { normalize } from "./fuzzy.js";

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
  /** 1-based data rows that had extra non-empty cells beyond the header. */
  extraValueRows: number[];
}

const DETECT_CANDIDATES = [",", ";", "\t", "|"] as const;

export function detectDelimiter(text: string): string {
  const sample = text.replace(/^\uFEFF/, "");
  let best: string = ",";
  let bestN = countTopLevel(sample, ",");
  for (const candidate of DETECT_CANDIDATES.slice(1)) {
    const n = countTopLevel(sample, candidate);
    if (n > bestN) {
      best = candidate;
      bestN = n;
    }
  }
  return best;
}

function countTopLevel(text: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (c === "\n" || c === "\r")) break;
    if (!inQuotes && c === delimiter) count++;
  }
  return count;
}

/**
 * RFC 4180-style parser. A quote opens a field only when it is the first
 * character of that field. Doubled quotes inside a quoted field are a literal quote.
 */
export function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      if (field.length === 0) {
        inQuotes = true;
        continue;
      }
      field += c;
      continue;
    }
    if (c === delimiter) {
      record.push(field);
      field = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      records.push(record);
      record = [];
      continue;
    }
    field += c;
  }

  if (inQuotes) {
    throw new CliError("CSV has an unclosed double quote");
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const cleaned = text.replace(/^\uFEFF/, "");
  if (cleaned.trim() === "") {
    throw new CliError("CSV is empty");
  }
  const delim = delimiter ?? detectDelimiter(cleaned);
  if (delim.length !== 1) {
    throw new CliError("Delimiter must be a single character");
  }
  const records = parseRecords(cleaned, delim);
  if (records.length === 0) {
    throw new CliError("CSV has no header row");
  }

  const headers = records[0]!.map((header) => header.trim());
  if (headers.every((header) => header === "")) {
    throw new CliError("CSV has no header row");
  }
  for (const header of headers) {
    if (header === "") {
      throw new CliError("CSV header has an empty column name");
    }
  }
  const seen = new Map<string, string>();
  for (const header of headers) {
    const key = normalize(header);
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new CliError(`Duplicate CSV header "${header}" (conflicts with "${previous}")`);
    }
    seen.set(key, header);
  }

  const rows: string[][] = [];
  const extraValueRows: number[] = [];
  for (const record of records.slice(1)) {
    if (record.every((cell) => cell.trim() === "")) continue;
    const rowNumber = rows.length + 1;
    if (record.length > headers.length && record.slice(headers.length).some((cell) => cell.trim() !== "")) {
      extraValueRows.push(rowNumber);
    }
    const width = headers.length;
    const out = record.slice(0, width);
    while (out.length < width) out.push("");
    rows.push(out);
  }

  return { headers, rows, delimiter: delim, extraValueRows };
}

export function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Write a comma-separated CSV with `\n` line endings and a trailing newline. */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((record) => record.map((cell) => escapeCell(cell)).join(","));
  return `${lines.join("\n")}\n`;
}
