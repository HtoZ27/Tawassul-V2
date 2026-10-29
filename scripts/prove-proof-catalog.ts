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

const PINNED_PROOF_FILES = [
  "prove-b01.ts",
  "prove-b02.ts",
  "prove-b03.ts",
  "prove-b05.ts",
  "prove-b11.ts",
  "prove-b12.ts",
  "prove-backup-cap.ts",
  "prove-blocked-tool.ts",
  "prove-boot-budget.ts",
  "prove-boot-gate.ts",
  "prove-bundle-freshness.ts",
  "prove-c02.ts",
  "prove-c03.ts",
  "prove-cancel-metric.ts",
  "prove-catch-discipline.ts",
  "prove-closure-artifacts.ts",
  "prove-d05.ts",
  "prove-db-lock.ts",
  "prove-db-retention.ts",
  "prove-db-scheduler.ts",
  "prove-desktop-scan.ts",
  "prove-disclosure.ts",
  "prove-e02.ts",
  "prove-e11.ts",
  "prove-e12.ts",
  "prove-e13.ts",
  "prove-e14.ts",
  "prove-e15.ts",
  "prove-e17.ts",
  "prove-e18.ts",
  "prove-e19.ts",
  "prove-e20.ts",
  "prove-e21.ts",
  "prove-e22.ts",
  "prove-e23.ts",
  "prove-e24.ts",
  "prove-e25.ts",
  "prove-e27.ts",
  "prove-e28.ts",
  "prove-e29.ts",
  "prove-e30.ts",
  "prove-e31.ts",
  "prove-e33.ts",
  "prove-e34.ts",
  "prove-e35.ts",
  "prove-e36.ts",
  "prove-e37.ts",
  "prove-e38.ts",
  "prove-e42.ts",
  "prove-e44.ts",
  "prove-e45.ts",
  "prove-e46.ts",
  "prove-event-trust-p1.ts",
  "prove-feature-index-english.ts",
  "prove-first-boot-seed.ts",
  "prove-g002i2.ts",
  "prove-g002i3.ts",
  "prove-g002i4.ts",
  "prove-g003i1.ts",
  "prove-g003i2.ts",
  "prove-g003i3.ts",
  "prove-g003i4.ts",
  "prove-g003i5.ts",
  "prove-g003i6.ts",
  "prove-gen-guard-wal.ts",
  "prove-gen-lock-contention.ts",
  "prove-gen-merge-guards.ts",
  "prove-global-boot.ts",
  "prove-global-install.ts",
  "prove-goal-capture.ts",
  "prove-goal-item-ids.ts",
  "prove-goal-item-update.ts",
  "prove-goal-resurrection.ts",
  "prove-guard-matrix.ts",
  "prove-handoff-rescue.ts",
  "prove-handoff-undo.ts",
  "prove-host-discovery.ts",
  "prove-host-goal.ts",
  "prove-host-refresh.ts",
  "prove-independence-boot.ts",
  "prove-n2-cap.ts",
  "prove-p08.ts",
  "prove-p09.ts",
  "prove-partial-install.ts",
  "prove-pipeline-early-exit.ts",
  "prove-portability.ts",
  "prove-proof-catalog.ts",
  "prove-roster-boundary.ts",
  "prove-rule-gate.ts",
  "prove-s020.ts",
  "prove-s021.ts",
  "prove-s024.ts",
  "prove-s028.ts",
  "prove-s029.ts",
  "prove-s038.ts",
  "prove-seed-agents.ts",
  "prove-setup-delegation.ts",
  "prove-shell-alias.ts",
  "prove-state-namespace.ts",
  "prove-store-priming.ts",
  "prove-upstream-sync.ts",
  "prove-v2-ask-bridge.ts",
  "prove-v2-compat.ts",
  "prove-v2-independence.ts",
  "prove-web-ssrf.ts",
];

const PINNED_PROOF_STEPS = 102;
const SMOKE_PROOFS = new Set(["prove-global-boot.ts", "prove-independence-boot.ts"]);

const proofFiles = readdirSync(join(repo, "scripts"))
  .filter((file) => file.startsWith("prove-") && file.endsWith(".ts"))
  .sort();
assert(
  JSON.stringify(proofFiles) === JSON.stringify(PINNED_PROOF_FILES),
  `proof catalog matches the pinned file list (found ${proofFiles.length}, pinned ${PINNED_PROOF_FILES.length})`,
);

for (const file of proofFiles) {
  const target = `scripts/${file}`;
  const owners = steps.filter((step) => step.cmd.includes(target));
  assert(owners.length === 1, `${file} is wired into exactly one gate step (found ${owners.length})`);
  const owner = owners[0];
  if (owner && SMOKE_PROOFS.has(file)) {
    assert(owner.stage === "smoke", `${file} runs in smoke after the build`);
  } else if (owner) {
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
for (const required of ["source-rules", "shell-syntax", "typecheck", "config", "facts", "sdk-pins", "proof-catalog"]) {
  assert(fastNames.includes(required), `fast stage includes ${required}`);
}
assert(proofs.length === PINNED_PROOF_STEPS, `proofs stage matches the pinned step count (found ${proofs.length}, pinned ${PINNED_PROOF_STEPS})`);
const smokeNames = smoke.map((step) => step.name);
assert(smokeNames.includes("build"), "smoke stage builds the bundle");
assert(smokeNames.includes("release-smoke"), "smoke stage runs the release smoke");
assert(smokeNames.includes("global-boot"), "smoke stage boots the isolated global install");
assert(smokeNames.includes("independence-boot"), "smoke stage boots without the v1 tree");

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
