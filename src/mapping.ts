import { parseCsv, type ParsedCsv } from "./csv.js";
import { bindColumns } from "./config.js";
import { CliError } from "./errors.js";
import { autoAssign, LOW_CONFIDENCE_BELOW, normalize } from "./fuzzy.js";
import { applyTransforms } from "./transforms.js";
import type {
  ColumnMatch,
  ColumnSpec,
  Issue,
  MappingConfig,
  MatchMethod,
  SampleRow,
  Summary,
  TabularResult,
  TargetSchema,
} from "./types.js";
import { typeProblem } from "./values.js";

const MAX_SAMPLES = 8;
const MAX_STORED_ISSUES = 1000;

export interface TableInput extends ParsedCsv {
  schema: TargetSchema;
  config: MappingConfig | null;
}

export function mapCsvText(
  text: string,
  schema: TargetSchema,
  config: MappingConfig | null,
  delimiter?: string,
): TabularResult {
  return mapTable({ ...parseCsv(text, delimiter), schema, config });
}

export function validateCsvText(text: string, schema: TargetSchema, delimiter?: string): TabularResult {
  return validateTable({ ...parseCsv(text, delimiter), schema });
}

export function mapTable(input: TableInput): TabularResult {
  const auto = input.config ? (input.config.auto ?? false) : true;
  const requiredFromTarget = input.config ? (input.config.requiredFromTarget ?? true) : true;
  const globalTransforms = input.config?.globalTransforms ?? [];
  const bound = input.config ? bindColumns(input.schema, input.config) : new Map<string, ColumnSpec>();
  const { matches, issues } = planMatches({
    headers: input.headers,
    fields: input.schema.fields,
    bound,
    globalTransforms,
    auto,
    requiredFromTarget,
    vocabularySketch: input.config?.vocabularySketch ?? false,
  });
  return finishTable(input, matches, issues);
}

export function validateTable(input: Omit<TableInput, "config">): TabularResult {
  const issues: Issue[] = [];
  const usedFieldIds = new Set<string>();
  const headerToField = new Map<number, string>();

  input.headers.forEach((header, index) => {
    const field = matchValidateHeader(input.schema, header);
    if (!field) {
      issues.push({
        severity: "warning",
        code: "unknown_column",
        source: header,
        message: `"${header}" is not a field on ${input.schema.id}. validate expects target headers (id or output header), not client export headers`,
      });
      return;
    }
    if (usedFieldIds.has(field.id)) {
      issues.push({
        severity: "error",
        code: "unknown_column",
        source: header,
        field: field.id,
        message: `"${header}" also maps to ${field.id}, which is already present`,
      });
      return;
    }
    usedFieldIds.add(field.id);
    headerToField.set(index, field.id);
  });

  const matches: ColumnMatch[] = input.schema.fields.map((field) => {
    const sourceIndex = [...headerToField.entries()].find(([, id]) => id === field.id)?.[0] ?? null;
    if (sourceIndex == null && field.required) {
      issues.push({
        severity: "error",
        code: "missing_required",
        field: field.id,
        message: `${field.id}: required column "${field.header}" is missing`,
      });
    }
    return {
      targetId: field.id,
      outputHeader: field.header,
      label: field.label,
      type: field.type,
      required: field.required,
      sourceHeader: sourceIndex == null ? null : input.headers[sourceIndex] ?? null,
      sourceIndex,
      confidence: sourceIndex == null ? 0 : 1,
      method: sourceIndex == null ? "unmapped" : "exact",
      transforms: [],
    };
  });

  return finishTable(input, matches, issues);
}

function matchValidateHeader(schema: TargetSchema, header: string) {
  const normalized = normalize(header);
  return schema.fields.find(
    (field) =>
      normalize(field.id) === normalized ||
      normalize(field.header) === normalized ||
      normalize(field.label) === normalized,
  );
}

interface PlanInput {
  headers: string[];
  fields: TargetSchema["fields"];
  bound: Map<string, ColumnSpec>;
  globalTransforms: string[];
  auto: boolean;
  requiredFromTarget: boolean;
  vocabularySketch: boolean;
}

export function planMatches(input: PlanInput): { matches: ColumnMatch[]; issues: Issue[] } {
  const issues: Issue[] = [];
  if (input.vocabularySketch) {
    issues.push({
      severity: "warning",
      code: "transforms_note",
      message:
        'Top-level transforms listed every built-in name separated by pipes and were not applied. Use a YAML list such as [trim, lower] to chain transforms.',
    });
  }

  const usedSources = new Set<number>();
  const explicit = new Map<string, ColumnMatch>();

  for (const [fieldId, spec] of input.bound) {
    const field = input.fields.find((item) => item.id === fieldId);
    if (!field) continue;
    const sourceIndex = findHeaderIndex(input.headers, spec.source);
    if (sourceIndex >= 0 && usedSources.has(sourceIndex)) {
      throw new CliError(
        `Source column "${input.headers[sourceIndex]}" is assigned to more than one target field`,
      );
    }
    if (sourceIndex >= 0) usedSources.add(sourceIndex);
    const transforms = [...spec.transforms, ...input.globalTransforms];
    if (sourceIndex < 0) {
      issues.push({
        severity: "error",
        code: "missing_source",
        field: field.id,
        source: spec.source,
        message: `${field.id}: source column "${spec.source}" was not found${field.required ? " (field is required)" : ""}`,
      });
    }
    explicit.set(field.id, {
      targetId: field.id,
      outputHeader: field.header,
      label: field.label,
      type: field.type,
      required: field.required,
      sourceHeader: sourceIndex >= 0 ? input.headers[sourceIndex]! : spec.source,
      sourceIndex: sourceIndex >= 0 ? sourceIndex : null,
      confidence: sourceIndex >= 0 ? 1 : 0,
      method: "explicit",
      transforms: sourceIndex >= 0 ? transforms : [],
    });
  }

  const usedTargets = new Set(explicit.keys());
  if (input.auto) {
    const assignments = autoAssign(input.headers, input.fields, usedSources, usedTargets);
    for (const assignment of assignments) {
      const field = input.fields[assignment.fieldIndex];
      if (!field) continue;
      explicit.set(field.id, {
        targetId: field.id,
        outputHeader: field.header,
        label: field.label,
        type: field.type,
        required: field.required,
        sourceHeader: input.headers[assignment.sourceIndex] ?? null,
        sourceIndex: assignment.sourceIndex,
        confidence: assignment.score,
        method: assignment.method,
        transforms: [...input.globalTransforms],
      });
    }
  }

  const matches: ColumnMatch[] = input.fields.map((field) => {
    const existing = explicit.get(field.id);
    if (existing) return existing;
    return {
      targetId: field.id,
      outputHeader: field.header,
      label: field.label,
      type: field.type,
      required: field.required,
      sourceHeader: null,
      sourceIndex: null,
      confidence: 0,
      method: "unmapped" as MatchMethod,
      transforms: [],
    };
  });

  for (const match of matches) {
    if (match.sourceIndex == null) {
      if (match.method === "unmapped" && match.required && !input.bound.has(match.targetId)) {
        issues.push({
          severity: input.requiredFromTarget ? "error" : "warning",
          code: "missing_required",
          field: match.targetId,
          message: `${match.targetId}: required field has no mapped source column`,
        });
      }
      continue;
    }
    if (match.method === "fuzzy" && match.confidence < LOW_CONFIDENCE_BELOW) {
      issues.push({
        severity: "warning",
        code: "low_confidence",
        field: match.targetId,
        source: match.sourceHeader ?? undefined,
        confidence: match.confidence,
        message: `${match.targetId}: fuzzy match from "${match.sourceHeader}" has confidence ${match.confidence.toFixed(2)} (below ${LOW_CONFIDENCE_BELOW.toFixed(2)})`,
      });
    }
  }

  return { matches, issues };
}

export function findHeaderIndex(headers: string[], source: string): number {
  const exact = headers.findIndex((header) => header === source);
  if (exact >= 0) return exact;
  const trimmed = source.trim();
  const trimIndex = headers.findIndex((header) => header.trim() === trimmed);
  if (trimIndex >= 0) return trimIndex;
  const normalized = normalize(source);
  const matches = headers
    .map((header, index) => ({ header, index }))
    .filter((item) => normalize(item.header) === normalized);
  if (matches.length > 1) {
    throw new CliError(
      `Source "${source}" matches multiple headers: ${matches.map((item) => item.header).join(", ")}`,
    );
  }
  return matches[0]?.index ?? -1;
}

function finishTable(input: Omit<TableInput, "config">, matches: ColumnMatch[], issues: Issue[]): TabularResult {
  const columnIssues = [...issues];
  const used = new Set(matches.map((match) => match.sourceIndex).filter((index): index is number => index != null));

  if (input.rows.length === 0) {
    columnIssues.push({
      severity: "warning",
      code: "empty_input",
      message: "CSV has a header but no data rows",
    });
  }

  for (let index = 0; index < input.headers.length; index++) {
    if (used.has(index)) continue;
    const header = input.headers[index]!;
    const alreadyUnknown = columnIssues.some((issue) => issue.code === "unknown_column" && issue.source === header);
    if (alreadyUnknown) continue;
    columnIssues.push({
      severity: "warning",
      code: "unmapped_source",
      source: header,
      message: `"${header}" was not mapped to a target field`,
    });
  }

  for (const rowNumber of input.extraValueRows) {
    columnIssues.push({
      severity: "warning",
      code: "extra_values",
      row: rowNumber,
      message: "extra non-empty values were dropped because the row is wider than the header",
    });
  }

  const outputHeaders = matches.map((match) => match.outputHeader);
  const rows: string[][] = [];
  const rowIssues: Issue[] = [];

  input.rows.forEach((sourceRow, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const out = matches.map((match) => {
      if (match.sourceIndex == null) return "";
      const raw = sourceRow[match.sourceIndex] ?? "";
      return applyTransforms(raw, match.transforms);
    });
    rows.push(out);
    matches.forEach((match, columnIndex) => {
      const value = out[columnIndex] ?? "";
      if (match.required && value.trim() === "" && match.sourceIndex != null) {
        rowIssues.push({
          severity: "error",
          code: "empty_required",
          field: match.targetId,
          row: rowNumber,
          source: match.sourceHeader ?? undefined,
          value: cap(value),
          message: `${match.targetId}: required value is empty`,
        });
        return;
      }
      const field = input.schema.fields.find((item) => item.id === match.targetId);
      if (!field) return;
      const problem = typeProblem(field, value);
      if (problem) {
        rowIssues.push({
          severity: "error",
          code: "type_mismatch",
          field: match.targetId,
          row: rowNumber,
          source: match.sourceHeader ?? undefined,
          value: cap(value),
          message: `${match.targetId}: ${problem}`,
        });
      }
    });
  });

  const allIssues = [...columnIssues, ...rowIssues].slice(0, MAX_STORED_ISSUES);
  const samples = buildSamples(matches, rows, allIssues);
  return {
    schema: input.schema,
    inputHeaders: input.headers,
    delimiter: input.delimiter,
    matches,
    outputHeaders,
    rows,
    issues: allIssues,
    samples,
    summary: summarize(input.rows.length, rows.length, allIssues),
  };
}

function cap(value: string): string {
  return value.length > 500 ? value.slice(0, 500) : value;
}

function buildSamples(matches: ColumnMatch[], rows: string[][], issues: Issue[]): SampleRow[] {
  const byRow = new Map<number, string[]>();
  for (const issue of issues) {
    if (issue.severity !== "error" || issue.row == null) continue;
    const list = byRow.get(issue.row) ?? [];
    list.push(issue.message);
    byRow.set(issue.row, list);
  }
  const samples: SampleRow[] = [];
  for (const [row, messages] of byRow) {
    if (samples.length >= MAX_SAMPLES) break;
    const values = rows[row - 1] ?? [];
    const output: Record<string, string> = {};
    matches.forEach((match, index) => {
      output[match.targetId] = values[index] ?? "";
    });
    samples.push({ row, messages, output });
  }
  return samples;
}

export function summarize(inputRows: number, outputRows: number, issues: Issue[]): Summary {
  const badRows = new Set<number>();
  const missing = new Set<string>();
  let errorCount = 0;
  let warningCount = 0;
  for (const issue of issues) {
    if (issue.severity === "error") {
      errorCount++;
      if (issue.row != null) badRows.add(issue.row);
      if (issue.code === "missing_required" && issue.field) missing.add(issue.field);
    } else {
      warningCount++;
    }
  }
  return {
    inputRows,
    outputRows,
    errorCount,
    warningCount,
    validRows: Math.max(0, outputRows - badRows.size),
    missingRequired: [...missing],
    ok: errorCount === 0,
  };
}
