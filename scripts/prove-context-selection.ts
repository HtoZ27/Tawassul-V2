import "./proof-log-isolate.ts";
import { selectConversation } from "../src/services/context-pack/select.ts";
import { byteLength } from "../src/services/context-pack/accounting.ts";
import type { PackMessage } from "../src/services/context-pack/types.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

function main(): void {
  const messages: PackMessage[] = [
    { role: "user", content: "FIRST-REQUEST-PINNED" },
    { role: "assistant", content: "answer one" },
    { role: "user", content: "CURRENT-REQUEST-INTACT" },
  ];
  const roomy = selectConversation(messages, 10000);
  assert(roomy.text.includes("FIRST-REQUEST-PINNED"), "the first request stays pinned");
  assert(roomy.text.includes("CURRENT-REQUEST-INTACT"), "the current request stays whole");
  assert(!roomy.overflow, "a roomy selection does not overflow");

  const tight = selectConversation(messages, byteLength("[user]\nCURRENT-REQUEST-INTACT"));
  assert(!tight.text.includes("FIRST-REQUEST-PINNED"), "the oldest request is dropped under pressure");
  assert(tight.text.includes("CURRENT-REQUEST-INTACT"), "the current request is never truncated");
  assert(!tight.overflow, "a tight but valid selection is not an overflow");

  const tooSmall = selectConversation(messages, 4);
  assert(tooSmall.overflow, "a current request larger than the budget is an overflow");
  assert(tooSmall.text === "", "an overflow selects no partial text");

  const toolTurn: PackMessage[] = [
    { role: "user", content: "run the tool" },
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolName: "readsymbol", input: { symbol: "main" } },
      ],
    },
    { role: "tool", content: [{ type: "tool-result", output: "TOOL-RESULT-BODY" }] },
  ];
  const toolSelection = selectConversation(toolTurn, 10000);
  assert(toolSelection.text.includes("readsymbol"), "the tool call is kept");
  assert(toolSelection.text.includes("TOOL-RESULT-BODY"), "the tool result stays attached to its call");

  const arabic = Buffer.from([216, 173, 216, 178, 217, 133, 216, 169, 32, 216, 167, 217, 132, 216, 179, 217, 138, 216, 167, 217, 130, 32, 216, 170, 216, 168, 217, 130, 217, 137, 32, 217, 131, 216, 167, 217, 133, 217, 132, 216, 169]).toString("utf8");
  const unicodeSelection = selectConversation([{ role: "user", content: arabic }], 10000);
  assert(unicodeSelection.text.includes(arabic), "arabic text is not split mid-codepoint");
  assert(unicodeSelection.bytes === byteLength(unicodeSelection.text), "selection measures utf-8 bytes");

  const empty = selectConversation([], 1000);
  assert(empty.text === "" && !empty.overflow, "an empty history selects nothing");
  console.log("PROOF PASS: selection pins the first request and keeps turn boundaries");
}

main();
