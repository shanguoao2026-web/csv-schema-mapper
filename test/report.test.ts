import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapCsvText } from "../src/mapping.js";
import { buildReport, escapeHtml, renderHtmlReport, renderJsonReport } from "../src/report.js";
import { loadBuiltin } from "../src/schema.js";

describe("reports", () => {
  it("writes a JSON report with confidence and issues", () => {
    const schema = loadBuiltin("hubspot-contacts");
    const result = mapCsvText("Frist Name,Email Address\nAda,not-an-email\n", schema, null);
    const report = buildReport(result, {
      command: "map",
      version: "0.1.0",
      generatedAt: "2026-11-02T00:00:00.000Z",
      inputPath: "messy.csv",
      outputPath: "out.csv",
      reportPath: "report.json",
    });
    const json = JSON.parse(renderJsonReport(report)) as {
      tool: string;
      summary: { ok: boolean; errorCount: number };
      mapping: Array<{ target: string; confidence: number; method: string }>;
      samples: Array<{ row: number }>;
    };
    assert.equal(json.tool, "csv-schema-mapper");
    assert.equal(json.summary.ok, false);
    assert.ok(json.summary.errorCount >= 1);
    const first = json.mapping.find((column) => column.target === "firstname");
    assert.equal(first?.method, "fuzzy");
    assert.equal(first?.confidence, 0.9);
    assert.equal(json.samples[0]?.row, 1);
    assert.match(renderJsonReport(report), /"generatedAt": "2026-11-02T00:00:00.000Z"/);
  });

  it("escapes unsafe values in the HTML report", () => {
    const schema = loadBuiltin("hubspot-contacts");
    const payload = "<script>alert(1)</script>";
    const result = mapCsvText(`Email Address\n"${payload}"\n`, schema, null);
    const report = buildReport(result, {
      command: "map",
      version: "0.1.0",
      generatedAt: "2026-11-02T00:00:00.000Z",
      inputPath: null,
      outputPath: "out.csv",
      reportPath: "report.html",
    });
    const html = renderHtmlReport(report);
    assert.match(html, /csv-schema-mapper/);
    assert.match(html, /hubspot-contacts/);
    assert.match(html, /Column matches/);
    assert.match(html, /Sample bad rows/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal(html.includes(payload), false);
    assert.equal(escapeHtml(`&<>"`), "&amp;&lt;&gt;&quot;");
  });
});
