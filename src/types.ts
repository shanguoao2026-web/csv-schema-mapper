export type FieldType =
  | "string"
  | "email"
  | "phone"
  | "date"
  | "number"
  | "integer"
  | "boolean"
  | "url"
  | "enum";

export interface SchemaField {
  id: string;
  /** Column name written to the mapped CSV. */
  header: string;
  label: string;
  type: FieldType;
  required: boolean;
  synonyms: string[];
  description?: string;
  enumValues?: string[];
}

export interface TargetSchema {
  id: string;
  name: string;
  description: string;
  fields: SchemaField[];
}

export interface ColumnSpec {
  source: string;
  transforms: string[];
}

export interface MappingConfig {
  target?: string;
  /** When omitted, map treats a config file as auto: false and no config as auto: true. */
  auto?: boolean;
  /** When omitted, required target fields are enforced. */
  requiredFromTarget?: boolean;
  globalTransforms: string[];
  /**
   * True when `transforms` was the pipe-separated vocabulary sketch
   * (`trim | lower | ...`) and was not applied as a pipeline.
   */
  vocabularySketch: boolean;
  columns: Record<string, ColumnSpec>;
}

export type MatchMethod = "explicit" | "exact" | "synonym" | "fuzzy" | "unmapped";

export interface ColumnMatch {
  targetId: string;
  outputHeader: string;
  label: string;
  type: FieldType;
  required: boolean;
  sourceHeader: string | null;
  sourceIndex: number | null;
  confidence: number;
  method: MatchMethod;
  transforms: string[];
}

export type IssueCode =
  | "missing_required"
  | "empty_required"
  | "type_mismatch"
  | "missing_source"
  | "low_confidence"
  | "unmapped_source"
  | "unknown_column"
  | "extra_values"
  | "empty_input"
  | "transforms_note";

export interface Issue {
  severity: "error" | "warning";
  code: IssueCode;
  message: string;
  field?: string;
  /** 1-based data row in the parsed/output table. Blank input lines are not counted. */
  row?: number;
  source?: string;
  value?: string;
  confidence?: number;
}

export interface Summary {
  inputRows: number;
  outputRows: number;
  errorCount: number;
  warningCount: number;
  /** Data rows that have no row-level errors. */
  validRows: number;
  missingRequired: string[];
  ok: boolean;
}

export interface SampleRow {
  row: number;
  messages: string[];
  /** Output values keyed by target field id. */
  output: Record<string, string>;
}

export interface TabularResult {
  schema: TargetSchema;
  inputHeaders: string[];
  delimiter: string;
  matches: ColumnMatch[];
  outputHeaders: string[];
  rows: string[][];
  issues: Issue[];
  samples: SampleRow[];
  summary: Summary;
}

export interface ReportMeta {
  command: "map" | "validate";
  version: string;
  generatedAt: string;
  inputPath: string | null;
  outputPath: string | null;
  reportPath: string | null;
}

export interface Report {
  tool: "csv-schema-mapper";
  version: string;
  command: "map" | "validate";
  generatedAt: string;
  input: {
    path: string | null;
    headers: string[];
    rows: number;
    delimiter: string;
  };
  output: {
    path: string | null;
    headers: string[];
  };
  target: {
    id: string;
    name: string;
  };
  summary: Summary;
  mapping: Array<{
    target: string;
    header: string;
    label: string;
    source: string | null;
    method: MatchMethod;
    confidence: number;
    transforms: string[];
    required: boolean;
  }>;
  issues: Issue[];
  samples: SampleRow[];
  issuesTruncated: boolean;
}
