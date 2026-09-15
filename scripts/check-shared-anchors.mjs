import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const SHARED = join(ROOT, "SHARED.md");
const V1_ROOT = resolve(ROOT, "..", "tawassyl");
const V1_SRC = join(V1_ROOT, ".opencode", "plugins", "tawassul");

if (!existsSync(SHARED)) {
  console.error("SHARED.md missing");
  process.exit(1);
}

const content = readFileSync(SHARED, "utf8");
const lines = content.split("\n");
const anchorRe = /`([^`]+?:\d+)`/g;
const errors = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const matches = [...line.matchAll(anchorRe)];
  for (const m of matches) {
    const ref = m[1];
    const idx = ref.lastIndexOf(":");
    const filePart = ref.slice(0, idx);
    const linePart = ref.slice(idx + 1);
    const lineNum = Number(linePart);
    const isV1 = filePart.startsWith("v1/");
    const filePath = isV1
      ? join(V1_SRC, filePart.replace(/^v1\//, ""))
      : join(ROOT, filePart);
    const labelBase = isV1 ? V1_ROOT : "V2";
    if (!existsSync(filePath)) {
      errors.push(`${SHARED}:${i + 1} anchor ${ref} -> missing file under ${labelBase}: ${filePath}`);
      continue;
    }
    const fileLines = readFileSync(filePath, "utf8").split("\n").length;
    if (lineNum < 1 || lineNum > fileLines) {
      errors.push(`${SHARED}:${i + 1} anchor ${ref} -> line out of range (file has ${fileLines} lines)`);
    }
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`shared anchors OK (${V1_ROOT === ROOT ? "same" : "v1=" + V1_ROOT})`);