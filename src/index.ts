export { CliError } from "./errors.js";
export { parseCsv, toCsv, detectDelimiter } from "./csv.js";
export {
  AUTO_MATCH_THRESHOLD,
  LOW_CONFIDENCE_BELOW,
  autoAssign,
  damerauLevenshtein,
  normalize,
  scoreHeader,
} from "./fuzzy.js";
export {
  TRANSFORM_NAMES,
  applyTransforms,
  defaultTransforms,
  transformDateIsoLoose,
  transformPhoneE164Loose,
} from "./transforms.js";
export { BUILTIN_TARGET_IDS, listTargets, loadBuiltin, loadSchemaFile } from "./schema.js";
export { loadMappingFile, parseMappingConfig } from "./config.js";
export { mapCsvText, mapTable, validateCsvText, validateTable, planMatches } from "./mapping.js";
export { suggestMappingYaml } from "./suggest.js";
export { buildReport, renderHtmlReport, renderJsonReport } from "./report.js";
export { main } from "./main.js";
export type {
  ColumnMatch,
  FieldType,
  Issue,
  MappingConfig,
  Report,
  SchemaField,
  Summary,
  TabularResult,
  TargetSchema,
} from "./types.js";
