import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";
import { toCsv } from "../src/csv.js";
import { loadMappingFile } from "../src/config.js";
import { CliError } from "../src/errors.js";
import { mapCsvText, validateCsvText } from "../src/mapping.js";
import { loadBuiltin, loadSchemaFile } from "../src/schema.js";
import { suggestMappingYaml } from "../src/suggest.js";
import { parseCsv } from "../src/csv.js";
import { fixture, readFixture } from "./helpers.js";

function mapFixture(dir: string, target: string) {
  const schema = loadBuiltin(target);
  const config = loadMappingFile(fixture(dir, "mapping.yaml"));
  const result = mapCsvText(readFixture(dir, "messy.csv"), schema, config);
  return { schema, result };
}

describe("map and validate", () => {
  it("maps the HubSpot fixture to the expected CSV", () => {
    const { schema, result } = mapFixture("hubspot", "hubspot-contacts");
    assert.equal(toCsv(result.outputHeaders, result.rows), readFixture("hubspot", "expected.csv"));
    assert.deepEqual(
      result.outputHeaders,
      schema.fields.map((field) => field.header),
    );
    const email = result.matches.find((match) => match.targetId === "email");
    assert.equal(email?.method, "explicit");
    assert.equal(email?.confidence, 1);
    assert.deepEqual(email?.transforms, ["trim", "lower"]);
    const company = result.matches.find((match) => match.targetId === "company");
    assert.equal(company?.sourceHeader, "Company Name");
    assert.equal(company?.method, "exact");
    assert.equal(result.summary.validRows, 1);
    assert.equal(result.summary.ok, false);
    assert.deepEqual(
      result.issues.map((issue) => `${issue.row ?? "-"}:${issue.field ?? "-"}:${issue.code}`),
      [
        "2:email:type_mismatch",
        "2:phone:type_mismatch",
        "2:website:type_mismatch",
        "2:createdate:type_mismatch",
        "3:email:empty_required",
      ],
    );
  });

  it("maps the same HubSpot CSV from the JSON config", () => {
    const schema = loadBuiltin("hubspot-contacts");
    const config = loadMappingFile(fixture("hubspot", "mapping.json"));
    const result = mapCsvText(readFixture("hubspot", "messy.csv"), schema, config);
    assert.equal(toCsv(result.outputHeaders, result.rows), readFixture("hubspot", "expected.csv"));
  });

  it("does not apply the pipe-separated vocabulary sketch as transforms", () => {
    const schema = loadBuiltin("hubspot-contacts");
    const config = loadMappingFile(fixture("hubspot", "sketch.yaml"));
    const result = mapCsvText(readFixture("hubspot", "messy.csv"), schema, config);
    assert.equal(result.rows[0]?.[0], "  Ada@Example.com ");
    assert.equal(result.rows[0]?.[1], "Ada");
    assert.ok(result.issues.some((issue) => issue.code === "transforms_note"));
  });

  it("maps Shopify customers, Shopify products, and Xero contacts", () => {
    const shoppers = mapFixture("shopify-customers", "shopify-customers");
    assert.equal(toCsv(shoppers.result.outputHeaders, shoppers.result.rows), readFixture("shopify-customers", "expected.csv"));
    assert.deepEqual(
      shoppers.result.issues.map((issue) => `${issue.row}:${issue.field}:${issue.code}`),
      ["2:email:type_mismatch", "2:phone:type_mismatch"],
    );

    const products = mapFixture("shopify-products", "shopify-products");
    assert.equal(toCsv(products.result.outputHeaders, products.result.rows), readFixture("shopify-products", "expected.csv"));
    assert.deepEqual(
      products.result.issues.map((issue) => `${issue.row}:${issue.field}:${issue.code}`),
      ["2:handle:empty_required", "2:variant_price:type_mismatch", "2:status:type_mismatch"],
    );

    const xero = mapFixture("xero", "xero-contacts");
    assert.equal(toCsv(xero.result.outputHeaders, xero.result.rows), readFixture("xero", "expected.csv"));
    assert.deepEqual(
      xero.result.issues.map((issue) => `${issue.row}:${issue.field}:${issue.code}`),
      ["2:contact_name:empty_required", "2:email:type_mismatch", "2:phone:type_mismatch"],
    );
  });

  it("maps a custom schema", () => {
    const schema = loadSchemaFile(fixture("custom", "schema.yaml"));
    const config = loadMappingFile(fixture("custom", "mapping.yaml"));
    const result = mapCsvText(readFixture("custom", "messy.csv"), schema, config);
    assert.equal(toCsv(result.outputHeaders, result.rows), readFixture("custom", "expected.csv"));
    assert.equal(result.summary.errorCount, 3);
    assert.equal(result.samples[0]?.row, 2);
    assert.equal(result.samples[0]?.output.score, "x");
  });

  it("keeps auto false from pulling in extra columns", () => {
    const schema = loadBuiltin("hubspot-contacts");
    const config = loadMappingFile(fixture("hubspot", "mapping.yaml"));
    config.auto = false;
    const result = mapCsvText(readFixture("hubspot", "messy.csv"), schema, config);
    const company = result.matches.find((match) => match.targetId === "company");
    assert.equal(company?.sourceIndex, null);
    assert.equal(result.rows[0]?.[5], "");
    assert.ok(result.issues.some((issue) => issue.code === "unmapped_source" && issue.source === "Company Name"));
  });

  it("auto-matches when no config is provided and does not invent transforms", () => {
    const schema = loadBuiltin("hubspot-contacts");
    const result = mapCsvText("Email Address,First\n  Ada@Example.com ,Ada\n", schema, null);
    const email = result.matches.find((match) => match.targetId === "email");
    assert.equal(email?.sourceHeader, "Email Address");
    assert.deepEqual(email?.transforms, []);
    assert.equal(result.rows[0]?.[0], "  Ada@Example.com ");
  });

  it("downgrades missing required fields when required_from_target is false", () => {
    const schema = loadBuiltin("hubspot-contacts");
    const result = mapCsvText("First\nAda\n", schema, {
      auto: false,
      requiredFromTarget: false,
      globalTransforms: [],
      vocabularySketch: false,
      columns: { firstname: { source: "First", transforms: ["trim"] } },
    });
    const missing = result.issues.filter((issue) => issue.code === "missing_required");
    assert.ok(missing.length >= 1);
    assert.ok(missing.every((issue) => issue.severity === "warning"));
    assert.equal(result.summary.ok, true);
    assert.deepEqual(result.summary.missingRequired, []);
  });

  it("rejects an unknown target field and a source used twice", () => {
    const schema = loadBuiltin("hubspot-contacts");
    assert.throws(
      () =>
        mapCsvText("Email\na@b.co\n", schema, {
          auto: false,
          globalTransforms: [],
          vocabularySketch: false,
          columns: { not_a_field: { source: "Email", transforms: [] } },
        }),
      /Unknown target field/,
    );
    assert.throws(
      () =>
        mapCsvText("Email\na@b.co\n", schema, {
          auto: false,
          globalTransforms: [],
          vocabularySketch: false,
          columns: {
            email: { source: "Email", transforms: [] },
            firstname: { source: "Email", transforms: [] },
          },
        }),
      (err: unknown) => err instanceof CliError && /more than one/.test(err.message),
    );
  });

  it("warns on a low-confidence fuzzy match", () => {
    const schema = loadBuiltin("hubspot-contacts");
    const result = mapCsvText("Frist Name\nAda\n", schema, null);
    const first = result.matches.find((match) => match.targetId === "firstname");
    assert.equal(first?.method, "fuzzy");
    assert.equal(first?.confidence, 0.9);
    const warning = result.issues.find((issue) => issue.code === "low_confidence");
    assert.equal(warning?.severity, "warning");
    assert.equal(warning?.field, "firstname");
  });

  it("applies global transforms after column transforms", () => {
    const schema = loadBuiltin("hubspot-contacts");
    const result = mapCsvText("Email Address\n  Ada@Example.COM \n", schema, {
      auto: false,
      globalTransforms: ["lower"],
      vocabularySketch: false,
      columns: { email: { source: "Email Address", transforms: ["trim"] } },
    });
    assert.equal(result.rows[0]?.[0], "ada@example.com");
  });

  it("quotes commas when a mapped value contains one", () => {
    const schema = loadBuiltin("hubspot-contacts");
    const result = mapCsvText('Company Name\n"Acme, Inc."\n', schema, {
      auto: false,
      requiredFromTarget: false,
      globalTransforms: [],
      vocabularySketch: false,
      columns: { company: { source: "Company Name", transforms: [] } },
    });
    assert.match(toCsv(result.outputHeaders, result.rows), /"Acme, Inc."/);
  });

  it("warns when a data row has extra values and when the file has no data rows", () => {
    const schema = loadSchemaFile(fixture("custom", "schema.yaml"));
    const wide = mapCsvText("E-mail,Name,Points\na@b.co,Ada,1,zzz\n", schema, {
      auto: false,
      requiredFromTarget: true,
      globalTransforms: [],
      vocabularySketch: false,
      columns: {
        email: { source: "E-mail", transforms: [] },
        full_name: { source: "Name", transforms: [] },
        score: { source: "Points", transforms: [] },
      },
    });
    assert.ok(wide.issues.some((issue) => issue.code === "extra_values" && issue.row === 1));
    assert.equal(wide.summary.ok, true);

    const empty = mapCsvText("E-mail\n", schema, null);
    assert.ok(empty.issues.some((issue) => issue.code === "empty_input"));
  });

  it("validates a clean HubSpot file and rejects a file that is not in the target shape", () => {
    const schema = loadBuiltin("hubspot-contacts");
    const clean = validateCsvText(readFixture("hubspot", "clean.csv"), schema);
    assert.equal(clean.summary.ok, true);
    assert.equal(clean.summary.errorCount, 0);
    assert.equal(clean.rows[0]?.[0], "ada@example.com");

    const invalid = validateCsvText(readFixture("hubspot", "invalid.csv"), schema);
    assert.equal(invalid.summary.ok, false);
    assert.ok(invalid.issues.some((issue) => issue.code === "missing_required" && issue.field === "email"));
    assert.ok(invalid.issues.some((issue) => issue.code === "type_mismatch" && issue.field === "phone"));

    const messy = validateCsvText(readFixture("hubspot", "messy.csv"), schema);
    assert.ok(messy.issues.some((issue) => issue.code === "missing_required" && issue.field === "email"));
    assert.ok(messy.issues.some((issue) => issue.code === "unknown_column"));
    assert.equal(
      messy.matches.find((match) => match.targetId === "email")?.sourceIndex,
      null,
    );
  });

  it("checks enums, booleans, numbers, integers, and URLs", () => {
    const products = loadBuiltin("shopify-products");
    const ok = validateCsvText("Handle,Title,Status,Published,Variant Price,Variant Inventory Qty,Image Src\nwidget,Widget,Active,yes,\"$1,234.50\",1,https://cdn.example/a.png\n", products);
    assert.equal(ok.summary.ok, true, ok.issues.map((issue) => issue.message).join("; "));

    const bad = validateCsvText(
      "Handle,Title,Status,Published,Variant Price,Variant Inventory Qty,Image Src\nwidget,Widget,nope,maybe,abc,1.5,not a url\n",
      products,
    );
    const codes = bad.issues.filter((issue) => issue.code === "type_mismatch").map((issue) => issue.field);
    assert.deepEqual(codes.sort(), ["image_src", "published", "status", "variant_inventory_qty", "variant_price"].sort());
  });

  it("suggests YAML that names real source headers and default transforms", () => {
    const schema = loadBuiltin("hubspot-contacts");
    const parsed = parseCsv(readFixture("hubspot", "messy.csv"));
    const yaml = suggestMappingYaml({
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      schema,
      config: null,
    });
    const doc = parseYaml(yaml) as { target: string; auto: boolean; columns: Record<string, { source: string; transform: unknown }> };
    assert.equal(doc.target, "hubspot-contacts");
    assert.equal(doc.auto, false);
    assert.equal(doc.columns.email?.source, "Email Address");
    assert.deepEqual(doc.columns.email?.transform, ["trim", "lower"]);
    assert.equal(doc.columns.firstname?.source, "First");
    assert.equal(doc.columns.phone?.source, "Tel");
    assert.equal(doc.columns.company?.source, "Company Name");
    assert.equal(doc.columns.mobilephone, undefined);
    assert.match(yaml, /Unmapped target fields/);
    assert.match(yaml, /mobilephone \(mobilephone\)/);
  });

  it("suggests Shopify customer headers from a messy export", () => {
    const schema = loadBuiltin("shopify-customers");
    const parsed = parseCsv(readFixture("shopify-customers", "messy.csv"));
    const yaml = suggestMappingYaml({ headers: parsed.headers, rowCount: parsed.rows.length, schema, config: null });
    const doc = parseYaml(yaml) as { columns: Record<string, { source: string }> };
    assert.equal(doc.columns.email?.source, "Customer Email");
    assert.equal(doc.columns.first_name?.source, "Given Name");
    assert.equal(doc.columns.last_name?.source, "Surname");
    assert.equal(doc.columns.company?.source, "Business");
    assert.equal(doc.columns.phone?.source, "Cell");
    assert.equal(doc.columns.accepts_email_marketing?.source, "Marketing Opt In");
  });
});
