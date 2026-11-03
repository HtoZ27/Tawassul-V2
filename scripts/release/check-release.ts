import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function text(file: string): string {
  return readFileSync(join(REPO, file), "utf8");
}

const pkg = JSON.parse(text("package.json")) as { version?: string; private?: boolean };
const version = pkg.version ?? "";
check(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version), `package.json version is not a release version: ${version}`);

const lock = JSON.parse(text("package-lock.json")) as {
  version?: string;
  packages?: Record<string, { version?: string }>;
};
check(lock.version === version, `package-lock version ${lock.version} does not match package.json ${version}`);
check(lock.packages?.[""]?.version === version, "package-lock root package version does not match package.json");

const changelog = text("CHANGELOG.md");
check(changelog.includes(`## [${version}]`), `CHANGELOG has no ## [${version}] heading`);
const link = new RegExp(`^\\[${version.replace(/\./g, "\\.")}\\]:\\s+(\\S+)$`, "m").exec(changelog);
check(link !== null, `CHANGELOG has no link reference for ${version}`);
const notesPath = link?.[1] ?? "";
check(notesPath.startsWith("docs/") && notesPath.endsWith(".md"), `CHANGELOG link is not a docs page: ${notesPath || "missing"}`);
check(notesPath.length > 0 && existsSync(join(REPO, notesPath)), `release notes are missing at ${notesPath || "unknown"}`);
if (notesPath && existsSync(join(REPO, notesPath))) {
  const notes = text(notesPath);
  check(notes.includes(`**Version:** \`${version}\``), `${notesPath} does not declare **Version:** \`${version}\``);
  check(notes.includes("**Status:**"), `${notesPath} does not state the release status`);
}

const readme = text("README.md");
check(readme.includes(version), `README does not name ${version}`);

const installer = text("install.sh");
check(installer.includes(`INSTALLER_VERSION="${version}"`), `install.sh does not embed ${version}`);
check(/^REPO_SLUG="[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+"$/m.test(installer), "install.sh has no repository slug");
check(installer.includes("SHA256SUMS"), "install.sh does not verify SHA256SUMS");

const pack = text("scripts/release/pack.sh");
check(pack.includes("package.json"), "pack.sh does not read the package version");
check(!/\b\d+\.\d+\.\d+-experimental/.test(pack), "pack.sh hardcodes a release version");
check(pack.includes("SOURCE_DATE_EPOCH"), "pack.sh does not fix archive timestamps");

const manifest = JSON.parse(text("scripts/gate-manifest.json")) as {
  proofs?: Array<{ name: string; cmd: string[] }>;
  fast?: Array<{ name: string }>;
  smoke?: Array<{ name: string }>;
};
const steps = manifest.proofs ?? [];
const agents = text("AGENTS.md");
const agentMatch = /generated:proof-steps -->(\d+)<!-- \/generated -->/.exec(agents);
check(agentMatch !== null, "AGENTS.md carries no generated proof-step count");
check(Number(agentMatch?.[1] ?? -1) === steps.length, `AGENTS.md records ${agentMatch?.[1]} proofs; the manifest has ${steps.length}`);

const validation = text("docs/validation.md");
const validationMatch = /^\| Proofs \| `npm run gate:proofs` \| (\d+) \|/m.exec(validation);
check(validationMatch !== null, "docs/validation.md has no proofs row");
check(Number(validationMatch?.[1] ?? -1) === steps.length, `docs/validation.md records ${validationMatch?.[1]} proofs; the manifest has ${steps.length}`);
const fileMatch = /tree holds (\d+) proof files and the proofs stage runs (\d+) of/.exec(validation);
const proofFiles = readdirSync(join(REPO, "scripts")).filter((file) => file.startsWith("prove-") && file.endsWith(".ts"));
check(fileMatch !== null, "docs/validation.md has no proof-file sentence");
check(Number(fileMatch?.[1] ?? -1) === proofFiles.length, `docs/validation.md records ${fileMatch?.[1]} proof files; the tree has ${proofFiles.length}`);
check(Number(fileMatch?.[2] ?? -1) === steps.length, `docs/validation.md records ${fileMatch?.[2]} proof steps; the manifest has ${steps.length}`);

const catalog = text("scripts/prove-proof-catalog.ts");
const pinnedSteps = Number(/const PINNED_PROOF_STEPS = (\d+);/.exec(catalog)?.[1] ?? -1);
check(pinnedSteps === steps.length, `proof catalog pins ${pinnedSteps} steps; the manifest has ${steps.length}`);
const pinnedBlock = /const PINNED_PROOF_FILES = \[([\s\S]*?)\];/.exec(catalog)?.[1] ?? "";
const pinnedFiles = [...pinnedBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
check(
  JSON.stringify([...pinnedFiles].sort()) === JSON.stringify([...proofFiles].sort()),
  `proof catalog pins ${pinnedFiles.length} files; the tree has ${proofFiles.length}`,
);

const shards = JSON.parse(text("scripts/proof-shards.json")) as {
  shards?: Array<{ name: string; steps: string[]; estimateMs: number }>;
  totalEstimateMs?: number;
};
const assigned = (shards.shards ?? []).flatMap((shard) => shard.steps).sort();
const expected = steps.map((step) => step.name).sort();
check(JSON.stringify(assigned) === JSON.stringify(expected), "proof shards do not cover the manifest steps exactly once");
check(
  (shards.shards ?? []).reduce((sum, shard) => sum + shard.estimateMs, 0) === shards.totalEstimateMs,
  "proof shard estimates do not add up to the recorded total",
);

const workflow = text(".github/workflows/ci.yml");
const uses = [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1] ?? "");
check(uses.length > 0, "CI workflow has no actions");
for (const action of uses) {
  if (action.startsWith("./") || action.startsWith("docker://")) continue;
  check(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/.test(action), `CI action is not pinned to a full SHA: ${action}`);
}

const indexPath = resolve(REPO, "src", "index.ts");
check(existsSync(indexPath), "src/index.ts is missing");
check(!/server\s*:/.test(readFileSync(indexPath, "utf8")), "src/index.ts still declares a server entry");

const args = process.argv.slice(2);
const tagIndex = args.indexOf("--tag");
const tag = tagIndex >= 0 ? args[tagIndex + 1] : process.env.GITHUB_REF_NAME;
if (tag) {
  check(tag === `v${version}`, `tag ${tag} does not match v${version}`);
}

if (failures.length > 0) {
  console.error(`check-release: ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `check-release: OK (${version}; changelog, notes, installer, ${steps.length} proofs, ${proofFiles.length} files, ` +
    `${uses.length} pinned actions${tag ? `, tag ${tag}` : ""})`,
);
