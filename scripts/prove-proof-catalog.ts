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

type ShardDefinition = {
  name: string;
  estimateMs: number;
  steps: string[];
};

type ShardFile = {
  version: number;
  totalEstimateMs: number;
  shards: ShardDefinition[];
};

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
  JSON.stringify(stageNames) === JSON.stringify(["evals", "fast", "proofs", "smoke"]),
  "gate manifest has fast, proofs, smoke, and evals stages",
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
  "prove-board-invariants.ts",
  "prove-boot-budget.ts",
  "prove-boot-gate.ts",
  "prove-bundle-freshness.ts",
  "prove-c02.ts",
  "prove-c03.ts",
  "prove-cancel-metric.ts",
  "prove-catch-discipline.ts",
  "prove-closure-artifacts.ts",
  "prove-concordance.ts",
  "prove-constraint-retention.ts",
  "prove-context-accounting.ts",
  "prove-context-baseline.ts",
  "prove-context-bridge.ts",
  "prove-context-budget.ts",
  "prove-context-claim.ts",
  "prove-context-diet.ts",
  "prove-context-failure-pack.ts",
  "prove-context-hook-idempotent.ts",
  "prove-context-hook-latency.ts",
  "prove-context-inject.ts",
  "prove-context-kill-switch.ts",
  "prove-context-revalidate.ts",
  "prove-context-sanitize.ts",
  "prove-context-selection.ts",
  "prove-context-store.ts",
  "prove-context-transport.ts",
  "prove-d05.ts",
  "prove-db-lock.ts",
  "prove-db-retention.ts",
  "prove-db-scheduler.ts",
  "prove-desktop-scan.ts",
  "prove-disclosure.ts",
  "prove-dispatch-model.ts",
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
  "prove-gate-budget.ts",
  "prove-gen-guard-wal.ts",
  "prove-gen-lock-contention.ts",
  "prove-gen-merge-guards.ts",
  "prove-global-boot.ts",
  "prove-global-install.ts",
  "prove-goal-board-truth.ts",
  "prove-goal-capture.ts",
  "prove-goal-item-ids.ts",
  "prove-goal-item-update.ts",
  "prove-goal-migration.ts",
  "prove-goal-resurrection.ts",
  "prove-goal-stale-lifecycle.ts",
  "prove-guard-matrix.ts",
  "prove-handoff-rescue.ts",
  "prove-handoff-undo.ts",
  "prove-host-discovery.ts",
  "prove-host-entry.ts",
  "prove-host-floor.ts",
  "prove-host-goal.ts",
  "prove-host-refresh.ts",
  "prove-independence-boot.ts",
  "prove-intelligence-off.ts",
  "prove-md-gate.ts",
  "prove-model-failover-e2e.ts",
  "prove-model-failover.ts",
  "prove-model-switch.ts",
  "prove-n2-cap.ts",
  "prove-no-git-init.ts",
  "prove-p08.ts",
  "prove-partial-install.ts",
  "prove-payload-cache.ts",
  "prove-pilot-eval.ts",
  "prove-pipeline-early-exit.ts",
  "prove-portability.ts",
  "prove-project-index-byproduct.ts",
  "prove-project-index-corrupt.ts",
  "prove-project-index-incremental.ts",
  "prove-proof-catalog.ts",
  "prove-reachability-audit.ts",
  "prove-read-cache-bypass.ts",
  "prove-read-cache-byte-cap.ts",
  "prove-read-cache-hit.ts",
  "prove-read-cache-stamp-miss.ts",
  "prove-read-cache-unrelated-edit.ts",
  "prove-record-digest-dedupe.ts",
  "prove-reload-live.ts",
  "prove-repeat-guard.ts",
  "prove-review-independence-retro.ts",
  "prove-roster-boundary.ts",
  "prove-routing-eval.ts",
  "prove-rule-gate.ts",
  "prove-run-interrupt.ts",
  "prove-s005.ts",
  "prove-s013.ts",
  "prove-s017.ts",
  "prove-s020.ts",
  "prove-s021.ts",
  "prove-s024.ts",
  "prove-s028.ts",
  "prove-s029.ts",
  "prove-s033.ts",
  "prove-s036.ts",
  "prove-s038.ts",
  "prove-s053.ts",
  "prove-seed-agents.ts",
  "prove-setup-delegation.ts",
  "prove-shell-alias.ts",
  "prove-skill-discovery.ts",
  "prove-skill-load-rate.ts",
  "prove-skill-registration.ts",
  "prove-skills-manifest.ts",
  "prove-snapshot-boundary.ts",
  "prove-state-paths.ts",
  "prove-state-root-rollback.ts",
  "prove-state-root-survival.ts",
  "prove-store-priming.ts",
  "prove-task-context-budget.ts",
  "prove-task-context-bundle.ts",
  "prove-task-context-distinct.ts",
  "prove-task-control.ts",
  "prove-thread-tool.ts",
  "prove-tool-name-hash.ts",
  "prove-tool-run-ranking.ts",
  "prove-upstream-sync.ts",
  "prove-v2-ask-bridge.ts",
  "prove-v2-compat.ts",
  "prove-v2-independence.ts",
  "prove-web-ssrf.ts",
];

const PINNED_PROOF_STEPS = 170;
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

const shardFile = JSON.parse(
  readFileSync(join(repo, "scripts", "proof-shards.json"), "utf-8"),
) as ShardFile;
assert(shardFile.version === 1, "proof shard file uses schema version 1");
assert(Array.isArray(shardFile.shards) && shardFile.shards.length >= 2, "proof shards split the stage into at least two groups");
const shardNames = shardFile.shards.map((entry) => entry.name);
assert(new Set(shardNames).size === shardNames.length, "proof shard names are unique");
const proofNames = proofs.map((step) => step.name);
const assigned = shardFile.shards.flatMap((entry) => entry.steps);
assert(assigned.length === new Set(assigned).size, "no proof step is assigned to two shards");
assert(
  JSON.stringify([...assigned].sort()) === JSON.stringify([...proofNames].sort()),
  `proof shards cover every proofs step exactly once (${assigned.length}/${proofNames.length})`,
);
assert(shardFile.shards.every((entry) => entry.steps.length > 0), "no proof shard is empty");
assert(shardFile.shards.every((entry) => entry.estimateMs > 0), "every proof shard has a positive estimate");
const estimateSum = shardFile.shards.reduce((sum, entry) => sum + entry.estimateMs, 0);
assert(estimateSum === shardFile.totalEstimateMs, "proof shard estimates add up to the recorded total");
const meanEstimate = estimateSum / shardFile.shards.length;
const maxEstimate = Math.max(...shardFile.shards.map((entry) => entry.estimateMs));
assert(
  maxEstimate <= meanEstimate * 1.1,
  `proof shards stay within 10% of the mean (max ${maxEstimate}ms, mean ${Math.round(meanEstimate)}ms)`,
);
for (const entry of shardFile.shards) {
  assert(
    scripts[`gate:proofs:${entry.name}`] === `bun scripts/gate.ts proofs --shard ${entry.name} --nice 10`,
    `gate:proofs:${entry.name} runs shard ${entry.name} at low priority`,
  );
}
const bgRunner = "scripts/gate-proofs-bg.sh";
assert(existsSync(join(repo, bgRunner)), "proof background runner exists");
for (const [name, action] of [
  ["gate:proofs:bg", "start"],
  ["gate:proofs:bg:status", "status"],
  ["gate:proofs:bg:wait", "wait"],
  ["gate:proofs:bg:stop", "stop"],
] as const) {
  assert(scripts[name] === `bash ${bgRunner} ${action}`, `${name} calls the background runner`);
}
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
assert(scripts["gate:evals"] === "bun scripts/gate.ts evals", "gate:evals runs the eval stage");
assert(
  JSON.stringify(manifest.evals?.map((step) => step.name)) === JSON.stringify(["eval-pilot"]),
  "the eval stage carries the pilot fixture",
);
assert(
  manifest.evals?.[0]?.cmd.join(" ") === "bun scripts/run-pilot-evals.ts",
  "the eval stage runs the pilot fixture through one child process",
);
assert(existsSync(join(repo, "scripts", "run-pilot-evals.ts")), "the eval stage entry point exists");
const budgets = JSON.parse(readFileSync(join(repo, "scripts", "gate-budgets.json"), "utf-8")) as {
  stages: Record<string, { wallMs: number; rssMb?: number }>;
};
assert(budgets.stages.evals?.wallMs === 90_000, "the eval stage declares the 90 s wall budget");
assert(budgets.stages.evals?.rssMb === 256, "the eval stage declares the 256 MB RSS budget");
assert(!(scripts["ci"] ?? "").includes("evals"), "ci keeps the eval stage off the release-blocking path");
assert(!(scripts["gate"] ?? "").includes("evals"), "the umbrella gate keeps the eval stage separate");
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
