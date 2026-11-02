import { CliError } from "./errors.js";

export const TRANSFORM_NAMES = ["trim", "lower", "upper", "phone_e164_loose", "date_iso_loose"] as const;

export type TransformName = (typeof TRANSFORM_NAMES)[number];

const TRANSFORM_SET = new Set<string>(TRANSFORM_NAMES);

export function isTransformName(value: string): value is TransformName {
  return TRANSFORM_SET.has(value);
}

export interface ParsedTransforms {
  names: string[];
  /** The value was the full `trim | lower | upper | ...` vocabulary sketch, not a pipeline. */
  vocabularySketch: boolean;
}

/**
 * Accept a transform name, a YAML list, or a pipe-separated list.
 * The pipe-separated list of every built-in name is the config sketch from the docs
 * and is not applied (chaining lower and upper would destroy values).
 */
export function parseTransformSpec(value: unknown, where: string): ParsedTransforms {
  if (value == null) return { names: [], vocabularySketch: false };
  if (typeof value === "string") {
    return parseTransformString(value, where);
  }
  if (Array.isArray(value)) {
    const names = value.map((entry) => {
      if (typeof entry !== "string" || !isTransformName(entry.trim())) {
        throw new CliError(
          `${where}: unknown transform "${String(entry)}". Known transforms: ${TRANSFORM_NAMES.join(", ")}`,
        );
      }
      return entry.trim();
    });
    return { names, vocabularySketch: false };
  }
  throw new CliError(`${where}: transforms must be a name or a list of names`);
}

function parseTransformString(value: string, where: string): ParsedTransforms {
  const trimmed = value.trim();
  if (trimmed === "") return { names: [], vocabularySketch: false };
  if (trimmed.includes("|")) {
    const parts = trimmed
      .split("|")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    if (parts.length === 0) return { names: [], vocabularySketch: false };
    for (const part of parts) {
      if (!isTransformName(part)) {
        throw new CliError(
          `${where}: unknown transform "${part}". Chain transforms with a YAML list, for example [trim, lower]. Known transforms: ${TRANSFORM_NAMES.join(", ")}`,
        );
      }
    }
    const unique = new Set(parts);
    if (unique.size === TRANSFORM_NAMES.length && TRANSFORM_NAMES.every((name) => unique.has(name))) {
      return { names: [], vocabularySketch: true };
    }
    return { names: parts, vocabularySketch: false };
  }
  if (!isTransformName(trimmed)) {
    throw new CliError(
      `${where}: unknown transform "${trimmed}". Known transforms: ${TRANSFORM_NAMES.join(", ")}`,
    );
  }
  return { names: [trimmed], vocabularySketch: false };
}

export function applyTransforms(value: string, names: readonly string[]): string {
  let current = value;
  for (const name of names) {
    const fn = TRANSFORMS[name];
    if (!fn) {
      throw new CliError(`Unknown transform "${name}". Known transforms: ${TRANSFORM_NAMES.join(", ")}`);
    }
    current = fn(current);
  }
  return current;
}

export function defaultTransforms(type: string): string[] {
  switch (type) {
    case "email":
      return ["trim", "lower"];
    case "phone":
      return ["phone_e164_loose"];
    case "date":
      return ["date_iso_loose"];
    default:
      return ["trim"];
  }
}

/**
 * Loose E.164. 10-digit numbers are treated as NANP and prefixed with +1.
 * 11-digit numbers starting with 1 get a leading +. Other 8–15 digit numbers
 * get a leading + (country code must already be present). Shorter values are unchanged
 * so validation can still flag them. A trailing extension (x123, ext. 9) is removed.
 */
export function transformPhoneE164Loose(value: string): string {
  const original = value.trim();
  if (original === "") return original;
  const withoutExt = original.replace(/\s*(?:extension|ext\.?|x)\s*\d+\s*$/i, "").trim();
  let plus = false;
  let digits = "";
  for (const ch of withoutExt) {
    if (ch >= "0" && ch <= "9") digits += ch;
    else if (ch === "+" && digits === "" && !plus) plus = true;
  }
  if (digits.startsWith("00")) {
    plus = true;
    digits = digits.slice(2);
  }
  if (digits.length < 8 || digits.length > 15) return original;
  if (!plus && digits.length === 10) return `+1${digits}`;
  if (!plus && digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MONTH_PATTERN =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export function monthNumber(token: string): number | undefined {
  const lower = token.toLowerCase();
  if (lower.startsWith("sept")) return 9;
  return MONTH_INDEX[lower.slice(0, 3)];
}

export function validYMD(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function formatYMD(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function expandYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function parseNamedMonth(value: string): string | null {
  const monthFirst = value.match(new RegExp(`^${MONTH_PATTERN}\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "i"));
  if (monthFirst) {
    const month = monthNumber(monthFirst[1] ?? "");
    const day = Number(monthFirst[2]);
    const year = Number(monthFirst[3]);
    if (month && validYMD(year, month, day)) return formatYMD(year, month, day);
    return null;
  }
  const dayFirst = value.match(new RegExp(`^(\\d{1,2})[\\s\\-/]+${MONTH_PATTERN}[\\s,\\-/]+(\\d{4})$`, "i"));
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = monthNumber(dayFirst[2] ?? "");
    const year = Number(dayFirst[3]);
    if (month && validYMD(year, month, day)) return formatYMD(year, month, day);
    return null;
  }
  return null;
}

/**
 * Convert common client date strings to YYYY-MM-DD.
 * Ambiguous numeric dates (both parts <= 12) use month/day/year.
 * Unparseable values are returned unchanged so validation can flag them.
 * Two-digit years: 00–69 → 2000s, 70–99 → 1900s.
 */
export function transformDateIsoLoose(value: string): string {
  const original = value.trim();
  if (original === "") return original;
  const stripped = original.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]m)?\s*$/i, "").trim();
  const v = stripped === "" ? original : stripped;

  const iso = v.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
  );
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (!validYMD(year, month, day)) return original;
    return formatYMD(year, month, day);
  }

  const ymd = v.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (!validYMD(year, month, day)) return original;
    return formatYMD(year, month, day);
  }

  const named = parseNamedMonth(v);
  if (named) return named;

  const numeric = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = expandYear(Number(numeric[3]));
    let month: number;
    let day: number;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else if (a <= 12 && b <= 12) {
      month = a;
      day = b;
    } else {
      return original;
    }
    if (!validYMD(year, month, day)) return original;
    return formatYMD(year, month, day);
  }

  return original;
}

export function isIsoDate(value: string): boolean {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!match) return false;
  return validYMD(Number(match[1]), Number(match[2]), Number(match[3]));
}

const TRANSFORMS: Record<string, (value: string) => string> = {
  trim: (value) => value.trim(),
  lower: (value) => value.toLowerCase(),
  upper: (value) => value.toUpperCase(),
  phone_e164_loose: transformPhoneE164Loose,
  date_iso_loose: transformDateIsoLoose,
};
