import { z } from "zod";
import { toV2Result } from "../src/v2/adapters.ts";
import { applyV1AfterOutput } from "../src/v2/result-bridge.ts";
import { buildToolJsonSchema } from "../src/lib/tool-schema-injection.ts";
import { buildDirectResponseTool } from "../src/tools/direct-response.ts";
import type { V2ToolResult } from "../src/v2/types.ts";

let passed = 0;

const TITLE_KEY = "tawassul.title";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

function metadataOf(value: unknown): Record<string, unknown> | undefined {
  return (value as { metadata?: Record<string, unknown> }).metadata;
}

async function main(): Promise<void> {
  const titled = toV2Result({
    title: "🌐 Web Fetch",
    output: "page body",
    metadata: { url: "https://example.test" },
  }) as { content: Array<{ text: string }>; metadata?: Record<string, unknown> };
  assert(titled.content[0]!.text === "page body", "the tool output still reaches the result content");
  assert(metadataOf(titled)?.["url"] === "https://example.test", "the tool metadata is preserved");
  assert(metadataOf(titled)?.[TITLE_KEY] === "🌐 Web Fetch", "the tool title travels in the result metadata");

  const titleOnly = toV2Result({ title: "🚨 Panic Reset Complete", output: "" });
  assert(metadataOf(titleOnly)?.[TITLE_KEY] === "🚨 Panic Reset Complete", "a title survives without metadata");

  const bare = toV2Result({ output: "no title" });
  assert(metadataOf(bare) === undefined, "a result without a title or metadata stays clean");

  const nonString = toV2Result({ title: 7, output: "odd title" });
  assert(metadataOf(nonString)?.[TITLE_KEY] === undefined, "a non-string title is not carried");

  const originalMetadata = { [TITLE_KEY]: "Old Title", keep: 1 };
  const result = {
    content: [{ type: "text", text: "body" }],
    metadata: { ...originalMetadata },
  } as V2ToolResult;
  applyV1AfterOutput(
    result,
    "body",
    originalMetadata,
    { title: "Old Title", output: "body", metadata: { ...originalMetadata, status: "completed" } },
    true,
  );
  assert(metadataOf(result)?.[TITLE_KEY] === "Old Title", "an untouched title stays as it was");
  assert(metadataOf(result)?.["status"] === undefined, "the synthetic status never reaches the result metadata");

  const changed = {
    content: [{ type: "text", text: "body" }],
    metadata: { ...originalMetadata },
  } as V2ToolResult;
  applyV1AfterOutput(
    changed,
    "body",
    originalMetadata,
    { title: "New Title", output: "body", metadata: { ...originalMetadata, status: "completed" } },
    true,
  );
  assert(metadataOf(changed)?.[TITLE_KEY] === "New Title", "a title changed by the after hook reaches the result");
  assert(metadataOf(changed)?.["keep"] === 1, "the rest of the metadata survives a title change");

  const cleared = {
    content: [{ type: "text", text: "body" }],
    metadata: { ...originalMetadata },
  } as V2ToolResult;
  applyV1AfterOutput(
    cleared,
    "body",
    originalMetadata,
    { title: "", output: "body", metadata: { ...originalMetadata, status: "completed" } },
    true,
  );
  assert(metadataOf(cleared)?.[TITLE_KEY] === undefined, "clearing the title removes the metadata key");

  const direct = buildDirectResponseTool();
  const schema = await buildToolJsonSchema(direct.args as never);
  const properties = (schema?.properties ?? {}) as Record<string, unknown>;
  assert(Object.keys(properties).join(",") === "response", "the direct-response tool exposes only the response argument");
  assert(
    (schema?.properties as Record<string, { description?: string }>)["response"]?.description?.includes("direct response") ===
      true,
    "the response argument still describes its purpose",
  );
  assert(direct.description.includes("respond directly"), "the tool description still describes direct response");
  const executed = (await direct.execute({ response: "hello" }, {} as never)) as Record<string, unknown>;
  assert(executed["output"] === "hello", "the direct-response tool returns the response text");
  assert(executed["requiresTask"] === undefined, "the direct-response result no longer carries a dead field");
  assert(!("requiresTask" in (direct.args as Record<string, unknown>)), "the dead routing argument is gone from the schema");
  assert(z.string().safeParse("hello").success, "the response argument stays a plain string");
}

try {
  await main();
  console.log(`PROOF PASS: tool titles survive the v2 result bridge and the dead direct-response field is gone (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
