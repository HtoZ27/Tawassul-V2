import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAX_SWITCHES,
  FAILOVER_CLAIM_TTL_MS,
  clearFailoverClaim,
  commitFailover,
  failoverSwitchCount,
  formatTarget,
  hasFailoverClaim,
  parseModelTarget,
  planFailover,
  recordFailoverMiss,
  resetFailoverState,
  resolveChain,
  switchSessionModel,
  type FallbackChainConfig,
} from "../src/services/model-failover.ts";
import { getFallbackChain } from "../src/services/proxy-fallback-chains.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
  console.log(`ok ${message}`);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

async function main(): Promise<void> {
  resetFailoverState();

  assert(parseModelTarget("opencode/big-pickle")?.modelID === "big-pickle", "a slash reference parses");
  assert(
    parseModelTarget("nvidia-nim/deepseek-ai/deepseek-v4-flash")?.modelID ===
      "deepseek-ai/deepseek-v4-flash",
    "a model id with slashes keeps the full tail",
  );
  assert(
    parseModelTarget({ providerID: "google", modelID: "gemini-flash-lite-latest" })?.providerID ===
      "google",
    "an object reference parses",
  );
  assert(parseModelTarget("no-slash") === undefined, "a reference without a provider is rejected");
  assert(parseModelTarget("provider/") === undefined, "a reference without a model is rejected");
  assert(parseModelTarget(undefined) === undefined, "a missing reference is rejected");

  const roleChain = getFallbackChain("dev");
  const resolved = resolveChain({ agent: "dev" });
  assert(resolved.length === roleChain.length, "the role chain is the default source");
  assert(resolved[0]?.target === roleChain[0], "the role chain keeps its primary first");

  const override: FallbackChainConfig = {
    chains: { dev: ["alpha/one", "beta/two"], "*": ["fallback/star"] },
  };
  const overridden = resolveChain({ config: override, agent: "dev" });
  assert(overridden.length === 2 && overridden[0]?.target === "alpha/one", "an explicit chain wins");
  const star = resolveChain({ config: override, agent: "doc" });
  assert(star.length === 1 && star[0]?.target === "fallback/star", "the star chain covers other agents");
  const deduped = resolveChain({ config: { chains: { dev: ["a/b", "a/b", "c/d"] } }, agent: "dev" });
  assert(deduped.length === 2, "a repeated chain entry is dropped");

  resetFailoverState();
  assert(
    planFailover({ agent: "dev" }).action === "keep",
    "a plan without a session id never switches",
  );
  assert(
    planFailover({
      config: { enabled: false },
      agent: "dev",
      sessionID: "s-disabled",
      model: parseModelTarget(roleChain[0] ?? ""),
    }).action === "keep",
    "an explicit disable stops the switch",
  );

  const primary = roleChain[0] ?? "";
  const secondary = roleChain[1] ?? "";
  const first = planFailover({
    agent: "dev",
    sessionID: "s-1",
    model: parseModelTarget(primary),
  });
  assert(first.action === "switch", "a provider refusal on the primary plans a switch");
  if (first.action !== "switch") return;
  assert(first.target === secondary, "the switch lands on the next chain entry");
  assert(first.delayMs >= 0 && first.delayMs <= 60_000, "the retry delay stays bounded");

  const unknown = planFailover({ agent: "dev", sessionID: "s-unknown", model: { providerID: "zzz", modelID: "nope" } });
  assert(unknown.action === "switch", "an unlisted current model still plans a switch");
  if (unknown.action === "switch") {
    assert(unknown.to.providerID !== "zzz", "the first chain entry is chosen");
  }

  resetFailoverState();
  commitFailover("s-2", primary);
  assert(failoverSwitchCount("s-2") === 1, "a committed switch is counted");
  assert(hasFailoverClaim("s-2"), "a committed switch claims the session");
  const second = planFailover({
    agent: "dev",
    sessionID: "s-2",
    model: parseModelTarget(secondary),
  });
  assert(second.action === "switch", "a second refusal can advance again");
  if (second.action === "switch") {
    assert(second.target !== secondary && second.target !== primary, "the next entry is not a repeat");
    commitFailover("s-2", second.target);
  }
  const capped = planFailover({
    agent: "dev",
    sessionID: "s-2",
    model: parseModelTarget(roleChain[2] ?? secondary),
  });
  assert(capped.action === "keep", "the default switch budget stops further moves");
  if (capped.action === "keep") assert(capped.reason === "max-switches", "the budget stop is reported");

  resetFailoverState();
  const budget = planFailover({
    config: { maxSwitches: 0 },
    agent: "dev",
    sessionID: "s-3",
    model: parseModelTarget(primary),
  });
  assert(budget.action === "keep", "a zero budget disables switching");

  resetFailoverState();
  const tiny: FallbackChainConfig = { chains: { dev: ["a/one", "b/two"] }, maxSwitches: 5 };
  const firstTry = planFailover({ config: tiny, agent: "dev", sessionID: "s-4", model: parseModelTarget("a/one") });
  assert(firstTry.action === "switch", "the first attempt on a tiny chain switches");
  recordFailoverMiss("s-4", "b/two");
  assert(failoverSwitchCount("s-4") === 0, "a rejected switch does not consume the budget");
  const exhausted = planFailover({ config: tiny, agent: "dev", sessionID: "s-4", model: parseModelTarget("a/one") });
  assert(exhausted.action === "keep", "a rejected target is not retried");
  if (exhausted.action === "keep") assert(exhausted.reason === "chain-exhausted", "the exhaustion is reported");

  resetFailoverState();
  const calls: Array<{ sessionID: string; model: string }> = [];
  const working = {
    switchModel: async (input: { sessionID: string; model: { providerID: string; modelID: string } }) => {
      calls.push({ sessionID: input.sessionID, model: `${input.model.providerID}/${input.model.modelID}` });
      return undefined;
    },
  };
  const switched = await switchSessionModel(working, "s-5", { providerID: "google", modelID: "gemini" });
  assert(switched, "a host with switchModel accepts the move");
  assert(calls.length === 1 && calls[0]?.model === "google/gemini", "the move reaches the host verbatim");

  assert(!(await switchSessionModel(undefined, "s-6", { providerID: "a", modelID: "b" })), "a host without switchModel fails closed");
  assert(!(await switchSessionModel({}, "s-6", { providerID: "a", modelID: "b" })), "an empty session fails closed");
  assert(
    !(await switchSessionModel(
      {
        switchModel: async () => {
          throw new Error("host refused");
        },
      },
      "s-7",
      { providerID: "a", modelID: "b" },
    )),
    "a host rejection fails closed",
  );

  clearFailoverClaim("s-2");
  assert(!hasFailoverClaim("s-2"), "a cleared claim releases the session");

  resetFailoverState();
  commitFailover("s-old", primary, Date.now() - FAILOVER_CLAIM_TTL_MS - 1);
  assert(!hasFailoverClaim("s-old"), "a stale claim stops suppressing the plugin retry");

  resetFailoverState();
  const defaultCap = planFailover({
    config: { maxSwitches: DEFAULT_MAX_SWITCHES + 100 },
    agent: "dev",
    sessionID: "s-8",
    model: parseModelTarget(primary),
  });
  assert(defaultCap.action === "switch", "an oversized budget is clamped, not rejected");
  assert(formatTarget({ providerID: "o", modelID: "m" }) === "o/m", "the target format is stable");

  const setup = readFileSync(join(repo, "src", "v2", "setup.ts"), "utf-8");
  assert(setup.includes("planFailover("), "the v2 retry hook plans a failover");
  assert(setup.includes("switchModelVia("), "the retry hook moves the session model");
  assert(setup.includes("payload.decision = { retry: true, delay: plan.delayMs }"), "an accepted move retries the turn");
  assert(setup.includes('signal === "free-daily-limit"'), "the free daily limit triggers a failover");
  assert(setup.includes('signal === "quota-exhausted"'), "an exhausted quota triggers a failover");

  const init = readFileSync(join(repo, "src", "bootstrap", "plugin-init.ts"), "utf-8");
  const claims = init.split("hasFailoverClaim(sessionId)").length - 1;
  assert(claims === 2, "both plugin retry paths defer to the failover claim");
  assert(init.includes("rememberActiveConfig(ctx.directory"), "the active config is registered for the retry hook");

  const schema = readFileSync(join(repo, "src", "context", "config-schema.ts"), "utf-8");
  assert(schema.includes("fallback: tool.schema"), "the config schema declares a fallback block");
  assert(schema.includes("chains: tool.schema"), "the fallback block accepts per-agent chains");

  console.log("PROOF PASS: provider refusal moves the session to the next curated model");
}

await main();
