import { PipelineState } from "../src/hooks/PipelineState.ts";
import {
  EXPLICIT_DISPATCH_REGEX,
  MIN_RING_PROMPT,
  REPORT_PATH_CLAUSE,
  REPORT_PATH_SENTINEL,
  RING_CAP,
  RING_TTL_MS,
  TAWA_MENTION_REGEX,
  classifyContent,
  hasReportPathSentinel,
  type RoutingRecord,
} from "../src/hooks/routing.ts";
import {
  firstResponseGuard,
  speculativeDispatchGuard,
  tawaRoutingEnforcementGuard,
} from "../src/hooks/guards/resource-guards.ts";
import {
  callDepthGuard,
  internalDuplicateGuard,
  recordDispatchPromptEffect,
  tawaRedirectGuard,
} from "../src/hooks/guards/dispatch-guards.ts";
import { getTaskAgents } from "../src/hooks/guards/shared/normalize.ts";
import { subagentArgsToV1, v1ArgsToSubagent } from "../src/v2/delegation.ts";
import { logger } from "../src/utils/logger.ts";

let passed = 0;

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
  passed++;
  console.log(`ok ${message}`);
}

type Out = { args: Record<string, unknown>; error?: string };

type Stage = {
  check: (ctx: never, input: never, output: never) => Promise<boolean>;
};

function ctxOf(state: PipelineState): Record<string, unknown> {
  return { pipelineState: state };
}

function recordOf(overrides: Partial<RoutingRecord> = {}): RoutingRecord {
  return {
    mode: "normal",
    directAgent: null,
    preferredAgent: null,
    source: "classified",
    latched: false,
    ...overrides,
  };
}

async function allows(
  stage: Stage,
  ctx: Record<string, unknown>,
  input: Record<string, unknown>,
  out: Out,
): Promise<boolean> {
  return stage.check(ctx as never, input as never, out as never);
}

function captureLogs<T>(fn: () => T): { value: T; infos: string[]; warns: string[] } {
  const originalInfo = logger.info;
  const originalWarn = logger.warn;
  const infos: string[] = [];
  const warns: string[] = [];
  logger.info = (message: string) => {
    infos.push(message);
  };
  logger.warn = (message: string) => {
    warns.push(message);
  };
  try {
    return { value: fn(), infos, warns };
  } finally {
    logger.info = originalInfo;
    logger.warn = originalWarn;
  }
}

assert(typeof classifyContent === "function", "classifyContent is exported");
assert(classifyContent.length === 1, "classifyContent takes exactly one argument");
assert(classifyContent("@tawa investigate the guard") === "tawa", "@tawa plus a verb classifies as tawa");
assert(classifyContent("please dispatch this to agents") === "explicit", "a dispatch verb alone classifies as explicit");
assert(classifyContent("read the file and summarize it") === "normal", "a plain message classifies as normal");
assert(classifyContent("ottawa meeting notes") === "normal", "the mention regex does not match ottawa");
assert(!TAWA_MENTION_REGEX.test(REPORT_PATH_SENTINEL), "the sentinel does not trip the tawa mention regex");
assert(!EXPLICIT_DISPATCH_REGEX.test(REPORT_PATH_SENTINEL), "the sentinel does not trip the dispatch regex");
assert(!TAWA_MENTION_REGEX.test(REPORT_PATH_CLAUSE), "the clause does not trip the tawa mention regex");
assert(!EXPLICIT_DISPATCH_REGEX.test(REPORT_PATH_CLAUSE), "the clause does not trip the dispatch regex");
assert(hasReportPathSentinel(`prompt text\n\n${REPORT_PATH_SENTINEL}`), "the sentinel is detected at the end");
assert(!hasReportPathSentinel(`${REPORT_PATH_SENTINEL}\n\nprompt text`), "the sentinel is not detected at the start");

const ringState = new PipelineState();
const storedPrompt = "z".repeat(40);
ringState.recordDispatchPrompt("parent", storedPrompt, "tawa");
assert(ringState.promptRing.length === 1, "a long dispatch prompt enters the ring");
const inherited = ringState.recordUserMessage("child", `${storedPrompt}${REPORT_PATH_CLAUSE}`);
assert(inherited.mode === "tawa", "a routed ring hit inherits tawa");
assert(inherited.source === "dispatch", "a ring hit records a dispatch source");
assert(inherited.latched === true, "a ring hit latches the dispatch record");
assert(ringState.promptRing.length === 1, "a ring match does not consume the entry");
const sibling = ringState.recordUserMessage("sibling", `${storedPrompt}${REPORT_PATH_CLAUSE}`);
assert(sibling.mode === "tawa" && sibling.source === "dispatch", "a second sibling inherits from the same entry");

const noSentinelState = new PipelineState();
noSentinelState.recordDispatchPrompt("parent", storedPrompt, "tawa");
const noSentinel = captureLogs(() => noSentinelState.recordUserMessage("child", storedPrompt));
assert(noSentinel.value.source === "classified", "a tawa ring hit without the sentinel does not inherit");
assert(noSentinel.value.mode === "normal", "the unsentinelled hit falls back to the message content");
assert(noSentinel.warns.some((line) => line.includes("without the sentinel")), "the rejected tawa hit is logged");

const loggedHit = captureLogs(() =>
  ringState.recordUserMessage("logged-child", `${storedPrompt}${REPORT_PATH_CLAUSE}`),
);
assert(loggedHit.value.source === "dispatch", "the logged hit still inherits");
assert(loggedHit.infos.some((line) => line.includes("dispatch ring hit")), "every ring hit is logged");

const coldState = new PipelineState();
const cold = coldState.recordUserMessage("cold", `handle this work ${REPORT_PATH_SENTINEL}`);
assert(cold.mode === "tawa", "a sentinel-only message records tawa");
assert(cold.source === "dispatch" && cold.latched === false, "a sentinel-only record does not latch");
const coldNext = coldState.recordUserMessage("cold", "plain follow up");
assert(coldNext.mode === "normal" && coldNext.source === "classified", "a sentinel-only record reverts on the next message");

const latchedNext = ringState.recordUserMessage("child", "plain follow up");
assert(latchedNext.mode === "tawa" && latchedNext.source === "dispatch", "a latched dispatch record survives a plain follow-up");
assert(latchedNext.latched === true, "the surviving dispatch record stays latched");

const classifiedState = new PipelineState();
const explicit = classifiedState.recordUserMessage("s", "please dispatch this to agents");
assert(explicit.mode === "explicit" && explicit.source === "classified", "an explicit request is classified");
const explicitNext = classifiedState.recordUserMessage("s", "plain follow up");
assert(explicitNext.mode === "normal" && explicitNext.source === "classified", "a classified record never latches");

const directState = new PipelineState();
const direct = directState.recordUserMessage("d", "ask dev to inspect the parser", "dev");
assert(direct.mode === "direct" && direct.directAgent === "dev", "a single-agent request records direct routing");
const directNext = directState.recordUserMessage("d", "plain follow up");
assert(directNext.mode === "normal" && directNext.directAgent === null, "the next message clears the direct agent");

const overrideState = new PipelineState();
overrideState.recordUserMessage("o", "plain message");
const preference = overrideState.recordOverridePreference("o", "dev");
assert(preference.source === "override" && preference.preferredAgent === "dev", "an override writes the preferred agent");
assert(preference.mode === "normal" && preference.latched === false, "a fresh override record stays normal and unlatched");
assert(
  await allows(
    speculativeDispatchGuard,
    ctxOf(overrideState),
    { tool: "edit", agent: "dev", sessionID: "o" },
    { args: {} },
  ),
  "the preferred agent may edit in its own turn",
);
const overrideBlockedOut: Out = { args: {} };
assert(
  !(await allows(
    speculativeDispatchGuard,
    ctxOf(overrideState),
    { tool: "edit", agent: "tester", sessionID: "o" },
    overrideBlockedOut,
  )),
  "another agent is blocked while the override preference stands",
);
assert((overrideBlockedOut.error ?? "").includes("@dev"), "the override refusal names the preferred agent");
assert(
  await allows(
    firstResponseGuard,
    ctxOf(overrideState),
    { tool: "task", agent: "dev", sessionID: "o" },
    { args: { subagent: ["explore"] } },
  ),
  "the preferred agent passes the first-response guard",
);
const cleared = overrideState.recordUserMessage("o", "plain next message");
assert(cleared.preferredAgent === null && cleared.source === "classified", "the next user message clears the preference");
assert(
  !(await allows(
    firstResponseGuard,
    ctxOf(overrideState),
    { tool: "task", agent: "dev", sessionID: "o" },
    { args: { subagent: ["explore"] } },
  )),
  "the cleared preference no longer exempts the agent",
);

const shared = new PipelineState();
shared.recordUserMessage("s-routed", "Please handle this @tawa");
shared.recordUserMessage("s-normal", "Read the files and summarize");
shared.recordUserMessage("s-explicit", "please dispatch this to agents");
shared.recordUserMessage("s-direct", "ask dev to inspect the parser", "dev");
assert(
  !(await allows(
    tawaRoutingEnforcementGuard,
    ctxOf(shared),
    { tool: "edit", agent: "analyst", sessionID: "s-routed" },
    { args: {} },
  )),
  "the routed session blocks edit",
);
assert(
  await allows(
    tawaRoutingEnforcementGuard,
    ctxOf(shared),
    { tool: "edit", agent: "analyst", sessionID: "s-normal" },
    { args: {} },
  ),
  "the normal session keeps edit while the routed session is blocked",
);
assert(
  !(await allows(
    speculativeDispatchGuard,
    ctxOf(shared),
    { tool: "edit", agent: "analyst", sessionID: "s-explicit" },
    { args: {} },
  )),
  "the explicit session blocks its own edit",
);
assert(
  await allows(
    speculativeDispatchGuard,
    ctxOf(shared),
    { tool: "edit", agent: "analyst", sessionID: "s-normal" },
    { args: {} },
  ),
  "the explicit block does not bleed into the normal session",
);
assert(
  await allows(
    firstResponseGuard,
    ctxOf(shared),
    { tool: "task", agent: "dev", sessionID: "s-direct" },
    { args: { subagent: ["explore"] } },
  ),
  "the direct session exempts its direct agent",
);
assert(
  !(await allows(
    firstResponseGuard,
    ctxOf(shared),
    { tool: "task", agent: "tester", sessionID: "s-direct" },
    { args: { subagent: ["explore"] } },
  )),
  "the direct exemption does not extend to another agent",
);

const tawaQuoted = new PipelineState();
tawaQuoted.recordDispatchPrompt("parent", "inspect the tawa routing notes and report back", "normal");
const quotedChild = tawaQuoted.recordUserMessage("child", "inspect the tawa routing notes and report back");
assert(quotedChild.mode === "normal", "a dispatch prompt that quotes tawa keeps its normal parent mode");
assert(quotedChild.source === "dispatch" && quotedChild.latched === true, "the normal parent records a latched dispatch");

const hostPreamble = "You are a subagent spawned by another session.\n";
const prefixedState = new PipelineState();
prefixedState.recordDispatchPrompt("parent", "inspect the parser and report back", "normal");
const prefixed = prefixedState.recordUserMessage("child", `${hostPreamble}inspect the parser and report back`);
assert(prefixed.source === "dispatch" && prefixed.latched === true, "a host-prefixed child prompt still matches the ring");
const prefixedQuoted = new PipelineState();
prefixedQuoted.recordDispatchPrompt("parent", "inspect the tawa routing notes and report back", "normal");
const prefixedQuotedChild = prefixedQuoted.recordUserMessage(
  "child",
  `${hostPreamble}inspect the tawa routing notes and report back`,
);
assert(
  prefixedQuotedChild.mode === "normal" && prefixedQuotedChild.source === "dispatch",
  "a host-prefixed child keeps the normal parent mode even when it quotes tawa",
);
const prefixedTawa = new PipelineState();
prefixedTawa.recordDispatchPrompt("parent", "investigate the failing guard today", "tawa");
const prefixedTawaChild = prefixedTawa.recordUserMessage("child", `${hostPreamble}investigate the failing guard today`);
assert(
  prefixedTawaChild.mode === "normal" && prefixedTawaChild.source === "classified",
  "a host-prefixed tawa hit without the sentinel still does not bleed",
);

const bleedState = new PipelineState();
bleedState.recordDispatchPrompt("parent", "investigate the failing guard today", "tawa");
const prefixMiss = bleedState.recordUserMessage("prefix-child", "investigate the failing guard today");
assert(prefixMiss.source === "classified" && prefixMiss.mode === "normal", "a tawa prefix without the sentinel does not bleed");

const handTyped = new PipelineState();
const handTypedRecord = handTyped.recordUserMessage("hand-child", `hand typed request\n\n${REPORT_PATH_SENTINEL}`);
assert(handTypedRecord.mode === "tawa" && handTypedRecord.source === "dispatch", "a hand-typed sentinel cold start is dispatch");
assert(handTypedRecord.latched === false, "the hand-typed sentinel does not latch");

const ttlState = new PipelineState();
ttlState.promptRing.push({
  dispatcherSessionID: "parent",
  prompt: "t".repeat(40),
  mode: "normal",
  at: Date.now() - RING_TTL_MS - 1,
});
const expired = ttlState.recordUserMessage("child", "t".repeat(40));
assert(expired.source === "classified" && expired.mode === "normal", "an expired entry does not match");
assert(ttlState.promptRing.length === 0, "an expired entry is removed on the next match");

const laterState = new PipelineState();
laterState.recordUserMessage("child", "plain first message");
laterState.recordDispatchPrompt("parent", "p".repeat(40), "normal");
const later = laterState.recordUserMessage("child", "p".repeat(40));
assert(later.source === "classified" && later.latched === false, "a session with a record does not inherit later");

const shortState = new PipelineState();
shortState.recordDispatchPrompt("parent", "x".repeat(MIN_RING_PROMPT - 1), "normal");
assert(shortState.promptRing.length === 0, "a prompt below the ring floor is not stored");
shortState.recordDispatchPrompt("parent", "y".repeat(MIN_RING_PROMPT), "normal");
assert(shortState.promptRing.length === 1, "a prompt at the ring floor is stored");
const shortChild = shortState.recordUserMessage("child", `${"y".repeat(MIN_RING_PROMPT)}${REPORT_PATH_CLAUSE}`);
assert(shortChild.source === "dispatch" && shortChild.latched === true, "a floor-length stored prompt matches its child");

const capState = new PipelineState();
for (let index = 0; index < RING_CAP + 1; index++) {
  capState.recordDispatchPrompt(`p${index}`, `prompt-${index}-${"q".repeat(30)}`, "normal");
}
assert(capState.promptRing.length === RING_CAP, "the ring holds at most sixty-four entries");
assert(capState.promptRing[0]?.prompt === `prompt-1-${"q".repeat(30)}`, "the oldest live entry is evicted first");
const capMiss = captureLogs(() => capState.recordUserMessage("child", `prompt-0-${"q".repeat(30)}`));
assert(capMiss.value.source === "classified", "an evicted entry falls back to classification");
assert(capMiss.warns.length === 0, "the eviction itself is reported when it happens, not at the miss");

const sweep = new PipelineState();
sweep.routing.set("sweep-only", recordOf());
sweep.promptRing.push({
  dispatcherSessionID: "sweep-only",
  prompt: "s".repeat(40),
  mode: "normal",
  at: Date.now(),
});
for (let index = 0; index < 60; index++) sweep.routing.set(`sweep-${index}`, recordOf({ mode: "tawa" }));
sweep.sweepStaleSessions();
assert(!sweep.routing.has("sweep-only"), "a routing-only session is evicted by the sweep");
assert(sweep.routing.size <= 50, "the sweep keeps the routing map under the session ceiling");
assert(!sweep.promptRing.some((entry) => entry.dispatcherSessionID === "sweep-only"), "the eviction drops the session ring entries");
assert(sweep.routing.size > 0, "the sweep keeps the live sessions");
sweep.resetAll();
assert(sweep.routing.size === 0, "resetAll clears the routing map");
assert(sweep.promptRing.length === 0, "resetAll clears the prompt ring");

const targetState = new PipelineState();
targetState.recordUserMessage("target-normal", "plain message");
targetState.recordUserMessage("target-tawa", "please handle this @tawa");
const targetNormalOut: Out = { args: { subagent: ["tawa"] } };
const targetTawaOut: Out = { args: { subagent: ["tawa"] } };
assert(
  !(await allows(
    tawaRedirectGuard,
    ctxOf(targetState),
    { tool: "task", agent: "analyst", sessionID: "target-normal" },
    targetNormalOut,
  )),
  "task(tawa) is refused in a normal session",
);
assert(
  !(await allows(
    tawaRedirectGuard,
    ctxOf(targetState),
    { tool: "task", agent: "analyst", sessionID: "target-tawa" },
    targetTawaOut,
  )),
  "task(tawa) is refused in a routed session",
);
const handoffNormalOut: Out = { args: { to: "tawa" } };
const handoffTawaOut: Out = { args: { to: "tawa" } };
assert(
  !(await allows(
    tawaRedirectGuard,
    ctxOf(targetState),
    { tool: "handoff", agent: "analyst", sessionID: "target-normal" },
    handoffNormalOut,
  )),
  "handoff(tawa) is refused in a normal session",
);
assert(
  !(await allows(
    tawaRedirectGuard,
    ctxOf(targetState),
    { tool: "handoff", agent: "analyst", sessionID: "target-tawa" },
    handoffTawaOut,
  )),
  "handoff(tawa) is refused in a routed session",
);

const depthState = new PipelineState();
depthState.callDepth.set("deep", 3);
const depthOut: Out = { args: { subagent: ["dev"] } };
assert(
  !(await allows(
    callDepthGuard,
    ctxOf(depthState),
    { tool: "task", agent: "analyst", sessionID: "deep" },
    depthOut,
  )),
  "the depth ceiling still blocks the fourth dispatch",
);
const depthMessage = depthOut.error ?? "";
assert(depthMessage.includes("caller"), "the depth message names the caller");
assert(!/@|[a-z]-?pickle|analyst|dev|tester/i.test(depthMessage), "the depth message names no agent");

const differential = new PipelineState();
differential.routing.set("analyst-classified", recordOf({ mode: "tawa", source: "classified" }));
differential.routing.set("analyst-dispatch", recordOf({ mode: "tawa", source: "dispatch" }));
differential.routing.set("analyst-normal", recordOf());
assert(
  !(await allows(
    tawaRoutingEnforcementGuard,
    ctxOf(differential),
    { tool: "edit", agent: "analyst", sessionID: "analyst-classified" },
    { args: {} },
  )),
  "a classified tawa record blocks analyst edit",
);
assert(
  await allows(
    tawaRoutingEnforcementGuard,
    ctxOf(differential),
    { tool: "edit", agent: "tawa", sessionID: "analyst-classified" },
    { args: {} },
  ),
  "the tawa agent keeps edit under a classified tawa record",
);
assert(
  await allows(
    tawaRoutingEnforcementGuard,
    ctxOf(differential),
    { tool: "edit", agent: "analyst", sessionID: "analyst-dispatch" },
    { args: {} },
  ),
  "a dispatch tawa record does not block analyst edit",
);
assert(
  await allows(
    tawaRoutingEnforcementGuard,
    ctxOf(differential),
    { tool: "edit", agent: "tawa", sessionID: "analyst-dispatch" },
    { args: {} },
  ),
  "a dispatch tawa record does not block tawa edit",
);
assert(
  await allows(
    tawaRoutingEnforcementGuard,
    ctxOf(differential),
    { tool: "edit", agent: "analyst", sessionID: "analyst-normal" },
    { args: {} },
  ),
  "a normal record does not block analyst edit",
);
assert(
  await allows(
    tawaRoutingEnforcementGuard,
    ctxOf(differential),
    { tool: "edit", agent: "tawa", sessionID: "analyst-normal" },
    { args: {} },
  ),
  "a normal record does not block tawa edit",
);

const effectState = new PipelineState();
effectState.recordUserMessage("parent", "plain message");
const taskOut: Out = { args: { prompt: "please inspect the parser and report back" } };
await allows(
  recordDispatchPromptEffect,
  ctxOf(effectState),
  { tool: "task", agent: "analyst", sessionID: "parent" },
  taskOut,
);
assert(effectState.promptRing.length === 1, "the dispatch effect records one task prompt");
assert(effectState.promptRing[0]?.dispatcherSessionID === "parent", "the ring entry names the dispatcher session");
assert(effectState.promptRing[0]?.mode === "normal", "the ring entry carries the dispatcher mode");
assert(taskOut.args.prompt === "please inspect the parser and report back", "the effect leaves a P1 prompt unchanged");
const handoffOut: Out = { args: { to: "dev", task: "inspect", context: "inspect the parser closely" } };
await allows(
  recordDispatchPromptEffect,
  ctxOf(effectState),
  { tool: "handoff", agent: "analyst", sessionID: "parent" },
  handoffOut,
);
assert(effectState.promptRing.length === 1, "the dispatch effect ignores handoff");
assert(handoffOut.args.context === "inspect the parser closely", "handoff never receives the clause");

const precedenceState = new PipelineState();
precedenceState.recordUserMessage("parent", "plain message");
await allows(
  recordDispatchPromptEffect,
  ctxOf(precedenceState),
  { tool: "task", agent: "analyst", sessionID: "parent" },
  { args: { prompt: "prompt value is the primary dispatch text", desc: "desc value is not chosen", description: "description value is not chosen" } },
);
assert(
  precedenceState.promptRing[0]?.prompt === "prompt value is the primary dispatch text",
  "the prompt key wins the mutation precedence",
);
await allows(
  recordDispatchPromptEffect,
  ctxOf(precedenceState),
  { tool: "task", agent: "analyst", sessionID: "parent" },
  { args: { prompt: "   ", desc: "desc value is the fallback dispatch text", description: "description value is not chosen" } },
);
assert(
  precedenceState.promptRing[1]?.prompt === "desc value is the fallback dispatch text",
  "the desc key is the first fallback",
);
await allows(
  recordDispatchPromptEffect,
  ctxOf(precedenceState),
  { tool: "task", agent: "analyst", sessionID: "parent" },
  { args: { description: "description value is the last fallback dispatch text" } },
);
assert(
  precedenceState.promptRing[2]?.prompt === "description value is the last fallback dispatch text",
  "the description key is the last fallback",
);
await allows(
  recordDispatchPromptEffect,
  ctxOf(precedenceState),
  { tool: "task", agent: "analyst", sessionID: "parent" },
  { args: { desc: ["first parallel dispatch prompt text", "second parallel dispatch prompt text"] } },
);
assert(precedenceState.promptRing.length === 5, "a parallel desc array records one entry per element");
assert(
  precedenceState.promptRing[3]?.prompt === "first parallel dispatch prompt text" &&
    precedenceState.promptRing[4]?.prompt === "second parallel dispatch prompt text",
  "parallel entries keep their own prompt text",
);

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const routedEffect = new PipelineState();
routedEffect.recordUserMessage("parent", "please handle this @tawa");
const routedTaskOut: Out = { args: { prompt: "inspect the parser and report your findings" } };
await allows(
  recordDispatchPromptEffect,
  ctxOf(routedEffect),
  { tool: "task", agent: "analyst", sessionID: "parent" },
  routedTaskOut,
);
const routedPrompt = String(routedTaskOut.args.prompt);
assert(
  routedPrompt === `inspect the parser and report your findings${REPORT_PATH_CLAUSE}`,
  "a routed dispatch appends exactly one clause",
);
assert(occurrences(routedPrompt, REPORT_PATH_SENTINEL) === 1, "the routed child prompt carries one sentinel");
assert(hasReportPathSentinel(routedPrompt), "the routed child prompt ends with the sentinel");
assert(
  !TAWA_MENTION_REGEX.test(routedPrompt),
  "the routed child prompt does not trip the tawa mention regex",
);
assert(
  !EXPLICIT_DISPATCH_REGEX.test(routedPrompt),
  "the routed child prompt does not trip the dispatch regex",
);
assert(
  routedEffect.promptRing[0]?.prompt === "inspect the parser and report your findings",
  "the ring stores the prompt before injection",
);
const inheritedChild = routedEffect.recordUserMessage("child", routedPrompt);
assert(
  inheritedChild.mode === "tawa" && inheritedChild.source === "dispatch" && inheritedChild.latched,
  "the injected child prompt inherits tawa through the ring",
);
const coldFromClause = new PipelineState().recordUserMessage("cold-child", routedPrompt);
assert(
  coldFromClause.mode === "tawa" && coldFromClause.source === "dispatch" && coldFromClause.latched === false,
  "the injected prompt cold-starts from the sentinel when the ring is empty",
);

const twiceOut: Out = { args: { prompt: routedPrompt } };
await allows(
  recordDispatchPromptEffect,
  ctxOf(routedEffect),
  { tool: "task", agent: "analyst", sessionID: "parent" },
  twiceOut,
);
assert(String(twiceOut.args.prompt) === routedPrompt, "a prompt that already ends with the sentinel is not injected twice");
assert(
  occurrences(String(twiceOut.args.prompt), REPORT_PATH_SENTINEL) === 1,
  "the re-dispatch keeps one sentinel",
);

const descRouted = new PipelineState();
descRouted.recordUserMessage("parent", "@tawa run this work");
const descOut: Out = { args: { desc: "inspect the failing guard and report back" } };
await allows(
  recordDispatchPromptEffect,
  ctxOf(descRouted),
  { tool: "task", agent: "analyst", sessionID: "parent" },
  descOut,
);
assert(
  descOut.args.desc === `inspect the failing guard and report back${REPORT_PATH_CLAUSE}`,
  "the desc fallback receives the clause in routed mode",
);
assert(
  descRouted.promptRing[0]?.prompt === "inspect the failing guard and report back",
  "the desc ring entry also stores the prompt before injection",
);

const parallelRouted = new PipelineState();
parallelRouted.recordUserMessage("parent", "@tawa split the work");
const parallelOut: Out = { args: { desc: ["inspect the parser closely and report back", "inspect the writer closely and report back"] } };
await allows(
  recordDispatchPromptEffect,
  ctxOf(parallelRouted),
  { tool: "task", agent: "analyst", sessionID: "parent" },
  parallelOut,
);
const parallelList = parallelOut.args.desc as string[];
assert(parallelList.length === 2, "the parallel list keeps both elements");
assert(
  parallelList.every((item) => hasReportPathSentinel(item) && occurrences(item, REPORT_PATH_SENTINEL) === 1),
  "each parallel element ends with exactly one sentinel",
);
assert(
  parallelList[0] === `inspect the parser closely and report back${REPORT_PATH_CLAUSE}` &&
    parallelList[1] === `inspect the writer closely and report back${REPORT_PATH_CLAUSE}`,
  "each parallel element carries its own full clause",
);
assert(
  parallelRouted.promptRing.length === 2 &&
    parallelRouted.promptRing[0]?.prompt === "inspect the parser closely and report back" &&
    parallelRouted.promptRing[1]?.prompt === "inspect the writer closely and report back",
  "each parallel element enters the ring before injection",
);

const bridged = subagentArgsToV1({
  agent: "explore",
  description: "Read package.json",
  prompt: "Read package.json and report the version",
});
assert(
  bridged.subagent === "explore" && bridged.agent === undefined,
  "the v2 bridge moves the host agent into subagent without duplication",
);
assert(getTaskAgents({ args: bridged }).allRaw.length === 1, "the bridged task carries exactly one target");
const bridgeOut: Out = { args: { ...bridged } };
assert(
  await allows(
    internalDuplicateGuard,
    ctxOf(new PipelineState()),
    { tool: "task", agent: "tawa", sessionID: "bridge" },
    bridgeOut,
  ),
  "the duplicate guard accepts the bridged dispatch",
);
const restored = v1ArgsToSubagent(bridged);
assert(restored.agent === "explore", "the bridge restores the host agent field");
const duplicateOut: Out = { args: { subagent: ["explore", "explore"] } };
assert(
  !(await allows(
    internalDuplicateGuard,
    ctxOf(new PipelineState()),
    { tool: "task", agent: "tawa", sessionID: "bridge" },
    duplicateOut,
  )),
  "the duplicate guard still rejects a genuine duplicate",
);

console.log(`PROOF PASS: report path routing and prompt ring (${passed} assertions)`);
