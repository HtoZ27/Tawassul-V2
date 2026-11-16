import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT_FILES = ["build-v2.mjs", "package.json"];

function collect(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, out);
      continue;
    }
    if (entry.isFile()) out.push(full);
  }
}

export function sourceDigest(): string {
  const files: string[] = [];
  collect(join(REPO, "src"), files);
  for (const name of ROOT_FILES) files.push(join(REPO, name));
  files.sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(REPO, file).split("\\").join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}
