import { readFileSync } from "node:fs";
import { CliError } from "./errors.js";
import { normalize } from "./fuzzy.js";
import { asBool, asRecord, parseDocument } from "./schema.js";
import { parseTransformSpec } from "./transforms.js";
import type { ColumnSpec, MappingConfig, TargetSchema } from "./types.js";

export function loadMappingFile(path: string): MappingConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "ENOENT") {
      throw new CliError(`Config file not found: ${path}`);
    }
    throw err;
  }
  return parseMappingConfig(parseDocument(text, path), path);
}

export function parseMappingConfig(raw: unknown, where = "mapping config"): MappingConfig {
  const record = asRecord(raw, where);
  const target = typeof record.target === "string" && record.target.trim() !== "" ? record.target.trim() : undefined;
  const auto = record.auto == null ? undefined : asBool(record.auto, `${where}.auto`, false);
  const requiredRaw = record.required_from_target ?? record.requiredFromTarget;
  const requiredFromTarget = requiredRaw == null ? undefined : asBool(requiredRaw, `${where}.required_from_target`, true);

  const globalParsed = parseTransformSpec(record.transforms, `${where}.transforms`);
  let vocabularySketch = globalParsed.vocabularySketch;
  const columnsRaw = record.columns ?? {};
  const columnsRecord = asRecord(columnsRaw, `${where}.columns`);
  const columns: Record<string, ColumnSpec> = {};

  for (const [key, value] of Object.entries(columnsRecord)) {
    if (key.trim() === "") throw new CliError(`${where}: column key is empty`);
    const parsed = parseColumn(value, `${where}.columns.${key}`);
    if (parsed.vocabularySketch) vocabularySketch = true;
    columns[key] = { source: parsed.source, transforms: parsed.transforms };
  }

  const config: MappingConfig = {
    globalTransforms: globalParsed.names,
    vocabularySketch,
    columns,
  };
  if (target !== undefined) config.target = target;
  if (auto !== undefined) config.auto = auto;
  if (requiredFromTarget !== undefined) config.requiredFromTarget = requiredFromTarget;
  return config;
}

function parseColumn(
  value: unknown,
  where: string,
): { source: string; transforms: string[]; vocabularySketch: boolean } {
  if (typeof value === "string" || typeof value === "number") {
    const source = String(value).trim();
    if (source === "") throw new CliError(`${where} needs a source header`);
    return { source, transforms: [], vocabularySketch: false };
  }
  const record = asRecord(value, where);
  const source = sourceName(record.source, where);
  const primary = parseTransformSpec(record.transform, `${where}.transform`);
  const extra = parseTransformSpec(record.transforms, `${where}.transforms`);
  return {
    source,
    transforms: [...primary.names, ...extra.names],
    vocabularySketch: primary.vocabularySketch || extra.vocabularySketch,
  };
}

function sourceName(value: unknown, where: string): string {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new CliError(`${where}: source must be the input column name`);
}

function findField(schema: TargetSchema, key: string) {
  const direct = schema.fields.find((field) => field.id === key || field.header === key);
  if (direct) return direct;
  const normalized = normalize(key);
  const matches = schema.fields.filter(
    (field) =>
      normalize(field.id) === normalized ||
      normalize(field.header) === normalized ||
      normalize(field.label) === normalized,
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new CliError(
      `Column "${key}" matches multiple target fields: ${matches.map((field) => field.id).join(", ")}`,
    );
  }
  return undefined;
}

/** Bind config column keys to schema field ids. Throws on unknown or repeated fields. */
export function bindColumns(schema: TargetSchema, config: MappingConfig): Map<string, ColumnSpec> {
  const bound = new Map<string, ColumnSpec>();
  for (const [key, spec] of Object.entries(config.columns)) {
    const field = findField(schema, key);
    if (!field) {
      const known = schema.fields.map((item) => item.id).join(", ");
      throw new CliError(`Unknown target field "${key}" for schema ${schema.id}. Known fields: ${known}`);
    }
    if (bound.has(field.id)) {
      throw new CliError(`Target field "${field.id}" is listed more than once in the mapping config`);
    }
    bound.set(field.id, spec);
  }
  return bound;
}
