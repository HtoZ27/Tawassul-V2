import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_TOOLS,
  SYSTEM_CONCORDANCE_TEXT,
  buildConcordance,
} from "../src/services/concordance.ts";
import {
  optionalToolAvailability,
  registeredToolNames,
} from "../src/bootstrap/tool-registry.ts";
import { TAWASSUL_TOOL_NAMES } from "../src/tool-names.ts";
import { buildGoalTool } from "../src/tools/goal.ts";
import { buildRecordTool } from "../src/tools/record.ts";
import { buildHandoffTool } from "../src/tools/handoff.ts";
import { buildShowBoardTool } from "../src/tools/tawa/show-board.ts";
import { buildTimelineTool } from "../src/tools/timeline.ts";
import type { ToolDefinition } from "../src/tool.ts";

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

const LEGACY_TEXT = [
  "",
  "## 🗺️ System Concordance — where the live data lives",
  "The ONLY source of truth is these tools. Never search plugin files or the MCP server for a feature:",
  "- `goal(board: true)` -> tiered goals board (goals + items + DoD) — fastest review",
  '- `goal(list: true)` -> all active goals · `goal(get: "G-xxx")` -> one goal with its items',
  '- `goal(create: "<title>")` -> create a goal right here — never hunt for goal storage',
  "- `show_board` -> mission boards · `timeline()` -> activity timeline",
  "- `record(list: true)` -> session decisions/records · `handoff(to: ..., task: ..., context: ...)` -> hand a task to an agent",
  "Reviewed a goal? Update it right here via `goal(update|evidence|close)` — do not assume it lives anywhere else.",
].join("\n");

const fake = {} as never;
const definitions: Record<string, ToolDefinition> = {
  goal: buildGoalTool(fake),
  show_board: buildShowBoardTool(fake),
  timeline: buildTimelineTool(fake),
  record: buildRecordTool(fake),
  handoff: buildHandoffTool(fake),
};

const REFERENCE_REGEX = /`([a-z_]+)\(([^`]*)\)`/g;
const BARE_REGEX = /`([a-z_]+)`/g;

function referencedCalls(text: string): Array<{ tool: string; params: string[] }> {
  const calls: Array<{ tool: string; params: string[] }> = [];
  for (const match of text.matchAll(REFERENCE_REGEX)) {
    const tool = match[1]!;
    const expr = match[2]!;
    const params = expr
      .split(/[|,]/)
      .map((chunk) => chunk.split(":")[0]!.replace(/\.\.\./g, "").trim())
      .filter((name) => name.length > 0);
    calls.push({ tool, params });
  }
  return calls;
}

function mentionedTools(text: string): Set<string> {
  const names = new Set(referencedCalls(text).map((call) => call.tool));
  for (const match of text.matchAll(BARE_REGEX)) names.add(match[1]!);
  return names;
}

assert(SYSTEM_CONCORDANCE_TEXT === LEGACY_TEXT, "the full surface is byte-identical to the previous text");
assert(buildConcordance(ALL_TOOLS) === SYSTEM_CONCORDANCE_TEXT, "the builder is deterministic across calls");
assert(
  ALL_TOOLS.size === TAWASSUL_TOOL_NAMES.length &&
    TAWASSUL_TOOL_NAMES.every((name) => ALL_TOOLS.has(name)),
  "the default surface is built from the shipped tool list",
);

const combos: Array<{ label: string; present: string[] }> = [
  { label: "goal and timeline", present: ["goal", "timeline"] },
  { label: "goal only", present: ["goal"] },
  { label: "timeline only", present: ["timeline"] },
  { label: "neither", present: [] },
];

for (const combo of combos) {
  const names = new Set(["show_board", "record", "handoff", ...combo.present]);
  const text = buildConcordance(names);
  const calls = referencedCalls(text);
  const mentioned = mentionedTools(text);
  if (combo.present.includes("goal")) {
    assert(mentioned.has("goal"), `${combo.label}: the goal surface is advertised`);
  } else {
    assert(!mentioned.has("goal"), `${combo.label}: goal is not advertised`);
    assert(!text.includes("Reviewed a goal?"), `${combo.label}: the goal footer is dropped`);
  }
  if (combo.present.includes("timeline")) {
    assert(mentioned.has("timeline"), `${combo.label}: timeline is advertised`);
  } else {
    assert(!mentioned.has("timeline"), `${combo.label}: timeline is not advertised`);
  }
  for (const call of calls) {
    const definition = definitions[call.tool];
    if (!definition) fail(`${combo.label}: the text names an unregistered tool ${call.tool}`);
    const available = Object.keys(definition.args);
    for (const param of call.params) {
      if (!available.includes(param)) {
        fail(`${combo.label}: ${call.tool} does not accept the documented parameter ${param}`);
      }
    }
  }
  assert(
    mentioned.has("show_board") && mentioned.has("record") && mentioned.has("handoff"),
    `${combo.label}: the unconditional tools stay advertised`,
  );
}

const fullCalls = referencedCalls(LEGACY_TEXT);
const fullParams = fullCalls.reduce((total, call) => total + call.params.length, 0);
assert(
  fullCalls.length === 8 && fullParams === 11,
  `the full surface documents ${fullCalls.length} calls over ${fullParams} parameters`,
);

const withoutStores = registeredToolNames(undefined);
assert(
  !withoutStores.has("goal") && !withoutStores.has("timeline"),
  "a host without the optional stores hides both optional tools",
);
assert(
  TAWASSUL_TOOL_NAMES.length - 2 === withoutStores.size,
  "only the two optional tools are removed",
);

const withStores = registeredToolNames({
  goalStore: {},
  timelineStore: {},
} as never);
assert(
  withStores.has("goal") && withStores.size === TAWASSUL_TOOL_NAMES.length,
  "a host with both stores advertises the whole surface",
);

assert(
  JSON.stringify(optionalToolAvailability(undefined)) ===
    JSON.stringify({ timeline: false, goal: false }),
  "the availability predicate reports both stores as absent",
);
assert(
  optionalToolAvailability({ goalStore: {}, timelineStore: {} } as never).goal === true,
  "the availability predicate follows the goal store",
);

for (const services of [
  undefined,
  { goalStore: {}, timelineStore: {} } as never,
  { goalStore: {} } as never,
  { timelineStore: {} } as never,
]) {
  const registered = registeredToolNames(services);
  const text = buildConcordance(registered);
  for (const call of referencedCalls(text)) {
    if (!registered.has(call.tool)) fail(`the text advertises ${call.tool} while the registry omits it`);
  }
}

const messageHook = readFileSync(join(repo, "src", "hooks", "message-updated.ts"), "utf-8");
const sessionHook = readFileSync(join(repo, "src", "hooks", "session.ts"), "utf-8");
const hooksRegistration = readFileSync(join(repo, "src", "bootstrap", "hooks-registration.ts"), "utf-8");
const toolRegistry = readFileSync(join(repo, "src", "bootstrap", "tool-registry.ts"), "utf-8");

assert(
  messageHook.includes("ctx.concordanceText ?? SYSTEM_CONCORDANCE_TEXT"),
  "the message hook injects the per-session surface",
);
assert(
  sessionHook.includes("ctx.concordanceText ?? SYSTEM_CONCORDANCE_TEXT"),
  "the compaction hook injects the per-session surface",
);
assert(
  hooksRegistration.includes("buildConcordance(registeredToolNames(services))"),
  "both hooks receive the surface derived from the live registry",
);
assert(
  toolRegistry.includes("...(optional.timeline && services?.timelineStore") &&
    toolRegistry.includes("...(optional.goal && services?.goalStore"),
  "the registry gates both optional tools on the same predicate",
);

const concordanceSource = readFileSync(join(repo, "src", "services", "concordance.ts"), "utf-8");
for (const pattern of ["Date.now", "new Date", "Math.random", "randomUUID", "performance.now"]) {
  assert(!concordanceSource.includes(pattern), `the surface carries no ${pattern}`);
}
assert(
  SYSTEM_CONCORDANCE_TEXT.startsWith("\n## ") &&
    SYSTEM_CONCORDANCE_TEXT.endsWith("lives anywhere else."),
  "the surface keeps its leading break and closing line",
);
assert(
  SYSTEM_CONCORDANCE_TEXT.split("\n").length === LEGACY_TEXT.split("\n").length,
  "the full surface keeps its line count",
);

console.log("PROOF PASS: the system concordance follows the registered tool surface");
