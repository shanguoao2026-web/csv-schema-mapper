import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { main } from "../src/main.js";
import { fixture, readFixture, removeDir, root, tempDir } from "./helpers.js";

function run(args: string[], cwd?: string) {
  return main(args, cwd ? { cwd, generatedAt: "2026-11-02T00:00:00.000Z" } : { generatedAt: "2026-11-02T00:00:00.000Z" });
}

describe("cli", () => {
  it("prints targets and JSON", () => {
    const text = run(["list-targets"]);
    assert.equal(text.code, 0);
    assert.match(text.stdout, /hubspot-contacts/);
    assert.match(text.stdout, /shopify-customers/);
    assert.match(text.stdout, /shopify-products/);
    assert.match(text.stdout, /xero-contacts/);
    const json = run(["list-targets", "--json"]);
    const parsed = JSON.parse(json.stdout) as Array<{ id: string }>;
    assert.equal(parsed.length, 4);
  });

  it("maps a messy HubSpot file, writes both outputs, and exits 1", () => {
    const dir = tempDir();
    try {
      const result = run([
        "map",
        `--in=${fixture("hubspot", "messy.csv")}`,
        "--target",
        "hubspot-contacts",
        "--config",
        fixture("hubspot", "mapping.yaml"),
        "--out",
        "out.csv",
        "--report",
        "report.html",
      ], dir);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /Errors: 5/);
      assert.equal(readFileSync(join(dir, "out.csv"), "utf8"), readFixture("hubspot", "expected.csv"));
      const html = readFileSync(join(dir, "report.html"), "utf8");
      assert.match(html, /hubspot-contacts/);
      assert.match(html, /type_mismatch/);
      assert.match(result.stderr, /type_mismatch/);
    } finally {
      removeDir(dir);
    }
  });

  it("exits 0 when the mapped file is valid", () => {
    const dir = tempDir();
    try {
      const schema = join(dir, "schema.yaml");
      const input = join(dir, "in.csv");
      write(schema, "id: plain\nname: Plain\nfields:\n  - id: name\n    header: Name\n    type: string\n    required: true\n");
      write(input, "Name\nAda\n");
      const result = run(["map", "--in", input, "--target", "custom", "--schema", schema, "--out", join(dir, "out.csv")]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(readFileSync(join(dir, "out.csv"), "utf8"), /Ada/);
      assert.equal(result.stderr, "");
    } finally {
      removeDir(dir);
    }
  });

  it("exits 2 for missing arguments, unknown commands, and overwrite attempts", () => {
    const missing = run(["map", "--in", fixture("hubspot", "clean.csv"), "--target", "hubspot-contacts"]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /Missing --out/);

    const unknown = run(["frobnicate"]);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /unknown command/);

    const same = run([
      "map",
      "--in",
      fixture("hubspot", "clean.csv"),
      "--out",
      fixture("hubspot", "clean.csv"),
      "--target",
      "hubspot-contacts",
    ]);
    assert.equal(same.code, 2);
    assert.match(same.stderr, /Refusing to overwrite/);

    const badTarget = run(["validate", "--in", fixture("hubspot", "clean.csv"), "--target", "nope"]);
    assert.equal(badTarget.code, 2);
    assert.match(badTarget.stderr, /Unknown target/);
  });

  it("suggest prints YAML only and writes no files", () => {
    const dir = tempDir();
    try {
      const result = run(["suggest", "--in", fixture("hubspot", "messy.csv"), "--target", "hubspot-contacts"], dir);
      assert.equal(result.code, 0);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /^# Suggested by csv-schema-mapper/);
      assert.match(result.stdout, /source: "Email Address"/);
      assert.equal(existsSync(join(dir, "out.csv")), false);
      const rejected = run(["suggest", "--in", fixture("hubspot", "messy.csv"), "--target", "hubspot-contacts", "--out", "x.csv"]);
      assert.equal(rejected.code, 2);
      assert.match(rejected.stderr, /not valid with suggest/);
    } finally {
      removeDir(dir);
    }
  });

  it("validate exits 0 for a clean file and 1 for an invalid file", () => {
    const clean = run(["validate", "--in", fixture("hubspot", "clean.csv"), "--target", "hubspot-contacts"]);
    assert.equal(clean.code, 0, clean.stderr);
    const dir = tempDir();
    try {
      const invalid = run([
        "validate",
        "--in",
        fixture("hubspot", "invalid.csv"),
        "--target",
        "hubspot-contacts",
        "--report",
        join(dir, "report.json"),
      ]);
      assert.equal(invalid.code, 1);
      const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as { summary: { ok: boolean }; command: string };
      assert.equal(report.command, "validate");
      assert.equal(report.summary.ok, false);
    } finally {
      removeDir(dir);
    }
  });

  it("prints help and version", () => {
    const help = run([]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Exit codes:/);
    const version = run(["--version"]);
    assert.equal(version.code, 0);
    assert.equal(version.stdout.trim(), "0.1.0");
  });

  it("exposes the package bin and license", () => {
    const pkg = JSON.parse(readFileSync(join(root(), "package.json"), "utf8")) as {
      name: string;
      version: string;
      license: string;
      type: string;
      bin: Record<string, string>;
    };
    assert.equal(pkg.name, "csv-schema-mapper");
    assert.equal(pkg.version, "0.1.0");
    assert.equal(pkg.license, "MIT");
    assert.equal(pkg.type, "module");
    assert.equal(pkg.bin["csv-schema-mapper"], "./dist/cli.js");
    assert.match(readFileSync(join(root(), "LICENSE"), "utf8"), /MIT License/);
    assert.match(readFileSync(join(root(), "dist", "cli.js"), "utf8"), /^#!\/usr\/bin\/env node/);
  });

  it("runs the built bin for list-targets", () => {
    const child = spawnSync(process.execPath, [join(root(), "dist", "cli.js"), "list-targets"], {
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /xero-contacts/);
  });
});

function write(path: string, text: string): void {
  writeFileSync(path, text);
}
