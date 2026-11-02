import { bindColumns } from "./config.js";
import { rankHeaders } from "./fuzzy.js";
import { planMatches } from "./mapping.js";
import { packageInfo } from "./paths.js";
import { defaultTransforms } from "./transforms.js";
import type { ColumnSpec, MappingConfig, TargetSchema } from "./types.js";

export interface SuggestInput {
  headers: string[];
  rowCount: number;
  schema: TargetSchema;
  config: MappingConfig | null;
}

/** Printable mapping YAML. Unmapped fields are comments so the document stays a valid config. */
export function suggestMappingYaml(input: SuggestInput): string {
  const requiredFromTarget = input.config ? (input.config.requiredFromTarget ?? true) : true;
  const globalTransforms = input.config?.globalTransforms ?? [];
  const bound = input.config ? bindColumns(input.schema, input.config) : new Map<string, ColumnSpec>();
  const planned = planMatches({
    headers: input.headers,
    fields: input.schema.fields,
    bound,
    globalTransforms,
    auto: true,
    requiredFromTarget,
    vocabularySketch: false,
  });

  const lines: string[] = [
    `# Suggested by csv-schema-mapper ${packageInfo().version}`,
    `# Target: ${input.schema.name} (${input.schema.id})`,
    `# Input columns: ${input.headers.length}  Data rows scanned: ${input.rowCount}`,
    "# auto is false so a later map uses only the columns listed below.",
    "# Review each source. Fuzzy matches under 0.92 are called out in the comment.",
    `target: ${yamlString(input.schema.id)}`,
    "auto: false",
    "required_from_target: true",
  ];

  const mapped = planned.matches.filter((match) => match.sourceHeader);
  if (mapped.length === 0) {
    lines.push("columns: {}");
  } else {
    lines.push("columns:");
    for (const match of mapped) {
      const spec = bound.get(match.targetId);
      const transforms =
        spec && spec.transforms.length > 0
          ? [...spec.transforms, ...globalTransforms]
          : [...defaultTransforms(fieldType(input.schema, match.targetId)), ...globalTransforms];
      const note =
        match.sourceIndex == null
          ? "explicit 0.00 source header not found"
          : `${match.method} ${match.confidence.toFixed(2)}`;
      lines.push(`  ${yamlKey(match.targetId)}:`);
      lines.push(`    source: ${yamlString(match.sourceHeader ?? "")} # ${note}`);
      if (transforms.length > 0) lines.push(`    ${formatTransform(dedupe(transforms))}`);
    }
  }

  lines.push("# Unmapped target fields");
  const used = new Set(planned.matches.filter((match) => match.sourceIndex != null).map((match) => match.sourceHeader));
  for (const field of input.schema.fields) {
    const match = planned.matches.find((item) => item.targetId === field.id);
    if (match?.sourceHeader) continue;
    const ranked = rankHeaders(field, input.headers);
    const closest = ranked.find((item) => !used.has(item.header)) ?? ranked[0];
    const requirement = field.required ? "required" : "optional";
    if (!closest || closest.score <= 0) {
      lines.push(`# - ${field.id} (${field.header}) ${requirement} — no usable source header`);
      continue;
    }
    const taken = used.has(closest.header) ? ", already used by another field" : "";
    lines.push(
      `# - ${field.id} (${field.header}) ${requirement} — closest "${closest.header}" ${closest.score.toFixed(2)}${taken}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function fieldType(schema: TargetSchema, id: string): string {
  return schema.fields.find((field) => field.id === id)?.type ?? "string";
}

function dedupe(names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) if (!out.includes(name)) out.push(name);
  return out;
}

function formatTransform(names: string[]): string {
  if (names.length === 1) return `transform: ${names[0]}`;
  return `transform: [${names.join(", ")}]`;
}

function yamlKey(value: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return value;
  return yamlString(value);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
