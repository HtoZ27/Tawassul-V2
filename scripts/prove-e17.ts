import { z } from "zod";
import { makeV2Tool } from "../src/v2/adapters.ts";
import { buildToolJsonSchema } from "../src/lib/tool-schema-injection.ts";
import { tool } from "../src/tool.ts";
import type { V2Context, V2ToolContext } from "../src/v2/types.ts";

let passed = 0;

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

const ctx = {} as V2Context;
const toolContext = {
  sessionID: "sess-e17",
  messageID: "msg-e17",
  agent: "dev",
  signal: new AbortController().signal,
  progress: async () => undefined,
} as unknown as V2ToolContext;

async function main(): Promise<void> {
  const seen: unknown[] = [];
  const def = tool({
    description: "count lines",
    args: { count: z.number().int().min(1), label: z.string().optional() },
    execute: async (args) => {
      seen.push(args);
      return { output: `count=${(args as { count: number }).count}` };
    },
  });
  const schema = await buildToolJsonSchema(def.args as never);
  const v2 = makeV2Tool(ctx, "count", def, schema);

  assert(v2.input === schema, "the advertised input schema is the real one, not a placeholder");
  assert(
    (v2.input as { required?: string[] }).required?.includes("count") === true,
    "the advertised schema marks the required argument",
  );

  const okResult = (await v2.execute({ count: 3 }, toolContext)) as { content: { text: string }[] };
  assert(seen.length === 1, "a valid call reaches the handler");
  assert((seen[0] as { count: number }).count === 3, "the handler receives the parsed argument");
  assert(okResult.content[0]!.text === "count=3", "a valid call returns the tool output");

  let invalidError: Error | null = null;
  try {
    await v2.execute({ count: "three" }, toolContext);
  } catch (e) {
    invalidError = e as Error;
  }
  assert(invalidError !== null, "a wrong argument type is rejected");
  assert(
    invalidError?.message.includes('Invalid input for tool "count"') === true,
    "the rejection names the tool",
  );
  assert(invalidError?.message.includes("count:") === true, "the rejection names the offending field");
  assert(seen.length === 1, "an invalid call never reaches the handler");

  let missingError: Error | null = null;
  try {
    await v2.execute({}, toolContext);
  } catch (e) {
    missingError = e as Error;
  }
  assert(missingError !== null, "a missing required argument is rejected");
  assert(seen.length === 1, "a call with a missing argument never reaches the handler");

  let rangeError: Error | null = null;
  try {
    await v2.execute({ count: 0 }, toolContext);
  } catch (e) {
    rangeError = e as Error;
  }
  assert(rangeError !== null, "a constraint violation is rejected before dispatch");
  assert(seen.length === 1, "a call that violates a constraint never reaches the handler");

  const noArgsSeen: unknown[] = [];
  const plain = tool({
    description: "no arguments",
    args: {},
    execute: async (args) => {
      noArgsSeen.push(args);
      return "plain";
    },
  });
  const plainV2 = makeV2Tool(ctx, "plain", plain, undefined);
  assert(
    (plainV2.input as { additionalProperties?: boolean }).additionalProperties === true,
    "a tool with no declared arguments keeps the permissive placeholder",
  );
  const plainResult = (await plainV2.execute({ anything: true }, toolContext)) as { content: { text: string }[] };
  assert(plainResult.content[0]!.text === "plain", "a tool with no arguments still runs");
  assert(noArgsSeen.length === 1, "a tool with no arguments dispatches without validation");
}

try {
  await main();
  console.log(`PROOF PASS: v2 tools validate their real schema before dispatch (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
