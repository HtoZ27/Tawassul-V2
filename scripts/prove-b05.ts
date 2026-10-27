import { Buffer } from "node:buffer";
import { collectToolSchemas, measureSchemaPayload } from "../src/v2/adapters.ts";
import { z } from "zod";
import { tool, type ToolDefinition } from "../src/tool.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

function fakeTool(description: string, args: z.ZodRawShape): ToolDefinition {
  return tool({ description, args, execute: async () => ({ output: "ok" }) });
}

async function measurementCases(): Promise<void> {
  const empty = new Map<string, Record<string, unknown>>();
  const emptyResult = measureSchemaPayload(empty);
  assert(emptyResult.bytes === 0, "an empty schema map measures zero bytes");
  assert(emptyResult.estimatedTokens === 0, "an empty schema map estimates zero tokens");

  const one = new Map<string, Record<string, unknown>>([
    ["counter", { type: "object", properties: { count: { type: "number" } }, required: ["count"] }],
  ]);
  const oneResult = measureSchemaPayload(one);
  const expectedBytes = Buffer.byteLength(JSON.stringify(one.get("counter")), "utf8");
  assert(oneResult.bytes === expectedBytes, "the byte count is the serialized size of every schema");
  assert(oneResult.estimatedTokens === Math.ceil(expectedBytes / 4), "tokens are estimated as one per four bytes");

  const two = new Map<string, Record<string, unknown>>([
    ["counter", { type: "object", properties: { count: { type: "number" } } }],
    ["reader", { type: "object", properties: { path: { type: "string" } } }],
  ]);
  const twoResult = measureSchemaPayload(two);
  const expectedTwo =
    Buffer.byteLength(JSON.stringify(two.get("counter")), "utf8") +
    Buffer.byteLength(JSON.stringify(two.get("reader")), "utf8");
  assert(twoResult.bytes === expectedTwo, "the byte count sums every tool schema");
  assert(twoResult.estimatedTokens === Math.ceil(expectedTwo / 4), "the token estimate follows the summed byte count");

  assert(
    measureSchemaPayload(two).bytes === twoResult.bytes,
    "the measurement is deterministic across calls",
  );

  const tools: Record<string, ToolDefinition> = {
    counter: fakeTool("count", { count: z.number() }),
    reader: fakeTool("read", { path: z.string() }),
  };
  const collected = await collectToolSchemas(tools);
  const collectedResult = measureSchemaPayload(collected);
  assert(collectedResult.bytes > 0, "a real collection produces a non-zero payload");
  assert(collectedResult.estimatedTokens > 0, "a real collection estimates a non-zero token count");
  assert(
    collectedResult.bytes >= collected.size * 10,
    "the measured payload scales with the number of tools",
  );
}

try {
  await measurementCases();
  console.log(`PROOF PASS: the tool schema payload is measured in bytes and estimated tokens (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
