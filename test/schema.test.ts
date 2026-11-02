import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CliError } from "../src/errors.js";
import { BUILTIN_TARGET_IDS, listTargets, loadBuiltin, loadSchemaFile } from "../src/schema.js";
import { fixture } from "./helpers.js";

describe("schemas", () => {
  it("loads four built-in targets with the expected required fields", () => {
    const targets = listTargets();
    assert.deepEqual(
      targets.map((schema) => schema.id),
      [...BUILTIN_TARGET_IDS],
    );
    const required = Object.fromEntries(
      targets.map((schema) => [schema.id, schema.fields.filter((field) => field.required).map((field) => field.id)]),
    );
    assert.deepEqual(required, {
      "hubspot-contacts": ["email"],
      "shopify-customers": ["email"],
      "shopify-products": ["handle", "title"],
      "xero-contacts": ["contact_name"],
    });
    assert.ok(targets.every((schema) => schema.fields.length >= 16));
    for (const schema of targets) {
      const ids = new Set(schema.fields.map((field) => field.id));
      const headers = new Set(schema.fields.map((field) => field.header));
      assert.equal(ids.size, schema.fields.length);
      assert.equal(headers.size, schema.fields.length);
    }
    const lifecycle = loadBuiltin("hubspot-contacts").fields.find((field) => field.id === "lifecyclestage");
    assert.ok(lifecycle?.enumValues?.includes("marketingqualifiedlead"));
    const status = loadBuiltin("shopify-products").fields.find((field) => field.id === "status");
    assert.deepEqual(status?.enumValues, ["active", "draft", "archived"]);
  });

  it("loads a custom schema file", () => {
    const schema = loadSchemaFile(fixture("custom", "schema.yaml"));
    assert.equal(schema.id, "acme-leads");
    assert.equal(schema.fields.length, 3);
    assert.equal(schema.fields[2]?.type, "integer");
  });

  it("rejects an unknown target with the known ids", () => {
    assert.throws(() => loadBuiltin("hubspot"), (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.match(err.message, /hubspot-contacts/);
      assert.match(err.message, /xero-contacts/);
      return true;
    });
  });
});
