import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./errors.js";

export interface PackageInfo {
  root: string;
  version: string;
}

let cached: PackageInfo | null = null;

/** Directory that contains package.json and schemas/, walking up from this module. */
export function packageInfo(): PackageInfo {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath) && existsSync(join(dir, "schemas"))) {
      const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
      if (!parsed.version) {
        throw new CliError(`package.json at ${pkgPath} has no version`);
      }
      cached = { root: dir, version: parsed.version };
      return cached;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new CliError("Could not find the csv-schema-mapper package root (package.json + schemas/)");
}

export function schemasDir(): string {
  return join(packageInfo().root, "schemas");
}
