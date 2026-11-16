import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALL_AGENTS } from "../src/core/agent-data.ts";
import { generateAgentMd } from "../src/core/render-agent.ts";

export interface SeedAgentsOptions {
  dir?: string;
  write?: boolean;
  force?: boolean;
}

export interface SeedAgentsResult {
  written: string[];
  missing: string[];
  drifted: string[];
  kept: string[];
}

export function seedAgents(options: SeedAgentsOptions = {}): SeedAgentsResult {
  const dir = resolve(options.dir ?? resolve(process.cwd(), ".opencode", "agents"));
  const result: SeedAgentsResult = { written: [], missing: [], drifted: [], kept: [] };
  if (options.write) mkdirSync(dir, { recursive: true });
  for (const agent of ALL_AGENTS) {
    const file = resolve(dir, `${agent.name}.md`);
    const content = generateAgentMd(agent);
    if (!existsSync(file)) {
      result.missing.push(file);
      if (options.write) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content, "utf-8");
        result.written.push(file);
      }
      continue;
    }
    const current = readFileSync(file, "utf-8");
    if (current === content) {
      result.kept.push(file);
      continue;
    }
    result.drifted.push(file);
    if (options.write && options.force) {
      writeFileSync(file, content, "utf-8");
      result.written.push(file);
    } else {
      result.kept.push(file);
    }
  }
  return result;
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  const write = process.argv.includes("--write");
  const force = process.argv.includes("--force");
  const check = process.argv.includes("--check");
  const result = seedAgents({ write, force });
  for (const file of result.missing) console.log(`missing ${file}`);
  for (const file of result.drifted) console.log(`drift ${file}`);
  for (const file of result.written) console.log(`wrote ${file}`);
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  console.log(
    `seed:agents ${write ? "write" : "dry-run"}${force ? " force" : ""} · ${ALL_AGENTS.length} bases · ${result.written.length} written · ${result.kept.length} kept · ${result.drifted.length} drifted · ${root}`,
  );
  if (check && result.missing.length > 0) process.exitCode = 1;
}
