import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type GateStep = { name: string; cmd: string[] };
type GateManifest = Record<string, GateStep[]>;
type ShardFile = { totalEstimateMs: number; shards: Array<{ estimateMs: number }> };

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
  readFileSync(join(repo, "scripts", "gate-manifest.json"), "utf8"),
) as GateManifest;
const shards = JSON.parse(
  readFileSync(join(repo, "scripts", "proof-shards.json"), "utf8"),
) as ShardFile;
const proofFiles = readdirSync(join(repo, "scripts")).filter(
  (file) => file.startsWith("prove-") && file.endsWith(".ts"),
);
const skillsManifest = JSON.parse(
  readFileSync(join(repo, "skills", "manifest.json"), "utf8"),
) as {
  skills: Array<{
    id: string;
    scope: string;
    tools: string[];
    evalId: string;
    loadRateThreshold: number;
  }>;
};
const skillsTable = [
  "| Skill | Scope | Tools | Eval | Load threshold |",
  "| --- | --- | --- | --- | --- |",
  ...skillsManifest.skills.map(
    (skill) =>
      `| \`${skill.id}\` | ${skill.scope} | ${skill.tools.map((tool) => `\`${tool}\``).join(", ")} | \`${skill.evalId}\` | ${skill.loadRateThreshold} |`,
  ),
].join("\n") + "\n";
const stageProofSteps = (stage: string): number =>
  (manifest[stage] ?? []).filter((step) => step.cmd.some((part) => part.startsWith("scripts/prove-")))
    .length;
const values: Record<string, string> = {
  "proof-files": String(proofFiles.length),
  "proof-steps": String((manifest.proofs ?? []).length),
  "fast-proof-steps": String(stageProofSteps("fast")),
  "smoke-proof-steps": String(stageProofSteps("smoke")),
  "shard-seconds": (shards.totalEstimateMs / shards.shards.length / 1000).toFixed(1),
  "proof-seconds": String(Math.round(shards.totalEstimateMs / 1000)),
  "skills-table": skillsTable,
};
const docs = [
  "AGENTS.md",
  "README.md",
  "TRIAGE.md",
  join("docs", "validation.md"),
  join("docs", "portable-context-handoff.md"),
].filter((file) => existsSync(join(repo, file)));
const MARKER = /<!-- generated:([a-z-]+) -->[\s\S]*?<!-- \/generated -->/g;
const used = new Set<string>();

function render(content: string, file: string): string {
  const opens = (content.match(/<!-- generated:/g) ?? []).length;
  const closes = (content.match(/<!-- \/generated -->/g) ?? []).length;
  const pairs = [...content.matchAll(new RegExp(MARKER.source, "g"))].length;
  if (opens !== closes || pairs !== opens) {
    throw new Error(
      `${file}: malformed generated markers (${opens} open, ${closes} close, ${pairs} pairs)`,
    );
  }
  return content.replace(new RegExp(MARKER.source, "g"), (_all, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`${file}: unknown generated key "${key}"`);
    used.add(key);
    return `<!-- generated:${key} -->${value}<!-- /generated -->`;
  });
}

const check = process.argv.includes("--check");
const rendered: Array<{ file: string; path: string; before: string; after: string }> = [];
for (const file of docs) {
  const path = join(repo, file);
  const before = readFileSync(path, "utf8");
  rendered.push({ file, path, before, after: render(before, file) });
}
const unused = Object.keys(values).filter((key) => !used.has(key));
if (unused.length > 0) {
  console.error(`proof-count: unused generated keys: ${unused.join(", ")}`);
  process.exit(1);
}
const stale = rendered.filter((doc) => doc.after !== doc.before);
if (check) {
  if (stale.length > 0) {
    console.error(
      `proof-count: stale generated values in ${stale.map((doc) => doc.file).join(", ")}; run bun scripts/generate-proof-count.ts`,
    );
    process.exit(1);
  }
  console.log(
    `proof-count: up to date (${values["proof-files"]} proof files, ${values["proof-steps"]} proof steps)`,
  );
} else {
  for (const doc of stale) writeFileSync(doc.path, doc.after);
  console.log(
    `proof-count: wrote ${stale.length} file(s): ${stale.map((doc) => doc.file).join(", ") || "none"}`,
  );
}
