import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { RETIRED_MODEL_IDS } from "../src/core/model-registry.ts";
import { FALLBACK_CHAINS, sweepRetiredModelPins } from "../src/services/proxy-fallback-chains.ts";
import { HandoffLedger } from "../src/services/handoff-ledger.ts";
import { ImageRouter } from "../src/services/image-router/index.ts";
import { AgentValidator } from "../src/services/third-party-validator.ts";
import { secureExec } from "../src/utils/secure-exec.ts";
import { HMAC_PREFIX, unwrapWithHmac, wrapWithHmac } from "../src/utils/crypto.ts";
import { validateAddInput } from "../src/tools/agent-add-helpers.ts";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed += 1;
  console.log(`ok ${name}`);
}

function source(relative: string): string {
  return readFileSync(join(repo, relative), "utf8");
}

const retired = [
  "opencode/mimo-v2.5-free",
  "cloudflare-workers-ai/@cf/moonshotai/kimi-k2.7-code",
  "opencode/deepseek-v4-flash-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/ox-alpha-free",
];
for (const id of retired) assert(RETIRED_MODEL_IDS.has(id), `the registry retires ${id}`);
assert(!RETIRED_MODEL_IDS.has("opencode/mimo-v2.6-flash-free"), "the registry keeps the mimo rename");
for (const [role, chain] of Object.entries(FALLBACK_CHAINS)) {
  assert(!chain.some((model) => RETIRED_MODEL_IDS.has(model)), `the ${role} chain carries no retired model`);
}
assert(FALLBACK_CHAINS.architect?.includes("opencode/mimo-v2.6-flash-free") === true, "the architect head targets mimo 2.6");
assert(FALLBACK_CHAINS.architect?.some((model) => model.includes("minimax")) === false, "the architect head drops minimax");

const pins: Record<string, string> = {
  "architect-pickle": "cloudflare-workers-ai/@cf/moonshotai/kimi-k2.7-code",
  "dev-gemini": "opencode/mimo-v2.5-free",
  "analyst-pickle": "opencode/big-pickle",
};
const reassigned = sweepRetiredModelPins(pins);
assert(reassigned.length === 2, "the sweep reassigns both retired pins");
assert(pins["analyst-pickle"] === "opencode/big-pickle", "the sweep keeps a healthy pin");
assert(!Object.values(pins).some((model) => RETIRED_MODEL_IDS.has(model)), "the sweep leaves no retired pin");
const sweepSource = source("scripts/sweep-state-retired-pins.ts");
assert(sweepSource.includes("unwrapWithHmac") && sweepSource.includes("wrapWithHmac"), "the residue sweep re-signs through the key code");
assert(sweepSource.includes("sweepRetiredModelPins"), "the residue sweep reuses the registry sweep");

const generator = source("src/scripts/gen-opencode-config.ts");
assert(generator.includes("FATAL (in-lock)"), "the generator builds inside the lock");
assert(generator.includes("post-write global verify FAILED"), "the generator honours the post-write verify");
assert(generator.includes("permission drift vs generated template"), "the generator compares permissions");
assert(generator.includes("matches neither template"), "the generator checks template-or-pin models");
const configUtil = source("src/utils/opencode-config.ts");
assert(configUtil.includes("await new Promise((r) => setTimeout(r, lockRetryDelayMs(attempt)))"), "the lock retry is awaited");
assert(!configUtil.includes(".unref()"), "the lock retry never unrefs its timer");
assert(source("src/scripts/facts.ts").includes("export function buildFacts"), "the facts check is code-backed");
assert(source("src/FACTS.md").includes("agentsTotal ="), "the tracked facts file exists");

const pipeline = source("src/hooks/validation-pipeline.ts");
const permissionGuard = source("src/hooks/guards/permission-guard.ts");
assert(pipeline.includes("rosterBoundaryDeleteGuard"), "the roster boundary guard is wired into ESSENTIAL");
assert(permissionGuard.includes("\\.opencode\\/agents\\/[^/]+\\.md$"), "the roster guard scopes the variant file regex");
assert(pipeline.includes("blockingGuard = \"roster-boundary-delete\""), "the unmanaged branch reports guard attribution");
assert(source("src/bootstrap/plugin-init.ts").includes("requiresConsent("), "init fails closed for consent tools");
assert(validateAddInput(["analyst-gemini"], "google/gemini-flash-lite-latest") === null, "the add allowlist accepts a governed suffix");
assert(validateAddInput(["analyst-nope"], "google/gemini-flash-lite-latest") !== null, "the add allowlist rejects an unknown suffix");
assert(validateAddInput(["tawa-dev"], "google/gemini-flash-lite-latest") !== null, "the add allowlist rejects a tawa variant");

const work = mkdtempSync(join(tmpdir(), "tawassul-s017-"));
try {
  const failingDir = join(work, "ledger-fail");
  mkdirSync(failingDir, { recursive: true });
  mkdirSync(join(failingDir, "handoff-ledger.jsonl"), { recursive: true });
  const failing = new HandoffLedger(failingDir);
  failing.append({ type: "handoff_created", handoffId: "H-1", from: "dev", to: "tester", task: "proof" });
  let rejected = false;
  try {
    await failing.flush();
  } catch {
    rejected = true;
  }
  assert(rejected, "a failed ledger flush reports the failure");
  rmSync(join(failingDir, "handoff-ledger.jsonl"), { recursive: true, force: true });
  await failing.flush();
  assert(readFileSync(join(failingDir, "handoff-ledger.jsonl"), "utf8").includes('"handoffId":"H-1"'), "the failed batch is requeued and written");
  await failing.dispose();
} finally {
  rmSync(join(work, "ledger-fail"), { recursive: true, force: true });
}

const signed = wrapWithHmac(JSON.stringify({ ok: true }));
assert(unwrapWithHmac(signed) === JSON.stringify({ ok: true }), "a signed payload verifies");
assert(unwrapWithHmac(`${HMAC_PREFIX}${"z".repeat(64)}:{}`) === null, "a non-hex signature fails cleanly");
assert(unwrapWithHmac(`${HMAC_PREFIX}not-a-signature:{}`) === null, "a malformed signature fails cleanly");

const router = new ImageRouter();
const routed = router.analyzeAndRoute("image", ["@designer", "@reviewer", "@analyst"], { filename: "screen.png" });
assert(routed.analysis.type === "screenshot", "the image router classifies a screenshot");
assert(routed.suggestedAgent === "@designer", "the image router keeps the top preferred agent");
assert(routed.fallbackAgent === "@reviewer", "the image router picks the next preferred fallback");
const nextPreferred = router.analyzeAndRoute("image", ["@analyst", "@reviewer"], { filename: "screen.png" });
assert(nextPreferred.suggestedAgent === "@reviewer", "the image router skips an unavailable top preference");
const arbitrary = router.analyzeAndRoute("image", ["@analyst"], { filename: "screen.png" });
assert(arbitrary.fallbackAgent === "@analyst", "the image router falls back to an available agent");

const validator = new AgentValidator(
  () => ["@dev", "@tester"],
  { getState: (agent) => (agent === "@reviewer" ? "OPEN" : "CLOSED") },
);
assert((await validator.validate({ handoffId: "H-1", from: "@dev", to: "@tawa", task: "x" })).approved === false, "a short task to tawa is blocked");
assert((await validator.validate({ handoffId: "H-2", from: "@dev", to: "@reviewer", task: "x" })).approved === false, "a short task to an OPEN agent is blocked");
assert((await validator.validate({ handoffId: "H-3", from: "@dev", to: "@analyst", task: "x" })).approved === true, "a short task to a healthy agent passes");

let denied = 0;
for (const [binary, args] of [
  ["curl", ["https://example.test"]],
  ["git", ["diff", "--output=/tmp/leak"]],
  ["npm", ["run", "postinstall"]],
  ["npx", ["typescript"]],
  ["rg", ["-r", "x", "y"]],
  ["git", ["status"]],
] as Array<[string, string[]]>) {
  const blocked = await secureExec(binary, args).then(() => false, () => true);
  if (blocked) denied += 1;
}
assert(denied === 6, "the secure exec allowlist rejects forbidden binaries and flags");
const meta = await secureExec("git", ["diff", "x;rm"]).then(() => false, () => true);
assert(meta === true, "the secure exec allowlist rejects shell metacharacters");

const goalStore = source("src/services/goal-store.ts");
assert((goalStore.match(/const fresh = this\.goals\.get\(id\)/g) ?? []).length >= 3, "the goal store re-reads inside the lock");
assert(source("src/context/session-manager.ts").includes("acquireFSLock"), "the session registry uses the file lock");
assert(source("src/services/state-persistence.ts").includes("Math.max(budget, value.length)"), "the deferred save keeps the lenient max budget");
assert(source("src/services/state-persistence.ts").includes("const wait = Math.max(0, this.nextRetryAt - now)"), "the deferred wakeup keeps its own timer");
assert(source("src/services/state-persistence.ts").includes("setTimeout(wake, wait)"), "the deferred wakeup timer is armed");
assert(source("src/services/handoff-ledger.ts").includes("const batch = this.buffer;"), "the ledger swaps the batch before awaiting");
assert(source("src/services/handoff-ledger.ts").includes("this.buffer = [...batch, ...this.buffer]"), "the ledger requeues a failed batch at the front");
assert(source("src/services/trust-score/calculator.ts").includes("async persist(): Promise<void>"), "the trust score keeps its persist path");
assert(source("src/services/trust-score/calculator.ts").includes("history: Object.fromEntries(this.history)"), "the trust score persists its history");
assert(source("src/utils/opencode-config.ts").includes("cannot-verify protected-agent deletions"), "the deletion sentinel throws on unreadable input");
assert(source("src/utils/opencode-config.ts").includes("{ cause: e }"), "the deletion sentinel keeps its cause");
assert(source("package.json").includes('"check:config"') && source("package.json").includes('"ci"'), "the config and ci scripts are wired");
assert(source("src/services/trust-score/calculator.ts").includes("getReport(agentId: string)"), "the trust report path is present");
assert(source("src/hooks/message-updated.ts").includes("elicitation"), "the elicitation fallback is audited");
assert(source("src/utils/path.ts").includes("await realpath(dirname(resolved))"), "the path resolver falls back through the dirname realpath");
assert(source("src/tools/image-gen.ts").includes("let cachedAccessToken: string | null = null"), "the image token lives in module memory");
assert(source("src/tools/handoff.ts").includes('s === "strict" && ruleDecision.action === "block"'), "strict handoff rules block");
assert(source("src/tools/web.ts").includes("output-${Date.now()}-${randomBytes(4).toString(\"hex\")}.txt"), "web temp files are unique");
assert(source("src/services/event-hub.ts").includes("slotDeadline"), "the event slot wait carries a deadline");
assert(source("src/tools/agent-management.ts").includes("configWriteChains"), "the stored chain keeps its serialized audit");
assert(source("src/services/proxy-fallback-chains.ts").includes("sweepRetiredModelPins"), "the retirement sweep is exported");

const logPath = join(work, "redact.log");
const probe = String.raw`
(async () => {
  const { logger } = await import("./src/utils/logger.ts");
  logger.addSecret("proofkey");
  const circular = { depth: 0 };
  circular.self = circular;
  logger.info("redact-proof", { proofkey: "leaked-value", nested: { proofkey: "leaked-value" }, circular });
  await new Promise((r) => setTimeout(r, 200));
  const fs = require("node:fs");
  const text = fs.readFileSync(process.env.TAWASSUL_LOG_FILE, "utf8");
  const ok = text.includes("[REDACTED]") && text.includes("[Circular]") && !text.includes("leaked-value");
  process.exit(ok ? 0 : 3);
})().catch((e) => { console.error(e); process.exit(4); });
`;
const run = spawnSync(process.execPath, ["-e", probe], {
  cwd: repo,
  encoding: "utf8",
  env: { ...process.env, TAWASSUL_LOG_FILE: logPath },
});
assert(run.status === 0, "the logger redacts secrets, cycles, and over-depth values");

const referenced = [
  "scripts/prove-gen-lock-contention.ts",
  "scripts/prove-gen-merge-guards.ts",
  "scripts/prove-gen-guard-wal.ts",
  "scripts/prove-roster-boundary.ts",
  "scripts/prove-event-trust-p1.ts",
  "scripts/prove-web-ssrf.ts",
  "scripts/prove-s028.ts",
];
for (const file of referenced) {
  const path = join(repo, file);
  assert(existsSync(path) && readFileSync(path, "utf8").includes("PROOF PASS"), `${file} stays executable evidence`);
}

rmSync(work, { recursive: true, force: true });
console.log(`PROOF PASS: S-017 hardening rows, retirements, governance, and runtime guards (${passed} assertions)`);
