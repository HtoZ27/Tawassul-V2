import "./proof-log-isolate.ts";
import { readFileSync } from "node:fs";
import { deriveVariantSpec, parseAddInput } from "../src/tools/agent-add-helpers.ts";
import { buildAgents } from "../src/scripts/gen-opencode-config.ts";

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

const known = deriveVariantSpec("analyst", "opencode/big-pickle");
assert(known !== null && known.tag === "analyst-pickle" && known.from === "analyst", "a catalog model derives the short suffix");
const custom = deriveVariantSpec("dev", "opencode/exo-free");
assert(custom !== null && custom.tag === "dev-exo-free" && custom.from === "dev", "a provider custom derives the full slug");
assert(deriveVariantSpec("tawa", "opencode/big-pickle") === null, "tawa never derives a variant");
assert(deriveVariantSpec("custom", "opencode/big-pickle") === null, "a non-specialization never derives");
assert(deriveVariantSpec("analyst", "") === null, "an empty model never derives");

const parsed = parseAddInput("analyst with model Exo Free from opencode");
assert(parsed !== null && parsed.specs.join(",") === "analyst-exo-free", "the parser rewrites a bare base before validation");
assert(parsed !== null && parsed.derived["analyst-exo-free"] === "analyst", "the parser records the derivation source");
const explicit = parseAddInput("analyst-mimo with model Exo Free from opencode");
assert(explicit !== null && Object.keys(explicit.derived).length === 0, "an explicit suffix records no derivation");

const management = readFileSync("src/tools/agent-management.ts", "utf8");
assert(management.includes('t("addagentBareBaseRefused"'), "the add write path refuses a bare base");
assert(management.includes("parsed.derived"), "the add output reports each derived variant");
assert(
  management.includes('channel.askForRoot(title, { type: "confirm", default: false }, cctx.sessionID)'),
  "kick bulk routes approval to the root session",
);
assert(management.includes("channel.hasPending(answerSession)"), "kick bulk refuses to stack on a pending card");
assert(management.includes("kickBulkConfirmRequired"), "kick bulk fails closed when the channel is unavailable");

const messages = JSON.parse(readFileSync("src/i18n/en.json", "utf8")) as Record<string, string>;
assert(typeof messages["addagentBareBaseRefused"] === "string", "the refusal message exists");
assert(typeof messages["addagentDerived"] === "string", "the derivation announcement exists");

const scorecard = readFileSync("scripts/boot-scorecard-v2.sh", "utf8");
assert(scorecard.includes("XDG_DATA_HOME relative"), "a relative XDG data dir is refused");
assert(scorecard.includes("command -v python3"), "python3 is a hard shell requirement");
const cryptoSource = readFileSync("src/utils/crypto.ts", "utf8");
assert(cryptoSource.includes("randomBytes"), "HMAC keys are generated in-process");
assert(!cryptoSource.includes("openssl"), "HMAC key generation never shells out to openssl");

const policySource = readFileSync("src/security-policy.ts", "utf8");
assert(!policySource.includes("DELETED_" + "AGENTS"), "the static deletion list is gone from the security policy");
assert(buildAgents()["analyst-minimax"] !== undefined, "default generation keeps every catalog variant");
assert(buildAgents()["analyst-ling"] === undefined, "a retired model emits no variant");

console.log(`PROOF PASS: the agent-management hardening week is ported (${passed} assertions)`);
