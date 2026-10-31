import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { buildToolJsonSchema } from "../src/lib/tool-schema-injection.ts";
import { runChatMessageBridge } from "../src/v2/setup.ts";

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

type Part = { type: string; text?: string; [key: string]: unknown };
type Message = { role: string; content?: unknown; id?: string; [key: string]: unknown };

type Bridge = {
  calls: number;
  injected: string[];
};

function makePlugin(bridge: Bridge) {
  return {
    "chat.message": async (_input: unknown, output: { parts: Part[] }) => {
      bridge.calls += 1;
      for (const text of bridge.injected) output.parts.push({ type: "text", text });
    },
  } as unknown as Parameters<typeof runChatMessageBridge>[0];
}

function event(sessionID: string, messages: Message[]) {
  return { sessionID, messages } as unknown as Parameters<typeof runChatMessageBridge>[1];
}

function bridgeOnce(messages: Message[], bridge: Bridge, processed = new Set<string>(), sessionID = "ses_cache") {
  return runChatMessageBridge(makePlugin(bridge), event(sessionID, messages), processed);
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

function at<T>(items: T[], index: number): T {
  const value = items[index];
  if (value === undefined) fail(`missing message at index ${index}`);
  return value;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

async function main(): Promise<void> {
  {
    const bridge: Bridge = { calls: 0, injected: ["\n\nMODE"] };
    const messages: Message[] = [{ id: "msg_01", role: "user", content: "hello" }];
    const processed = new Set<string>();
    await bridgeOnce(messages, bridge, processed);
    await bridgeOnce(messages, bridge, processed);
    assert(bridge.calls === 1, "a message with an id is bridged exactly once");
    assert((at(messages, 0).content as Part[]).length === 2, "the identified message keeps one injection");
  }

  {
    const bridge: Bridge = { calls: 0, injected: ["\n\nMODE"] };
    const messages: Message[] = [{ role: "user", content: "hello" }];
    const processed = new Set<string>();
    await bridgeOnce(messages, bridge, processed);
    const afterFirst = stable(at(messages, 0).content);
    await bridgeOnce(messages, bridge, processed);
    await bridgeOnce(messages, bridge, processed);
    assert(bridge.calls === 1, "an unidentified message is bridged exactly once");
    assert(stable(at(messages, 0).content) === afterFirst, "re-emitting an unidentified message leaves the payload byte-identical");
    assert((at(messages, 0).content as Part[]).length === 2, "the unidentified message keeps one injection");
  }

  {
    const bridge: Bridge = { calls: 0, injected: ["\n\nMODE"] };
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "part one" }, { type: "text", text: "part two" }] },
    ];
    const processed = new Set<string>();
    await bridgeOnce(messages, bridge, processed);
    const afterFirst = stable(at(messages, 0).content);
    await bridgeOnce(messages, bridge, processed);
    assert(bridge.calls === 1, "an unidentified multipart message is bridged exactly once");
    assert(stable(at(messages, 0).content) === afterFirst, "the multipart payload stays byte-identical");
  }

  {
    const bridge: Bridge = { calls: 0, injected: ["\n\nMODE"] };
    const first: Message[] = [{ role: "user", content: "hello" }];
    await bridgeOnce(first, bridge);
    const carried = JSON.parse(stable(at(first, 0).content)) as Part[];
    const fresh: Message[] = [{ role: "user", content: carried }];
    const before = stable(at(fresh, 0).content);
    await bridgeOnce(fresh, bridge);
    assert(bridge.calls === 2, "a fresh message object reaches the hook again");
    assert(stable(at(fresh, 0).content) === before, "an already-injected text is never appended twice");
  }

  {
    const bridge: Bridge = { calls: 0, injected: ["\n\nA", "\n\nB"] };
    const messages: Message[] = [
      { id: "msg_a", role: "user", content: "first" },
      { id: "msg_b", role: "assistant", content: "reply" },
      { id: "msg_c", role: "user", content: "second" },
    ];
    const prefix = stable([at(messages, 0), at(messages, 1)]);
    const processed = new Set<string>();
    await bridgeOnce(messages, bridge, processed);
    assert(bridge.calls === 1, "only the last message is bridged");
    assert(stable([at(messages, 0), at(messages, 1)]) === prefix, "earlier messages are never rewritten");
    assert((at(messages, 2).content as Part[]).length === 3, "the last message receives both injections");
  }

  {
    const bridge: Bridge = { calls: 0, injected: ["\n\nMODE"] };
    const messages: Message[] = [{ id: "msg_a", role: "user", content: "first" }];
    const processed = new Set<string>();
    await bridgeOnce(messages, bridge, processed);
    messages.push({ id: "msg_b", role: "assistant", content: "answer" });
    await bridgeOnce(messages, bridge, processed);
    assert(bridge.calls === 2, "a new tail message is bridged on its own");
    assert((at(messages, 0).content as Part[]).length === 2, "the earlier tail keeps its single injection");
    assert((at(messages, 1).content as Part[]).length === 2, "the new tail is injected once");
  }

  {
    const random = seeded(20261031);
    for (let round = 0; round < 64; round += 1) {
      const bridge: Bridge = { calls: 0, injected: ["\n\nP1", "\n\nP2"] };
      const length = 1 + Math.floor(random() * 6);
      const text = `payload-${round}-${"x".repeat(length * 7)}`;
      const messages: Message[] =
        random() < 0.5
          ? [{ role: "user", content: text }]
          : [{ role: "user", content: [{ type: "text", text }] }];
      const processed = new Set<string>();
      await bridgeOnce(messages, bridge, processed, `ses_prop_${round}`);
      const settled = stable(at(messages, 0).content);
      await bridgeOnce(messages, bridge, processed, `ses_prop_${round}`);
      await bridgeOnce(messages, bridge, processed, `ses_prop_${round}`);
      if (bridge.calls !== 1) fail(`property round ${round}: bridged ${bridge.calls} times`);
      if (stable(at(messages, 0).content) !== settled) fail(`property round ${round}: payload drifted`);
    }
    console.log("ok the idempotence property holds across 64 generated payloads");
  }

  {
    const left: Bridge = { calls: 0, injected: ["\n\nMODE"] };
    const right: Bridge = { calls: 0, injected: ["\n\nMODE"] };
    const a: Message[] = [{ role: "user", content: "same input" }];
    const b: Message[] = [{ role: "user", content: "same input" }];
    await bridgeOnce(a, left, new Set<string>(), "ses_same");
    await bridgeOnce(b, right, new Set<string>(), "ses_same");
    assert(stable(at(a, 0).content) === stable(at(b, 0).content), "the same input produces the same payload across runs");
  }

  {
    const bridge: Bridge = { calls: 0, injected: ["\n\nMODE"] };
    const processed = new Set<string>();
    const first: Message[] = [{ role: "user", content: "continue" }];
    await bridgeOnce(first, bridge, processed, "ses_identical");
    const second: Message[] = [{ role: "user", content: "continue" }];
    await bridgeOnce(second, bridge, processed, "ses_identical");
    assert(bridge.calls === 2, "two distinct id-less messages with identical text are both bridged");
    assert((at(second, 0).content as Part[]).length === 2, "the second identical message receives its own injection");
    await bridgeOnce(second, bridge, processed, "ses_identical");
    assert(bridge.calls === 2, "the second identical message is not bridged twice");
  }

  {
    const shape = {
      query: z.string(),
      limit: z.number().int().optional(),
    };
    const first = await buildToolJsonSchema(shape);
    const second = await buildToolJsonSchema(shape);
    assert(first !== undefined && second !== undefined, "the tool schema builds");
    assert(first === second, "a repeated schema build returns the cached object");
    assert(stable(first) === stable(second), "the schema serializes byte-identically");
    assert(
      first !== undefined && stable(Object.keys(first)) === stable(["$schema", "type", "properties", "required"]),
      "the schema key order is stable",
    );
    const rebuilt = await buildToolJsonSchema({ query: z.string(), limit: z.number().int().optional() });
    assert(rebuilt !== first, "an equal literal is a distinct cache key");
    assert(stable(rebuilt) === stable(first), "an equal literal still serializes byte-identically");
    const other = await buildToolJsonSchema({ query: z.string(), limit: z.number().int().optional(), tag: z.string() });
    assert(other !== first, "a different shape is not served from the wrong cache entry");
  }

  {
    const setup = readFileSync(join(repo, "src", "v2", "setup.ts"), "utf-8");
    assert(setup.includes("const syntheticMessageKeys = new WeakMap<object, string>()"), "the synthetic key is pinned per message object");
    assert(setup.includes("syntheticMessageKey(last, messages.length - 1)"), "an unidentified message is keyed by its position");
    assert(setup.includes("syntheticMessageCounter += 1"), "a process counter separates identical messages");
    assert(!setup.includes("nextSyntheticCounter"), "the counter needs no per-session table");
    assert(!setup.includes("JSON.stringify(content"), "message identity never depends on content");
    assert(setup.includes("if (presentTexts.has(part.text)) continue;"), "an already present text is refused");
    assert(setup.includes("set.size >= MAX_PROCESSED_MESSAGES"), "the processed table stays bounded");
    assert(setup.includes("rawContent.push(...added)"), "the multipart path appends only the accepted parts");
  }

  console.log("PROOF PASS: repeated bridge passes never rewrite or duplicate the prompt payload");
}

await main();
