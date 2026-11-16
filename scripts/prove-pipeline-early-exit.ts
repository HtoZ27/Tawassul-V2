import { runPipeline } from "../src/hooks/validation-pipeline.ts";
import { combinedStage } from "../src/hooks/guards/shared/factories.ts";
import { PipelineState } from "../src/hooks/PipelineState.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

function lightCtx(): never {
  return {
    pipelineState: new PipelineState(),
    getAgentModel: () => "opencode/big-pickle",
    ask: async () => true,
  } as never;
}

const ran: string[] = [];
const stub = (name: string, ok: boolean) => ({
  name,
  check: async () => {
    ran.push(name);
    return ok;
  },
});
const group = combinedStage("test-group", [stub("first", true), stub("second", false), stub("third", true)]);
const out1 = {} as never;
const r1 = await group.check({} as never, {} as never, out1);
assert(r1 === false, "L1 group fails");
assert(JSON.stringify(ran) === JSON.stringify(["first", "second"]), "L1 stops at first failure");
assert((out1 as { blockingGuard?: string }).blockingGuard === "second", "L1 blockingGuard attribution");

const out2 = { args: { subagent: "dev", prompt: "x".repeat(10001) } } as never;
const ok2 = await runPipeline(
  lightCtx(),
  { tool: "task", agent: "tawa", sessionID: "iso-ee-block" } as never,
  out2,
);
assert(ok2 === false, "L2 overlong blocked");
assert((out2 as { blockingGuard?: string }).blockingGuard === "task-rejection", "L2 blocked at content-checks");
assert((out2 as { args: { model?: string } }).args.model === undefined, "L2 model unset, proxyRouting unreached");

const out3 = { args: { subagent: "dev", prompt: "fix the login bug" } } as never;
let threw: unknown = null;
let ok3 = false;
try {
  ok3 = await runPipeline(lightCtx(), { tool: "task", agent: "tawa", sessionID: "iso-ee-pass" } as never, out3);
} catch (e) {
  threw = e;
}
assert((out3 as { args: { model?: string } }).args.model !== undefined, "L2-control reaches proxyRouting");
if (threw !== null) console.log(`note L2-control downstream threw (ok=${ok3}, model assignment already proven): ${String(threw).slice(0, 80)}`);

console.log("PROOF PASS: pipeline early-exit at group and stage level");
