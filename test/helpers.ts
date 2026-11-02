import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageInfo } from "../src/paths.js";

export function root(): string {
  return packageInfo().root;
}

export function fixture(...parts: string[]): string {
  return join(root(), "fixtures", ...parts);
}

export function readFixture(...parts: string[]): string {
  return readFileSync(fixture(...parts), "utf8");
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "csv-schema-mapper-"));
}

export function removeDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
