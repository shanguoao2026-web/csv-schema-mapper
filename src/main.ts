import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCsv, toCsv } from "./csv.js";
import { loadMappingFile } from "./config.js";
import { CliError } from "./errors.js";
import { mapTable, validateTable } from "./mapping.js";
import { packageInfo } from "./paths.js";
import { buildReport, formatResultText, renderHtmlReport, renderJsonReport } from "./report.js";
import { isBuiltinTarget, listTargets, loadBuiltin, loadSchemaFile } from "./schema.js";
import { suggestMappingYaml } from "./suggest.js";
import type { MappingConfig, TargetSchema } from "./types.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  generatedAt?: string;
}

const HELP = `csv-schema-mapper — map messy CSV exports onto a target schema

Usage:
  csv-schema-mapper map --in <file> --out <file> [--target <id>] [--schema <file>] [--config <file>] [--report <file>]
  csv-schema-mapper suggest --in <file> [--target <id>] [--schema <file>] [--config <file>]
  csv-schema-mapper validate --in <file> [--target <id>] [--schema <file>] [--report <file>]
  csv-schema-mapper list-targets [--json]

Targets:
  hubspot-contacts     HubSpot CRM contact properties (internal names)
  shopify-customers    Shopify customer CSV columns
  shopify-products     Shopify product CSV columns
  xero-contacts        Xero contact import columns
  custom               Your own schema via --schema

Options:
  -i, --in <file>          Input CSV
  -o, --out <file>         Mapped CSV (map only; overwritten)
  -t, --target <id>        Built-in target id, or custom
  -s, --schema <file>      YAML/JSON target schema (required for custom)
  -c, --config <file>      YAML/JSON mapping config
  -r, --report <file>      Report path (.html, .htm, or .json)
  -f, --format <html|json> Report format when the path has no extension
  -d, --delimiter <char>   Input delimiter (default: detect comma, semicolon, tab, pipe)
      --json               list-targets prints JSON
  -h, --help               Show this help
  -V, --version            Print the version

Exit codes:
  0  Success. map and validate found no errors.
  1  Validation errors. map still writes the CSV and the report.
  2  Usage error, unreadable input, or invalid config. No output is written.

map reads the whole CSV, applies the config, and never prompts.
With no --config, map auto-matches headers. With a config, auto defaults to false
unless the file sets auto: true. suggest prints YAML on stdout and writes nothing.
`;

const COMMANDS = new Set(["map", "suggest", "validate", "list-targets", "help"]);

const BOOLEAN_FLAGS = new Set(["help", "version", "json"]);

const ALIASES: Record<string, string> = {
  i: "in",
  o: "out",
  t: "target",
  s: "schema",
  c: "config",
  r: "report",
  f: "format",
  d: "delimiter",
  h: "help",
  V: "version",
};

const KNOWN_FLAGS = new Set([
  "in",
  "out",
  "target",
  "schema",
  "config",
  "report",
  "format",
  "delimiter",
  "help",
  "version",
  "json",
]);

const ALLOWED: Record<string, string[]> = {
  map: ["in", "out", "target", "schema", "config", "report", "format", "delimiter"],
  suggest: ["in", "target", "schema", "config", "delimiter"],
  validate: ["in", "target", "schema", "report", "format", "delimiter"],
  "list-targets": ["json"],
};

export function main(argv: string[], options: RunOptions = {}): RunResult {
  try {
    return run(argv, options);
  } catch (err) {
    if (err instanceof CliError) {
      return { code: err.exitCode, stdout: "", stderr: `csv-schema-mapper: ${err.message}\n` };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { code: 2, stdout: "", stderr: `csv-schema-mapper: ${message}\n` };
  }
}

function run(argv: string[], options: RunOptions): RunResult {
  const { command, flags } = parseArgs(argv);
  if (flags.has("version") && !flags.has("help")) {
    return { code: 0, stdout: `${packageInfo().version}\n`, stderr: "" };
  }
  if (command == null || command === "help" || flags.has("help")) {
    return { code: 0, stdout: HELP, stderr: "" };
  }
  if (!COMMANDS.has(command)) {
    return {
      code: 2,
      stdout: "",
      stderr: `csv-schema-mapper: unknown command "${command}"\nRun csv-schema-mapper --help for usage.\n`,
    };
  }
  rejectUnusedFlags(command, flags);
  const cwd = options.cwd ?? process.cwd();
  if (command === "list-targets") return listCommand(flags);
  if (command === "suggest") return suggestCommand(flags, cwd);
  if (command === "validate") return validateCommand(flags, cwd, options.generatedAt);
  return mapCommand(flags, cwd, options.generatedAt);
}

function listCommand(flags: Map<string, string | boolean>): RunResult {
  const targets = listTargets();
  if (flags.get("json") === true) {
    const payload = targets.map((schema) => ({
      id: schema.id,
      name: schema.name,
      description: schema.description,
      fields: schema.fields.length,
      required: schema.fields.filter((field) => field.required).map((field) => field.id),
    }));
    return { code: 0, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: "" };
  }
  const lines = targets.map((schema) => {
    const required = schema.fields.filter((field) => field.required).map((field) => field.id);
    return `${schema.id.padEnd(22)} ${schema.name.padEnd(24)} ${schema.fields.length} fields, required: ${required.join(", ") || "none"}`;
  });
  lines.push("custom                 Custom schema               pass --schema <file>");
  return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

function suggestCommand(flags: Map<string, string | boolean>, cwd: string): RunResult {
  const inputPath = requireFlag(flags, "in");
  const text = readInput(resolve(cwd, inputPath));
  const delimiter = readDelimiter(flags);
  const parsed = parseCsv(text, delimiter);
  const config = readConfig(flags, cwd);
  const schema = resolveSchema(flags, cwd, config);
  const yaml = suggestMappingYaml({
    headers: parsed.headers,
    rowCount: parsed.rows.length,
    schema,
    config,
  });
  return { code: 0, stdout: yaml.endsWith("\n") ? yaml : `${yaml}\n`, stderr: "" };
}

function validateCommand(flags: Map<string, string | boolean>, cwd: string, generatedAt?: string): RunResult {
  const inputPath = requireFlag(flags, "in");
  const absIn = resolve(cwd, inputPath);
  const text = readInput(absIn);
  const delimiter = readDelimiter(flags);
  const parsed = parseCsv(text, delimiter);
  const config = readConfig(flags, cwd);
  const schema = resolveSchema(flags, cwd, config);
  const reportPath = optionalPath(flags, "report", cwd);
  if (reportPath) reportFormat(reportPath, flagString(flags, "format"));
  const result = validateTable({ ...parsed, schema });
  if (reportPath && resolve(reportPath) === absIn) {
    throw new CliError("Refusing to overwrite the input file with --report");
  }
  if (reportPath) writeReport(reportPath, result, "validate", absIn, null, generatedAt, flags);
  const textOut = formatResultText("validate", result, reportPath ? { report: reportPath } : {});
  return { code: result.summary.ok ? 0 : 1, stdout: textOut.stdout, stderr: textOut.stderr };
}

function mapCommand(flags: Map<string, string | boolean>, cwd: string, generatedAt?: string): RunResult {
  const inputPath = requireFlag(flags, "in");
  const outputPath = requireFlag(flags, "out");
  const absIn = resolve(cwd, inputPath);
  const absOut = resolve(cwd, outputPath);
  if (absIn === absOut) throw new CliError("Refusing to overwrite the input file with --out");
  const reportPath = optionalPath(flags, "report", cwd);
  if (reportPath && resolve(reportPath) === absIn) {
    throw new CliError("Refusing to overwrite the input file with --report");
  }
  if (reportPath && resolve(reportPath) === absOut) {
    throw new CliError("--out and --report must be different files");
  }
  if (reportPath) reportFormat(reportPath, flagString(flags, "format"));
  const text = readInput(absIn);
  const delimiter = readDelimiter(flags);
  const parsed = parseCsv(text, delimiter);
  const config = readConfig(flags, cwd);
  const schema = resolveSchema(flags, cwd, config);
  const result = mapTable({ ...parsed, schema, config });
  writeText(absOut, toCsv(result.outputHeaders, result.rows));
  if (reportPath) writeReport(reportPath, result, "map", absIn, absOut, generatedAt, flags);
  const textOut = formatResultText("map", result, {
    output: absOut,
    ...(reportPath ? { report: reportPath } : {}),
  });
  return { code: result.summary.ok ? 0 : 1, stdout: textOut.stdout, stderr: textOut.stderr };
}

function writeReport(
  reportPath: string,
  result: ReturnType<typeof mapTable>,
  command: "map" | "validate",
  inputPath: string,
  outputPath: string | null,
  generatedAt: string | undefined,
  flags: Map<string, string | boolean>,
): void {
  const format = reportFormat(reportPath, flagString(flags, "format"));
  const report = buildReport(result, {
    command,
    version: packageInfo().version,
    generatedAt: generatedAt ?? new Date().toISOString(),
    inputPath,
    outputPath,
    reportPath,
  });
  const body = format === "html" ? renderHtmlReport(report) : renderJsonReport(report);
  writeText(reportPath, body);
}

function resolveSchema(
  flags: Map<string, string | boolean>,
  cwd: string,
  config: MappingConfig | null,
): TargetSchema {
  const targetFlag = flagString(flags, "target");
  const schemaFlag = flagString(flags, "schema");
  if (schemaFlag) {
    const schema = loadSchemaFile(resolve(cwd, schemaFlag));
    if (targetFlag && targetFlag !== "custom" && targetFlag !== schema.id) {
      throw new CliError(`Schema id "${schema.id}" does not match --target ${targetFlag}`);
    }
    if (config?.target && config.target !== "custom" && config.target !== schema.id) {
      throw new CliError(`Config target "${config.target}" does not match schema "${schema.id}"`);
    }
    return schema;
  }
  if (targetFlag === "custom") {
    throw new CliError("--target custom requires --schema <file>");
  }
  const id = targetFlag ?? config?.target;
  if (!id) {
    throw new CliError(
      `Missing --target. Known targets: hubspot-contacts, shopify-customers, shopify-products, xero-contacts. Use --target custom --schema <file> for your own.`,
    );
  }
  if (!isBuiltinTarget(id)) {
    throw new CliError(
      `Unknown target "${id}". Known targets: hubspot-contacts, shopify-customers, shopify-products, xero-contacts.`,
    );
  }
  if (config?.target && config.target !== "custom" && config.target !== id) {
    throw new CliError(`Config target "${config.target}" does not match --target ${id}`);
  }
  return loadBuiltin(id);
}

function readConfig(flags: Map<string, string | boolean>, cwd: string): MappingConfig | null {
  const path = flagString(flags, "config");
  if (!path) return null;
  return loadMappingFile(resolve(cwd, path));
}

function readInput(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "ENOENT") {
      throw new CliError(`Input file not found: ${path}`);
    }
    throw err;
  }
}

function writeText(path: string, data: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(`Could not write ${path}: ${message}`);
  }
}

function readDelimiter(flags: Map<string, string | boolean>): string | undefined {
  const raw = flagString(flags, "delimiter");
  if (raw == null) return undefined;
  if (raw === "\\t" || raw === "tab") return "\t";
  if (raw.length !== 1) throw new CliError("Delimiter must be a single character (or tab)");
  return raw;
}

function reportFormat(path: string, explicit?: string): "html" | "json" {
  if (explicit != null) {
    if (explicit === "html" || explicit === "json") return explicit;
    throw new CliError('--format must be "html" or "json"');
  }
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".json")) return "json";
  throw new CliError("Report path must end in .html or .json, or pass --format html|json");
}

function optionalPath(flags: Map<string, string | boolean>, key: string, cwd: string): string | undefined {
  const value = flagString(flags, key);
  if (!value) return undefined;
  return resolve(cwd, value);
}

function requireFlag(flags: Map<string, string | boolean>, key: string): string {
  const value = flagString(flags, key);
  if (!value) throw new CliError(`Missing --${key}`);
  return value;
}

function flagString(flags: Map<string, string | boolean>, key: string): string | undefined {
  if (!flags.has(key)) return undefined;
  const value = flags.get(key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new CliError(`Missing value for --${key}`);
  }
  return value;
}

function rejectUnusedFlags(command: string, flags: Map<string, string | boolean>): void {
  const allowed = new Set(ALLOWED[command] ?? []);
  for (const key of flags.keys()) {
    if (key === "help" || key === "version") continue;
    if (!allowed.has(key)) {
      throw new CliError(`--${key} is not valid with ${command}`);
    }
  }
}

export function parseArgs(argv: string[]): { command: string | null; flags: Map<string, string | boolean> } {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      if (body === "") throw new CliError("Unknown flag --");
      const eq = body.indexOf("=");
      const rawKey = eq >= 0 ? body.slice(0, eq) : body;
      const key = ALIASES[rawKey] ?? rawKey;
      if (!KNOWN_FLAGS.has(key)) throw new CliError(`Unknown flag --${rawKey}`);
      if (eq >= 0) {
        flags.set(key, body.slice(eq + 1));
        continue;
      }
      if (BOOLEAN_FLAGS.has(key)) {
        flags.set(key, true);
        continue;
      }
      const next = argv[i + 1];
      if (next == null || next.startsWith("-")) throw new CliError(`Missing value for --${rawKey}`);
      flags.set(key, next);
      i++;
      continue;
    }
    if (arg.startsWith("-") && arg.length === 2) {
      const raw = arg[1]!;
      const key = ALIASES[raw] ?? raw;
      if (!KNOWN_FLAGS.has(key)) throw new CliError(`Unknown flag -${raw}`);
      if (BOOLEAN_FLAGS.has(key)) {
        flags.set(key, true);
        continue;
      }
      const next = argv[i + 1];
      if (next == null || next.startsWith("-")) throw new CliError(`Missing value for -${raw}`);
      flags.set(key, next);
      i++;
      continue;
    }
    if (arg.startsWith("-")) throw new CliError(`Unknown flag ${arg}`);
    positionals.push(arg);
  }
  if (positionals.length > 1) {
    throw new CliError(`Unexpected argument "${positionals[1]}"`);
  }
  return { command: positionals[0] ?? null, flags };
}
