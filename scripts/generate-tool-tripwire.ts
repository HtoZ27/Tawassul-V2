import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_COUNT_FLOOR, toolNameSetHash } from "../src/services/tool-tripwire.ts";
import { TAWASSUL_TOOL_NAMES } from "../src/tool-names.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const names = [...TAWASSUL_TOOL_NAMES].sort();
const count = names.length;
const hash = toolNameSetHash(names);
const tsPath = join(repo, "src", "generated", "tool-tripwire.ts");
const jsonPath = join(repo, "scripts", "tool-tripwire.json");
const ts = `export const TOOL_NAME_SET_HASH = "${hash}";\nexport const TOOL_COUNT = ${count};\n`;
const json = `${JSON.stringify({ count, hash, floor: TOOL_COUNT_FLOOR }, null, 2)}\n`;
const check = process.argv.includes("--check");

if (check) {
  if (!existsSync(tsPath) || !existsSync(jsonPath)) {
    console.error("tool-tripwire: generated files are missing; run bun scripts/generate-tool-tripwire.ts");
    process.exitCode = 1;
  } else {
    const currentTs = readFileSync(tsPath, "utf8");
    const currentJson = readFileSync(jsonPath, "utf8");
    if (currentTs !== ts || currentJson !== json) {
      console.error("tool-tripwire: generated files are stale; run bun scripts/generate-tool-tripwire.ts");
      process.exitCode = 1;
    } else {
      console.log(`tool-tripwire: up to date (${count} tools, ${hash.slice(0, 12)})`);
    }
  }
} else {
  mkdirSync(dirname(tsPath), { recursive: true });
  writeFileSync(tsPath, ts);
  writeFileSync(jsonPath, json);
  console.log(`tool-tripwire: wrote ${count} tools, ${hash.slice(0, 12)}`);
}
