import type { Issue, Report, ReportMeta, TabularResult } from "./types.js";

const ISSUE_LIMIT = 1000;

export function buildReport(result: TabularResult, meta: ReportMeta): Report {
  const issues = result.issues.slice(0, ISSUE_LIMIT);
  return {
    tool: "csv-schema-mapper",
    version: meta.version,
    command: meta.command,
    generatedAt: meta.generatedAt,
    input: {
      path: meta.inputPath,
      headers: result.inputHeaders,
      rows: result.summary.inputRows,
      delimiter: result.delimiter,
    },
    output: {
      path: meta.outputPath,
      headers: result.outputHeaders,
    },
    target: {
      id: result.schema.id,
      name: result.schema.name,
    },
    summary: result.summary,
    mapping: result.matches.map((match) => ({
      target: match.targetId,
      header: match.outputHeader,
      label: match.label,
      source: match.sourceHeader,
      method: match.method,
      confidence: match.confidence,
      transforms: match.transforms,
      required: match.required,
    })),
    issues,
    samples: result.samples,
    issuesTruncated: result.issues.length > ISSUE_LIMIT,
  };
}

export function renderJsonReport(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderHtmlReport(report: Report): string {
  const badge = report.summary.ok
    ? report.summary.warningCount > 0
      ? ["Warnings", "warn"]
      : ["Passed", "ok"]
    : ["Failed", "bad"];
  const stats = [
    ["Input rows", String(report.summary.inputRows)],
    ["Valid rows", String(report.summary.validRows)],
    ["Errors", String(report.summary.errorCount)],
    ["Warnings", String(report.summary.warningCount)],
  ];
  const missing =
    report.summary.missingRequired.length > 0
      ? `<p class="callout bad">Missing required fields: ${report.summary.missingRequired.map(escapeHtml).join(", ")}</p>`
      : "";
  const shownIssues = report.issues.slice(0, 200);
  const issueNote =
    report.issues.length > shownIssues.length
      ? `<p class="muted">Showing ${shownIssues.length} of ${report.issues.length} issues.</p>`
      : "";
  const badRowCount = new Set(report.issues.filter((issue) => issue.severity === "error" && issue.row != null).map((issue) => issue.row)).size;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>csv-schema-mapper report — ${escapeHtml(report.target.id)}</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #ffffff;
      --text: #1c2430;
      --muted: #5c6b7a;
      --line: #e2e8f0;
      --accent: #1d4e89;
      --ok: #166534;
      --okbg: #f0fdf4;
      --warn: #92400e;
      --warnbg: #fffbeb;
      --bad: #9f1239;
      --badbg: #fff1f2;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 "Segoe UI", Helvetica, Arial, sans-serif; }
    main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
    header.top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 20px; }
    h1 { font-size: 1.55rem; margin: 0 0 4px; }
    h2 { font-size: 1.05rem; margin: 28px 0 10px; }
    .muted { color: var(--muted); }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-weight: 650; font-size: 0.85rem; }
    .badge.ok { background: var(--okbg); color: var(--ok); }
    .badge.warn { background: var(--warnbg); color: var(--warn); }
    .badge.bad { background: var(--badbg); color: var(--bad); }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .stat { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
    .stat b { display: block; font-size: 1.35rem; }
    .stat span { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { font-size: 0.72rem; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); background: #f8fafc; }
    tr.low td { background: var(--warnbg); }
    .callout { border-radius: 10px; padding: 10px 12px; }
    .callout.bad { background: var(--badbg); color: var(--bad); }
    .conf { height: 8px; width: 88px; background: #e5e7eb; border-radius: 99px; display: inline-block; vertical-align: middle; margin-right: 6px; }
    .conf > span { display: block; height: 100%; background: var(--accent); border-radius: 99px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }
    dl { display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; margin: 0 0 8px; }
    dt { color: var(--muted); }
    dd { margin: 0; }
    footer { margin-top: 28px; color: var(--muted); font-size: 0.85rem; }
    @media (max-width: 720px) {
      .stats { grid-template-columns: 1fr 1fr; }
      dl { grid-template-columns: 1fr; }
      header.top { flex-direction: column; }
    }
  </style>
</head>
<body>
<main>
  <header class="top">
    <div>
      <h1>csv-schema-mapper</h1>
      <div class="muted">${escapeHtml(report.command)} · ${escapeHtml(report.target.name)}</div>
    </div>
    <div class="badge ${badge[1]}">${badge[0]}</div>
  </header>
  <dl>
    <dt>Target</dt><dd><code>${escapeHtml(report.target.id)}</code></dd>
    <dt>Generated</dt><dd>${escapeHtml(report.generatedAt)}</dd>
    <dt>Input</dt><dd>${escapeHtml(report.input.path ?? "(stdin)")} · ${report.input.rows} rows · delimiter ${escapeHtml(delimiterLabel(report.input.delimiter))}</dd>
    <dt>Output</dt><dd>${escapeHtml(report.output.path ?? "(not written)")}</dd>
  </dl>
  <section class="stats">
    ${stats.map(([label, value]) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`).join("")}
  </section>
  ${missing}
  <h2>Column matches</h2>
  <div class="card">
    <table>
      <thead><tr><th>Target</th><th>Output header</th><th>Source</th><th>Method</th><th>Confidence</th><th>Transforms</th></tr></thead>
      <tbody>
        ${report.mapping
          .map((column) => {
            const low = column.method === "fuzzy" && column.confidence < 0.92;
            const width = Math.max(0, Math.min(100, Math.round(column.confidence * 100)));
            return `<tr class="${low ? "low" : ""}">
              <td><code>${escapeHtml(column.target)}</code>${column.required ? " *" : ""}</td>
              <td>${escapeHtml(column.header)}</td>
              <td>${column.source ? escapeHtml(column.source) : '<span class="muted">—</span>'}</td>
              <td>${escapeHtml(column.method)}</td>
              <td><span class="conf"><span style="width:${width}%"></span></span>${column.confidence.toFixed(2)}</td>
              <td>${column.transforms.length ? escapeHtml(column.transforms.join(", ")) : '<span class="muted">—</span>'}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  </div>
  <p class="muted">* required field. Confidence is 1.00 for explicit and exact matches.</p>
  <h2>Issues</h2>
  ${issueNote}
  ${
    shownIssues.length === 0
      ? '<p class="muted">No issues.</p>'
      : `<div class="card"><table>
          <thead><tr><th>Severity</th><th>Code</th><th>Row</th><th>Field</th><th>Message</th></tr></thead>
          <tbody>${shownIssues.map(issueRow).join("")}</tbody>
        </table></div>`
  }
  <h2>Sample bad rows</h2>
  ${
    report.samples.length === 0
      ? '<p class="muted">No bad rows.</p>'
      : report.samples.map(sampleBlock).join("")
  }
  ${
    badRowCount > report.samples.length
      ? `<p class="muted">Showing ${report.samples.length} of ${badRowCount} bad rows.</p>`
      : ""
  }
  <footer>Generated by csv-schema-mapper ${escapeHtml(report.version)}. Mapping report for ${escapeHtml(report.target.id)}.</footer>
</main>
</body>
</html>
`;
}

function issueRow(issue: Issue): string {
  return `<tr>
    <td>${escapeHtml(issue.severity)}</td>
    <td><code>${escapeHtml(issue.code)}</code></td>
    <td>${issue.row ?? ""}</td>
    <td>${issue.field ? `<code>${escapeHtml(issue.field)}</code>` : ""}</td>
    <td>${escapeHtml(issue.message)}</td>
  </tr>`;
}

function sampleBlock(sample: { row: number; messages: string[]; output: Record<string, string> }): string {
  const cells = Object.entries(sample.output)
    .map(([key, value]) => `<tr><th scope="row"><code>${escapeHtml(key)}</code></th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  return `<section>
    <h3>Row ${sample.row}</h3>
    <ul>${sample.messages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul>
    <div class="card"><table>${cells}</table></div>
  </section>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function delimiterLabel(delimiter: string): string {
  if (delimiter === "\t") return "tab";
  if (delimiter === " ") return "space";
  return delimiter;
}

export function formatIssueLine(issue: Issue): string {
  const where = issue.row != null ? `row ${issue.row}: ` : "";
  return `${issue.severity} ${issue.code} ${where}${issue.message}`;
}

export function formatResultText(
  command: "map" | "validate",
  result: TabularResult,
  paths: { output?: string; report?: string },
): { stdout: string; stderr: string } {
  const verb = command === "map" ? "Mapped" : "Validated";
  const lines = [
    `${verb} ${result.summary.outputRows} row${result.summary.outputRows === 1 ? "" : "s"} ${command === "map" ? "to" : "against"} ${result.schema.id}${paths.output ? ` → ${paths.output}` : ""}`,
    `Errors: ${result.summary.errorCount}  Warnings: ${result.summary.warningCount}  Valid rows: ${result.summary.validRows}`,
  ];
  if (paths.report) lines.push(`Report: ${paths.report}`);
  const limit = 20;
  const shown = result.issues.slice(0, limit).map(formatIssueLine);
  if (result.issues.length > limit) {
    const extra = result.issues.length - limit;
    shown.push(paths.report ? `… ${extra} more issues in the report` : `… ${extra} more issues not shown`);
  }
  return {
    stdout: `${lines.join("\n")}\n`,
    stderr: shown.length ? `${shown.join("\n")}\n` : "",
  };
}
