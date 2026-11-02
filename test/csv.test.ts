import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CliError } from "../src/errors.js";
import { parseCsv, toCsv } from "../src/csv.js";

describe("csv", () => {
  it("parses quoted commas, escaped quotes, and embedded newlines", () => {
    const parsed = parseCsv('name,note\n"Ada, Countess","She said ""hello""\nnext line"\n');
    assert.deepEqual(parsed.headers, ["name", "note"]);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0]![0], "Ada, Countess");
    assert.equal(parsed.rows[0]![1], 'She said "hello"\nnext line');
    assert.equal(parsed.delimiter, ",");
  });

  it("strips a BOM and accepts CRLF", () => {
    const parsed = parseCsv("\uFEFFa,b\r\n1,2\r\n");
    assert.deepEqual(parsed.headers, ["a", "b"]);
    assert.deepEqual(parsed.rows, [["1", "2"]]);
  });

  it("parses a file that does not end with a newline", () => {
    assert.deepEqual(parseCsv("a,b\n1,2").rows, [["1", "2"]]);
  });

  it("detects semicolon and tab delimiters", () => {
    const semi = parseCsv('name;note\n"Ada; Lovelace";ok\n');
    assert.equal(semi.delimiter, ";");
    assert.deepEqual(semi.headers, ["name", "note"]);
    assert.equal(semi.rows[0]![0], "Ada; Lovelace");
    const tab = parseCsv("a\tb\n1\t2\n");
    assert.equal(tab.delimiter, "\t");
    assert.deepEqual(tab.rows, [["1", "2"]]);
  });

  it("skips blank lines and ignores a trailing empty extra cell", () => {
    const parsed = parseCsv("a,b\n\n1,2,\n\n3,4\n");
    assert.deepEqual(parsed.rows, [
      ["1", "2"],
      ["3", "4"],
    ]);
    assert.deepEqual(parsed.extraValueRows, []);
  });

  it("records extra non-empty cells", () => {
    const parsed = parseCsv("a,b\n1,2,3\n");
    assert.deepEqual(parsed.rows, [["1", "2"]]);
    assert.deepEqual(parsed.extraValueRows, [1]);
  });

  it("rejects duplicate and empty headers", () => {
    assert.throws(() => parseCsv("Email,email\n1,2\n"), (err: unknown) => err instanceof CliError && /Duplicate/.test(err.message));
    assert.throws(() => parseCsv("a,\n1,2\n"), /empty column/);
    assert.throws(() => parseCsv("   \n"), /empty/i);
    assert.throws(() => parseCsv('"unterminated\n'), /unclosed/i);
  });

  it("round-trips fields that need quotes", () => {
    const headers = ["name", "note"];
    const rows = [["Acme, Inc.", 'say "hi"']];
    const csv = toCsv(headers, rows);
    assert.equal(csv, 'name,note\n"Acme, Inc.","say ""hi"""\n');
    assert.deepEqual(parseCsv(csv).rows, rows);
  });
});
