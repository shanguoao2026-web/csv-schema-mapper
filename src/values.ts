import type { SchemaField } from "./types.js";
import { isIsoDate } from "./transforms.js";

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** E.164-like: optional +, first digit 1-9, 8–15 digits total. Spaces and light punctuation are ignored. */
export function isPhone(value: string): boolean {
  const compact = value.trim().replace(/[\s().-]/g, "");
  return /^\+?[1-9]\d{7,14}$/.test(compact);
}

export function isUrl(value: string): boolean {
  const v = value.trim();
  if (v === "" || /\s/.test(v)) return false;
  if (/^https?:\/\/[^\s]+$/i.test(v) && v.includes(".")) return true;
  if (/^www\.[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(v)) return true;
  if (/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+(?:\/[^\s]*)?$/i.test(v)) {
    return true;
  }
  return false;
}

const BOOLEAN_VALUES = new Set(["true", "false", "yes", "no", "y", "n", "1", "0", "t", "f"]);

export function isBooleanValue(value: string): boolean {
  return BOOLEAN_VALUES.has(value.trim().toLowerCase());
}

export function isNumberValue(value: string): boolean {
  let v = value.trim().replace(/^[$£€¥]\s*/, "").replace(/\s/g, "");
  if (v === "") return false;
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) v = v.replace(/,/g, "");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(v)) return false;
  return Number.isFinite(Number(v));
}

export function isIntegerValue(value: string): boolean {
  let v = value.trim().replace(/^[$£€¥]\s*/, "").replace(/\s/g, "");
  if (v === "") return false;
  if (/^[+-]?\d{1,3}(,\d{3})+$/.test(v)) v = v.replace(/,/g, "");
  return /^[+-]?\d+$/.test(v);
}

export function enumKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function isEnumValue(value: string, allowed: readonly string[]): boolean {
  const key = enumKey(value);
  return allowed.some((entry) => enumKey(entry) === key);
}

export function preview(value: string, max = 80): string {
  const flat = value.replace(/\s+/g, " ");
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 3)}...`;
}

/** Return a message fragment when a non-empty value has the wrong type. Empty values return null. */
export function typeProblem(field: SchemaField, value: string): string | null {
  if (value.trim() === "") return null;
  switch (field.type) {
    case "string":
      return null;
    case "email":
      return isEmail(value.trim()) ? null : `expected an email address, got "${preview(value)}"`;
    case "phone":
      return isPhone(value) ? null : `expected a phone number (8–15 digits, optional leading +), got "${preview(value)}"`;
    case "date":
      return isIsoDate(value) ? null : `expected an ISO date (YYYY-MM-DD), got "${preview(value)}"`;
    case "number":
      return isNumberValue(value) ? null : `expected a number, got "${preview(value)}"`;
    case "integer":
      return isIntegerValue(value) ? null : `expected an integer, got "${preview(value)}"`;
    case "boolean":
      return isBooleanValue(value)
        ? null
        : `expected a boolean (true/false, yes/no, 1/0), got "${preview(value)}"`;
    case "url":
      return isUrl(value) ? null : `expected a URL, got "${preview(value)}"`;
    case "enum": {
      const allowed = field.enumValues ?? [];
      if (allowed.length === 0) return "enum has no allowed values";
      return isEnumValue(value, allowed)
        ? null
        : `expected one of ${allowed.join(", ")}, got "${preview(value)}"`;
    }
    default:
      return null;
  }
}
