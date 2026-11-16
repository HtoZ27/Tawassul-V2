#!/usr/bin/env bun

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../utils/logger.ts";

const root = resolve(__dirname, "..");

function findTestFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
      files.push(...findTestFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx"))) {
      files.push(fullPath);
    }
  }
  return files;
}

interface Violation {
  file: string;
  line: number;
  content: string;
}

const violations: Violation[] = [];

for (const file of findTestFiles(root)) {
  const content = readFileSync(file, "utf-8");
  const lines = content.split("\n");

  let insideBlock = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    
    const trimmed = line.trim();
    if (trimmed.startsWith("describe(") || trimmed.startsWith("it(") ||
        trimmed.startsWith("test(") || trimmed.startsWith("beforeEach(") ||
        trimmed.startsWith("afterEach(") || trimmed.startsWith("beforeAll(") ||
        trimmed.startsWith("afterAll(")) {
      insideBlock++;
    } else if (trimmed.startsWith("});") || trimmed === "})" || trimmed.startsWith("})")) {
      if (insideBlock > 0) insideBlock--;
    }

    if (trimmed.startsWith("vi.mock(") && insideBlock === 0) {
      
      if (trimmed.includes('"node:')) continue;
      violations.push({ file, line: i + 1, content: trimmed });
    }
  }
}

if (violations.length > 0) {
  console.error("❌ Top-level vi.mock() calls found (cause cross-file state bleeding):\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.content}\n`);
  }
  process.exit(1);
} else {
  logger.warn("No top-level vi.mock() violations found.");
}
