import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadMappingFile, parseMappingConfig } from "../src/config.js";
import { CliError } from "../src/errors.js";
import { fixture } from "./helpers.js";

describe("mapping config", () => {
  it("parses the documented sketch without applying every transform", () => {
    const config = loadMappingFile(fixture("hubspot", "sketch.yaml"));
    assert.equal(config.target, "hubspot-contacts");
    assert.equal(config.auto, true);
    assert.equal(config.requiredFromTarget, true);
    assert.equal(config.vocabularySketch, true);
    assert.deepEqual(config.globalTransforms, []);
    assert.equal(config.columns.email?.source, "Email Address");
    assert.deepEqual(config.columns.email?.transforms, []);
    assert.deepEqual(config.columns.firstname?.transforms, ["trim"]);
    assert.equal(config.columns.lastname?.source, "Last Name");
  });

  it("parses a JSON config the same way as YAML", () => {
    const json = loadMappingFile(fixture("hubspot", "mapping.json"));
    const yaml = loadMappingFile(fixture("hubspot", "mapping.yaml"));
    assert.deepEqual(json, yaml);
  });

  it("chains a global transform list", () => {
    const config = parseMappingConfig({
      transforms: ["trim", "lower"],
      columns: { email: "Email" },
    });
    assert.deepEqual(config.globalTransforms, ["trim", "lower"]);
    assert.equal(config.vocabularySketch, false);
  });

  it("rejects an unknown transform and an empty source", () => {
    assert.throws(() => parseMappingConfig({ columns: { email: { source: "E", transform: "squash" } } }), CliError);
    assert.throws(() => parseMappingConfig({ columns: { email: "" } }), CliError);
  });
});
