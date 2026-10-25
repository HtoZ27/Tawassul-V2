import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

type GateStep = {
  name: string;
  cmd: string[];
  env?: Record<string, string>;
};

type GateManifest = Record<string, GateStep[]>;

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf-8")) as {
  scripts?: Record<string, string>;
};
const scripts = pkg.scripts ?? {};
const manifest = JSON.parse(
  readFileSync(join(repo, "scripts", "gate-manifest.json"), "utf-8"),
) as GateManifest;
const stageNames = Object.keys(manifest).sort();
assert(
  JSON.stringify(stageNames) === JSON.stringify(["fast", "proofs", "smoke"]),
  "gate manifest has fast, proofs, and smoke stages",
);

const steps = Object.entries(manifest).flatMap(([stage, list]) =>
  list.map((step) => ({ stage, ...step })),
);
const names = steps.map((step) => step.name);
assert(new Set(names).size === names.length, "gate step names are unique");

for (const step of steps) {
  assert(step.cmd.length > 0, `${step.name} has a command`);
  const command = step.cmd[0] ?? "";
  assert(command.length > 0, `${step.name} has a program`);
  if (command.startsWith("./")) {
    assert(existsSync(join(repo, command)), `${step.name} program exists (${command})`);
  }
  for (const part of step.cmd.slice(1)) {
    if (part.startsWith("scripts/") || part.startsWith("src/") || part === "build-v2.mjs") {
      assert(existsSync(join(repo, part)), `${step.name} target exists (${part})`);
    }
  }
}

const proofFiles = readdirSync(join(repo, "scripts"))
  .filter((file) => file.startsWith("prove-") && file.endsWith(".ts"))
  .sort();
assert(proofFiles.length >= 25, `proof catalog has at least 25 files (found ${proofFiles.length})`);

for (const file of proofFiles) {
  const target = `scripts/${file}`;
  const owners = steps.filter((step) => step.cmd.includes(target));
  assert(owners.length === 1, `${file} is wired into exactly one gate step (found ${owners.length})`);
  const owner = owners[0];
  if (owner) {
    assert(
      owner.stage === "proofs" || (owner.stage === "fast" && file === "prove-proof-catalog.ts"),
      `${file} runs in proofs (or fast for the catalog)`,
    );
  }
}

const proofSteps = steps.filter((step) => step.cmd.some((part) => part.startsWith("scripts/prove-")));
assert(
  proofSteps.length === proofFiles.length,
  `gate runs every proof file (${proofSteps.length}/${proofFiles.length})`,
);

const fast = manifest["fast"] ?? [];
const proofs = manifest["proofs"] ?? [];
const smoke = manifest["smoke"] ?? [];
const fastNames = fast.map((step) => step.name);
for (const required of ["source-rules", "shell-syntax", "typecheck", "config", "facts", "proof-catalog"]) {
  assert(fastNames.includes(required), `fast stage includes ${required}`);
}
assert(proofs.length >= 24, `proofs stage has at least 24 steps (found ${proofs.length})`);
const smokeNames = smoke.map((step) => step.name);
assert(smokeNames.includes("build"), "smoke stage builds the bundle");
assert(smokeNames.includes("release-smoke"), "smoke stage runs the release smoke");

const catalogOwners = steps.filter((step) => step.cmd.includes("scripts/prove-proof-catalog.ts"));
assert(
  catalogOwners.length === 1 && catalogOwners[0]?.stage === "fast",
  "proof catalog runs in the fast stage",
);

assert(scripts["gate:fast"] === "bun scripts/gate.ts fast", "gate:fast runs the fast stage");
assert(scripts["gate:proofs"] === "bun scripts/gate.ts proofs", "gate:proofs runs the proof stage");
assert(scripts["gate:smoke"] === "bun scripts/gate.ts smoke", "gate:smoke runs the smoke stage");
assert(scripts["gate"] === "bun scripts/gate.ts all", "gate runs every stage");
assert(scripts["ci"] === "bun scripts/gate.ts all", "ci runs the gate umbrella");
assert(!(scripts["ci"] ?? "").includes("&&"), "ci has no chained commands");
assert((scripts["verify"] ?? "").includes("scripts/gate.ts fast"), "verify runs the fast stage");
assert((scripts["verify"] ?? "").includes("build-v2.mjs"), "verify still builds");
assert(
  scripts["smoke:release"] === "bash scripts/release-smoke.sh",
  "smoke:release stays the single smoke entry",
);

console.log(`PROOF PASS: ${proofFiles.length} proofs across 3 isolated gate stages`);
