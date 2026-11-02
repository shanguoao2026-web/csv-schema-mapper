import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTransforms,
  parseTransformSpec,
  transformDateIsoLoose,
  transformPhoneE164Loose,
} from "../src/transforms.js";
import { CliError } from "../src/errors.js";

describe("transforms", () => {
  it("trims, lowercases, and uppercases in order", () => {
    assert.equal(applyTransforms("  Ada@Example.COM ", ["trim", "lower"]), "ada@example.com");
    assert.equal(applyTransforms("ada", ["upper"]), "ADA");
  });

  it("formats loose phone numbers as E.164 and keeps short numbers", () => {
    assert.equal(transformPhoneE164Loose("(415) 555-2671"), "+14155552671");
    assert.equal(transformPhoneE164Loose("(415) 555-2671 x12"), "+14155552671");
    assert.equal(transformPhoneE164Loose("+1 703 555 0100"), "+17035550100");
    assert.equal(transformPhoneE164Loose("+44 20 7946 0958"), "+442079460958");
    assert.equal(transformPhoneE164Loose("0044 20 7946 0958"), "+442079460958");
    assert.equal(transformPhoneE164Loose("14155552671"), "+14155552671");
    assert.equal(transformPhoneE164Loose("  "), "");
    assert.equal(transformPhoneE164Loose("555"), "555");
    assert.equal(transformPhoneE164Loose("12"), "12");
  });

  it("parses loose dates into ISO dates and leaves impossible dates", () => {
    assert.equal(transformDateIsoLoose("2024-02-15"), "2024-02-15");
    assert.equal(transformDateIsoLoose("2024-02-15T10:30:00Z"), "2024-02-15");
    assert.equal(transformDateIsoLoose("2024/2/15"), "2024-02-15");
    assert.equal(transformDateIsoLoose("02/15/2024"), "2024-02-15");
    assert.equal(transformDateIsoLoose("02/15/2024 10:30 AM"), "2024-02-15");
    assert.equal(transformDateIsoLoose("15/02/2024"), "2024-02-15");
    assert.equal(transformDateIsoLoose("02/15/24"), "2024-02-15");
    assert.equal(transformDateIsoLoose("Jan 1 2020"), "2020-01-01");
    assert.equal(transformDateIsoLoose("Jan 1, 2020"), "2020-01-01");
    assert.equal(transformDateIsoLoose("1 Jan 2020"), "2020-01-01");
    assert.equal(transformDateIsoLoose("01-Jan-2020"), "2020-01-01");
    assert.equal(transformDateIsoLoose("2024-13-40"), "2024-13-40");
    assert.equal(transformDateIsoLoose("02/31/2024"), "02/31/2024");
    assert.equal(transformDateIsoLoose("not a date"), "not a date");
    assert.equal(transformDateIsoLoose(""), "");
  });

  it("treats the full pipe-separated vocabulary as documentation, not a pipeline", () => {
    const sketch = parseTransformSpec("trim | lower | upper | phone_e164_loose | date_iso_loose", "transforms");
    assert.equal(sketch.vocabularySketch, true);
    assert.deepEqual(sketch.names, []);
    const chain = parseTransformSpec("trim | lower", "transforms");
    assert.equal(chain.vocabularySketch, false);
    assert.deepEqual(chain.names, ["trim", "lower"]);
    assert.throws(() => parseTransformSpec("nope", "transforms"), CliError);
  });
});
