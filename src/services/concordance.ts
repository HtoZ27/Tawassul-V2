import { TAWASSUL_TOOL_NAMES } from "../tool-names.ts";

const HEADER = "## 🗺️ System Concordance — where the live data lives";
const INTRO =
  "The ONLY source of truth is these tools. Never search plugin files or the MCP server for a feature:";
const GOAL_BOARD =
  "- `goal(board: true)` -> tiered goals board (goals + items + DoD) — fastest review";
const GOAL_LIST =
  '- `goal(list: true)` -> all active goals · `goal(get: "G-xxx")` -> one goal with its items';
const GOAL_CREATE =
  '- `goal(create: "<title>")` -> create a goal right here — never hunt for goal storage';
const FOOTER =
  "Reviewed a goal? Update it right here via `goal(update|evidence|close)` — do not assume it lives anywhere else.";

const SHOW_BOARD = "`show_board` -> mission boards";
const TIMELINE = "`timeline()` -> activity timeline";
const RECORD = "`record(list: true)` -> session decisions/records";
const HANDOFF =
  "`handoff(to: ..., task: ..., context: ...)` -> hand a task to an agent";
const USER_CONTRACT =
  "- User skills and commands are unconditional: the plugin never reads, gates, prefixes or overrides them · shipped ids use the `tawassul-` prefix";

function renderLine(parts: readonly string[]): string | null {
  return parts.length === 0 ? null : `- ${parts.join(" · ")}`;
}

export function buildConcordance(available: ReadonlySet<string>): string {
  const lines: string[] = ["", HEADER, INTRO];
  const hasGoal = available.has("goal");
  if (hasGoal) lines.push(GOAL_BOARD, GOAL_LIST, GOAL_CREATE);
  const board = renderLine([
    ...(available.has("show_board") ? [SHOW_BOARD] : []),
    ...(available.has("timeline") ? [TIMELINE] : []),
  ]);
  if (board) lines.push(board);
  const ledger = renderLine([
    ...(available.has("record") ? [RECORD] : []),
    ...(available.has("handoff") ? [HANDOFF] : []),
  ]);
  if (ledger) lines.push(ledger);
  lines.push(USER_CONTRACT);
  if (hasGoal) lines.push(FOOTER);
  return lines.join("\n");
}

export const ALL_TOOLS: ReadonlySet<string> = new Set(TAWASSUL_TOOL_NAMES);

export const SYSTEM_CONCORDANCE_TEXT = buildConcordance(ALL_TOOLS);
