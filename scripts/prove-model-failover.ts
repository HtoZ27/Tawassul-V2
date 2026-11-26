import "./proof-log-isolate.ts";
import {
  DEFAULT_MAX_SWITCHES,
  FAILOVER_CLAIM_TTL_MS,
  commitFailover,
  failoverSummary,
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
import {
  FALLBACK_CHAINS,
  FREE_FALLBACK_MODEL,
  getFallbackChain,
} from "../src/services/proxy-fallback-chains.ts";
import { configSchema } from "../src/context/config-schema.ts";
import {
  runRetryFailover,
  type RetryFailoverPayload,
} from "../src/v2/setup.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
  console.log(`ok ${message}`);
}

async function main(): Promise<void> {
  resetFailoverState();

  assert(parseModelTarget("opencode/big-pickle")?.modelID === "big-pickle", "a slash reference parses");
  assert(
    parseModelTarget("nvidia/deepseek-ai/deepseek-v4.1-flash")?.modelID ===
      "deepseek-ai/deepseek-v4.1-flash",
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

  assert(
    FREE_FALLBACK_MODEL === "google/gemini-flash-lite-latest",
    "the free fallback is gemini flash-lite latest",
  );
  for (const [role, chain] of Object.entries(FALLBACK_CHAINS)) {
    const free = chain.indexOf(FREE_FALLBACK_MODEL);
    assert(free === 0 || free === 1, `the ${role} chain switches to the free fallback first`);
    assert(
      !chain.some((model) => model.startsWith("nvidia-nim/")),
      `the ${role} chain drops the retired nvidia-nim provider`,
    );
    assert(
      chain.filter((model) => model.startsWith("nvidia/")).every((model) => !model.startsWith("nvidia/nvidia-nim")),
      `the ${role} chain avoids the nvidia-nim provider`,
    );
    assert(
      !chain.includes("nvidia/deepseek-ai/deepseek-v4.1-flash"),
      `the ${role} chain drops the end-of-life nvidia deepseek`,
    );
  }
  const roleChain = getFallbackChain("dev");
  const resolved = resolveChain({ agent: "dev" });
  assert(resolved.length === roleChain.length, "the role chain is the default source");
  assert(resolved[0]?.target === roleChain[0], "the role chain keeps its primary first");
  assert(resolved[1]?.target === FREE_FALLBACK_MODEL, "a failed primary switches to the free fallback");
  const unknownRoleChain = getFallbackChain("no-such-role");
  assert(
    unknownRoleChain.indexOf(FREE_FALLBACK_MODEL) === 1,
    "an unknown role still switches to the free fallback",
  );

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
    switchModel: async (input: { sessionID: string; model: { id: string; providerID: string } }) => {
      calls.push({ sessionID: input.sessionID, model: `${input.model.providerID}/${input.model.id}` });
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

  resetFailoverState();
  commitFailover("s-old", primary, Date.now() - FAILOVER_CLAIM_TTL_MS - 1);
  assert(!hasFailoverClaim("s-old"), "a stale claim stops suppressing the plugin retry");

  resetFailoverState();
  const missBase = Date.now();
  commitFailover("s-miss", primary, missBase);
  recordFailoverMiss("s-miss", secondary, missBase + 1_000);
  assert(
    hasFailoverClaim("s-miss", missBase + FAILOVER_CLAIM_TTL_MS),
    "a miss before the deadline keeps the committed claim live",
  );
  assert(
    !hasFailoverClaim("s-miss", missBase + FAILOVER_CLAIM_TTL_MS + 1),
    "a miss does not renew the five-minute claim",
  );

  resetFailoverState();
  const tinyMiss = { chains: { dev: ["a/one", "b/two"] }, maxSwitches: 5 };
  const missNow = Date.now();
  const planned = planFailover({
    config: tinyMiss,
    agent: "dev",
    sessionID: "s-miss-expire",
    model: parseModelTarget("a/one"),
  });
  assert(planned.action === "switch", "the tiny chain plans the first switch");
  recordFailoverMiss("s-miss-expire", "b/two", missNow);
  const stillSkipped = planFailover({
    config: tinyMiss,
    agent: "dev",
    sessionID: "s-miss-expire",
    model: parseModelTarget("a/one"),
    now: missNow + FAILOVER_CLAIM_TTL_MS,
  });
  assert(stillSkipped.action === "keep", "a rejected target stays skipped inside the window");
  const retried = planFailover({
    config: tinyMiss,
    agent: "dev",
    sessionID: "s-miss-expire",
    model: parseModelTarget("a/one"),
    now: missNow + FAILOVER_CLAIM_TTL_MS + 1,
  });
  assert(retried.action === "switch", "an expired miss is retried instead of barring the session");
  if (retried.action === "switch") assert(retried.target === "b/two", "the expired miss target is retried");

  resetFailoverState();
  const episodeBase = Date.now();
  commitFailover("s-episode", primary, episodeBase);
  commitFailover("s-episode", secondary, episodeBase);
  assert(failoverSwitchCount("s-episode") === 2, "two switches fill the default episode budget");
  const afterEpisode = planFailover({
    agent: "dev",
    sessionID: "s-episode",
    model: parseModelTarget(primary),
    now: episodeBase + FAILOVER_CLAIM_TTL_MS + 1,
  });
  assert(afterEpisode.action === "switch", "an expired episode restores the switch budget");
  assert(failoverSwitchCount("s-episode") === 0, "the expired episode starts at zero switches");

  resetFailoverState();
  const defaultCap = planFailover({
    config: { maxSwitches: DEFAULT_MAX_SWITCHES + 100 },
    agent: "dev",
    sessionID: "s-8",
    model: parseModelTarget(primary),
  });
  assert(defaultCap.action === "switch", "an oversized budget is clamped, not rejected");
  assert(formatTarget({ providerID: "o", modelID: "m" }) === "o/m", "the target format is stable");

  resetFailoverState();
  assert(failoverSummary().sessions === 0, "an empty failover table reports zero");
  commitFailover("s-summary", "alpha/one");
  const oneSummary = failoverSummary();
  assert(oneSummary.switches === 1 && oneSummary.claimed === 1, "a live switch is counted and claimed");
  assert(oneSummary.sessions === 1, "the tracked session is counted");
  commitFailover("s-summary", "alpha/two", Date.now() - FAILOVER_CLAIM_TTL_MS - 1);
  const staleSummary = failoverSummary();
  assert(staleSummary.switches === 2 && staleSummary.claimed === 0, "a stale claim is counted but not live");

  resetFailoverState();
  const retryCalls: Array<{ sessionID: string; model: string }> = [];
  const retrySession = {
    switchModel: async (input: {
      sessionID: string;
      model: { id: string; providerID: string };
    }) => {
      retryCalls.push({
        sessionID: input.sessionID,
        model: `${input.model.providerID}/${input.model.id}`,
      });
    },
  };
  const retryPayload: RetryFailoverPayload = {
    error: { message: "Free usage limit reached" },
    sessionID: "s-retry",
    agent: "dev",
    model: primary,
  };
  await runRetryFailover(retryPayload, {
    switchModel: retrySession.switchModel,
    fallback: { chains: { dev: [primary, secondary] } },
  });
  assert(retryCalls.length === 1, "the retry hook asks the host to switch the model");
  assert(retryCalls[0]?.model === secondary, "the retry hook moves to the next chain entry");
  const accepted = retryPayload.decision as { retry?: boolean; delay?: number } | undefined;
  assert(accepted?.retry === true, "an accepted move retries the turn");
  assert(
    typeof accepted?.delay === "number" && accepted.delay >= 0 && accepted.delay <= 60_000,
    "the accepted retry carries a bounded cooldown",
  );

  resetFailoverState();
  const disabledPayload: RetryFailoverPayload = {
    error: { message: "Free usage limit reached" },
    sessionID: "s-retry-disabled",
    agent: "dev",
    model: primary,
  };
  await runRetryFailover(disabledPayload, {
    switchModel: retrySession.switchModel,
    fallback: { enabled: false },
  });
  assert(retryCalls.length === 1, "a disabled fallback never calls the host switch");
  assert(disabledPayload.decision === undefined, "a disabled fallback leaves the retry decision untouched");

  const terminalPayload: RetryFailoverPayload = {
    error: { message: "payment_required" },
    sessionID: "s-retry-terminal",
    agent: "dev",
    model: primary,
  };
  await runRetryFailover(terminalPayload, {
    switchModel: retrySession.switchModel,
    fallback: { enabled: false },
  });
  assert(retryCalls.length === 1, "a terminal refusal with fallback disabled never calls the host switch");
  assert(
    JSON.stringify(terminalPayload.decision) === JSON.stringify({ retry: false }),
    "a terminal refusal sets the no-retry decision",
  );

  resetFailoverState();
  let releaseSwitch: () => void = () => undefined;
  const switchGate = new Promise<void>((resolve) => {
    releaseSwitch = resolve;
  });
  let concurrentSwitches = 0;
  const slowSession = {
    switchModel: async () => {
      concurrentSwitches += 1;
      await switchGate;
    },
  };
  const firstRace: RetryFailoverPayload = {
    error: { message: "Free usage limit reached" },
    sessionID: "s-retry-race",
    agent: "dev",
    model: primary,
  };
  const secondRace: RetryFailoverPayload = {
    error: { message: "Free usage limit reached" },
    sessionID: "s-retry-race",
    agent: "dev",
    model: primary,
  };
  const firstRun = runRetryFailover(firstRace, {
    switchModel: slowSession.switchModel,
    fallback: { chains: { dev: [primary, secondary] } },
  });
  const secondRun = runRetryFailover(secondRace, {
    switchModel: slowSession.switchModel,
    fallback: { chains: { dev: [primary, secondary] } },
  });
  releaseSwitch();
  await Promise.all([firstRun, secondRun]);
  assert(concurrentSwitches === 1, "concurrent retries plan a single model switch");
  assert(secondRace.decision === undefined, "the duplicate retry leaves the decision to the first");

  const acceptedConfig = configSchema.safeParse({
    fallback: { enabled: false, maxSwitches: 1, cooldownMs: 500, chains: { dev: [primary] } },
  });
  assert(acceptedConfig.success, "the config schema accepts a fallback block with chains");
  assert(!configSchema.safeParse({ fallback: { maxSwitches: 999 } }).success, "the config schema bounds the switch budget");
  assert(!configSchema.safeParse({ fallback: { cooldownMs: -1 } }).success, "the config schema bounds the cooldown");

  console.log("PROOF PASS: provider refusal moves the session to the next curated model");
}

await main();
