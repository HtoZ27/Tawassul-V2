#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { configSchema } from "../context/config-schema.ts";

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TARGET = join(REPO, "tawassul.schema.json");
const check = process.argv.includes("--check");

const generated = z.toJSONSchema(configSchema, { target: "draft-2020-12" });
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/HtoZ27/tawassul-v2/blob/main/tawassul.schema.json",
  title: "Tawassul plugin configuration",
  description: "Configuration accepted by the Tawassul plugin for OpenCode v2.",
  ...generated,
};
const rendered = `${JSON.stringify(schema, null, 2)}\n`;

if (check) {
  let current = "";
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    current = "";
  }
  if (current !== rendered) {
    console.error("gen-schema: tawassul.schema.json is stale; run bun src/scripts/gen-schema.ts");
    process.exit(1);
  }
  console.log("gen-schema: OK");
} else {
  writeFileSync(TARGET, rendered);
  console.log(`gen-schema: wrote ${TARGET}`);
}
