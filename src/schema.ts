import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { CliError } from "./errors.js";
import { schemasDir } from "./paths.js";
import type { FieldType, SchemaField, TargetSchema } from "./types.js";

export const BUILTIN_TARGET_IDS = [
  "hubspot-contacts",
  "shopify-customers",
  "shopify-products",
  "xero-contacts",
] as const;

export type BuiltinTargetId = (typeof BUILTIN_TARGET_IDS)[number];

const FIELD_TYPES = new Set<FieldType>([
  "string",
  "email",
  "phone",
  "date",
  "number",
  "integer",
  "boolean",
  "url",
  "enum",
]);

export function isBuiltinTarget(id: string): id is BuiltinTargetId {
  return (BUILTIN_TARGET_IDS as readonly string[]).includes(id);
}

export function loadBuiltin(id: string): TargetSchema {
  if (!isBuiltinTarget(id)) {
    throw new CliError(
      `Unknown target "${id}". Known targets: ${BUILTIN_TARGET_IDS.join(", ")}. Use --target custom --schema <file> for your own schema.`,
    );
  }
  return loadSchemaFile(join(schemasDir(), `${id}.yaml`));
}

export function listTargets(): TargetSchema[] {
  return BUILTIN_TARGET_IDS.map((id) => loadBuiltin(id));
}

export function loadSchemaFile(path: string): TargetSchema {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if (isEnoent(err)) throw new CliError(`Schema file not found: ${path}`);
    throw err;
  }
  const fallbackId = basename(path).replace(/\.(ya?ml|json)$/i, "") || "custom";
  return loadSchemaDocument(parseDocument(text, path), fallbackId, path);
}

export function parseDocument(text: string, path: string): unknown {
  const body = text.replace(/^\uFEFF/, "");
  if (body.trim() === "") throw new CliError(`${path} is empty`);
  try {
    if (path.toLowerCase().endsWith(".json")) return JSON.parse(body) as unknown;
    return parseYaml(body) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(`Could not parse ${path}: ${message}`);
  }
}

export function loadSchemaDocument(raw: unknown, fallbackId: string, where: string): TargetSchema {
  const record = asRecord(raw, where);
  const idValue = record.id ?? record.name;
  const id = typeof idValue === "string" && idValue.trim() !== "" ? idValue.trim() : fallbackId;
  const nameValue = record.name;
  const name = typeof nameValue === "string" && nameValue.trim() !== "" ? nameValue.trim() : id;
  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (!Array.isArray(record.fields) || record.fields.length === 0) {
    throw new CliError(`${where}: schema needs a non-empty fields list`);
  }

  const fields: SchemaField[] = [];
  const seenIds = new Set<string>();
  const seenHeaders = new Set<string>();
  for (let index = 0; index < record.fields.length; index++) {
    const field = parseField(record.fields[index], `${where} field ${index + 1}`);
    if (seenIds.has(field.id)) throw new CliError(`${where}: duplicate field id "${field.id}"`);
    if (seenHeaders.has(field.header)) throw new CliError(`${where}: duplicate output header "${field.header}"`);
    seenIds.add(field.id);
    seenHeaders.add(field.header);
    fields.push(field);
  }
  return { id, name, description, fields };
}

function parseField(raw: unknown, where: string): SchemaField {
  const record = asRecord(raw, where);
  const idValue = record.id ?? record.name;
  if (typeof idValue !== "string" || idValue.trim() === "") {
    throw new CliError(`${where}: each field needs an id`);
  }
  const id = idValue.trim();
  const header =
    typeof record.header === "string" && record.header.trim() !== "" ? record.header.trim() : id;
  const label = typeof record.label === "string" && record.label.trim() !== "" ? record.label.trim() : header;
  const typeValue = record.type == null ? "string" : record.type;
  if (typeof typeValue !== "string" || !FIELD_TYPES.has(typeValue as FieldType)) {
    throw new CliError(
      `${where}: unknown type "${String(typeValue)}". Known types: ${[...FIELD_TYPES].join(", ")}`,
    );
  }
  const type = typeValue as FieldType;
  const required = asBool(record.required, `${where}.required`, false);
  const synonyms = asStringList(record.synonyms, `${where}.synonyms`);
  const description = typeof record.description === "string" ? record.description.trim() : undefined;
  let enumValues: string[] | undefined;
  if (type === "enum") {
    enumValues = asStringList(record.enum ?? record.values, `${where}.enum`);
    if (enumValues.length === 0) {
      throw new CliError(`${where}: enum fields need a non-empty enum list`);
    }
  } else if (record.enum != null) {
    throw new CliError(`${where}: enum list is only valid when type is enum`);
  }
  const field: SchemaField = { id, header, label, type, required, synonyms };
  if (description) field.description = description;
  if (enumValues) field.enumValues = enumValues;
  return field;
}

export function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError(`${where} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

export function asBool(value: unknown, where: string, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(lower)) return true;
    if (["false", "no", "n", "0"].includes(lower)) return false;
  }
  throw new CliError(`${where} must be a boolean`);
}

export function asStringList(value: unknown, where: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new CliError(`${where} must be a list of strings`);
  return value.map((entry) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new CliError(`${where} must be a list of strings`);
    }
    return entry.trim();
  });
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "ENOENT";
}
