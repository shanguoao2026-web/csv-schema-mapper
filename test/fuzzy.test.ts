import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTO_MATCH_THRESHOLD,
  LOW_CONFIDENCE_BELOW,
  autoAssign,
  damerauLevenshtein,
  normalize,
  scoreHeader,
} from "../src/fuzzy.js";
import { loadBuiltin } from "../src/schema.js";
import type { SchemaField } from "../src/types.js";

function field(partial: Partial<SchemaField> & Pick<SchemaField, "id">): SchemaField {
  return {
    header: partial.header ?? partial.id,
    label: partial.label ?? partial.id,
    type: partial.type ?? "string",
    required: partial.required ?? false,
    synonyms: partial.synonyms ?? [],
    ...partial,
  };
}

describe("fuzzy header matching", () => {
  it("counts an adjacent transposition as one edit", () => {
    assert.equal(damerauLevenshtein("frist", "first"), 1);
    assert.equal(damerauLevenshtein("frist name", "first name"), 1);
    assert.equal(damerauLevenshtein("email", "email"), 0);
    assert.equal(damerauLevenshtein("cat", "dog"), 3);
  });

  it("normalizes case, accents, and punctuation", () => {
    assert.equal(normalize("  E-mail_Address "), "e mail address");
    assert.equal(normalize("José"), "jose");
    assert.equal(normalize("First Name"), "first name");
    assert.equal(normalize("first_name"), "first name");
  });

  it("scores City / Town and related locality headers as city synonyms", () => {
    const headers = ["City / Town", "City/Town", "Town/City", "Town", "Municipality", "Locality"];
    for (const target of ["hubspot-contacts", "shopify-customers"] as const) {
      const city = loadBuiltin(target).fields.find((item) => item.id === "city");
      assert.ok(city, target);
      for (const header of headers) {
        const scored = scoreHeader(header, city);
        assert.equal(scored.method, "synonym", `${target} ${header}`);
        assert.ok(scored.score >= 0.9, `${target} ${header} scored ${scored.score}`);
      }
    }
  });

  it("scores Email Address as a synonym of the HubSpot email field", () => {
    const email = loadBuiltin("hubspot-contacts").fields.find((item) => item.id === "email");
    assert.ok(email);
    const scored = scoreHeader("Email Address", email);
    assert.equal(scored.method, "synonym");
    assert.equal(scored.score, 1);
  });

  it("scores Frist Name as a fuzzy match inside the auto band and below high confidence", () => {
    const first = loadBuiltin("hubspot-contacts").fields.find((item) => item.id === "firstname");
    assert.ok(first);
    const scored = scoreHeader("Frist Name", first);
    assert.equal(scored.method, "fuzzy");
    assert.ok(scored.score >= AUTO_MATCH_THRESHOLD);
    assert.ok(scored.score < LOW_CONFIDENCE_BELOW);
    assert.equal(scored.score, 0.9);
  });

  it("does not treat Email Address as the street address field", () => {
    const address = loadBuiltin("hubspot-contacts").fields.find((item) => item.id === "address");
    assert.ok(address);
    const scored = scoreHeader("Email Address", address);
    assert.equal(scored.method, "none");
    assert.ok(scored.score < AUTO_MATCH_THRESHOLD);
  });

  it("assigns each source header once and keeps Country Code off Country", () => {
    const fields = [
      field({ id: "email", type: "email", synonyms: ["email address"] }),
      field({ id: "address", label: "Street Address", synonyms: ["street address", "street"] }),
      field({ id: "firstname", label: "First Name", synonyms: ["first name", "first"] }),
      field({ id: "country", label: "Country", synonyms: ["country name"] }),
      field({ id: "country_code", header: "country_code", label: "Country Code", synonyms: ["iso country"] }),
    ];
    const headers = ["Email Address", "Frist Name", "Country Code"];
    const assigned = autoAssign(headers, fields, new Set(), new Set());
    const byField = new Map(assigned.map((item) => [fields[item.fieldIndex]!.id, headers[item.sourceIndex]]));
    assert.equal(byField.get("email"), "Email Address");
    assert.equal(byField.get("firstname"), "Frist Name");
    assert.equal(byField.get("country_code"), "Country Code");
    assert.equal(byField.has("country"), false);
    assert.equal(byField.has("address"), false);
    assert.equal(new Set(assigned.map((item) => item.sourceIndex)).size, assigned.length);
  });
});
