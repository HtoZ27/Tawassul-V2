import "./proof-log-isolate.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createN2AutoHook, type N2AutoRecord } from "../src/hooks/n2-auto.ts";

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

const work = mkdtempSync(join(tmpdir(), "tawassul-n2-cap-"));
const logPath = join(work, "n2-auto.jsonl");
process.env.TAWASSUL_N2_LOG = logPath;

function resetLog(): void {
  writeFileSync(logPath, "", { mode: 0o600 });
}

function records(): N2AutoRecord[] {
  const raw = readFileSync(logPath, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as N2AutoRecord);
}

function messageUpdated(id: string): { event: unknown } {
  return { event: { type: "message.updated", properties: { info: { id, role: "assistant" } } } };
}

function textPart(messageID: string): { event: unknown } {
  return {
    event: {
      type: "message.part.updated",
      properties: {
        part: {
          type: "text",
          id: `${messageID}-part`,
          sessionID: "sess-n2-cap",
          messageID,
          text: `text for ${messageID}`,
        },
      },
    },
  };
}

async function seed(hook: (input: { event: unknown }) => Promise<void>, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await hook(messageUpdated(`m${i}`));
}

async function main(): Promise<void> {
  resetLog();
  const at500 = createN2AutoHook();
  await seed(at500, 500);
  await at500(textPart("m0"));
  const at500Records = records();
  assert(at500Records.length === 1, "a 500-message session records the first text part");
  assert(at500Records[0]?.message_id === "m0", "the 500-message session keeps its oldest assistant message");

  resetLog();
  const at512 = createN2AutoHook();
  await seed(at512, 512);
  await at512(textPart("m0"));
  const at512Records = records();
  assert(at512Records.length === 1, "the cap boundary still keeps the oldest message at exactly 512");
  assert(at512Records[0]?.message_id === "m0", "512 remember slots hold all 512 assistant messages");

  resetLog();
  const at513 = createN2AutoHook();
  await seed(at513, 513);
  await at513(textPart("m0"));
  assert(records().length === 0, "the 513th assistant message evicts the oldest before its text arrives");
  await at513(textPart("m512"));
  const at513Records = records();
  assert(at513Records.length === 1, "the newest assistant message still records after the eviction");
  assert(at513Records[0]?.message_id === "m512", "the surviving slot belongs to the newest message");

  console.log(`PROOF PASS: N2 dedup covers 500-message sessions and evicts only past 512 (${passed} assertions)`);
}

main()
  .catch((e) => {
    if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
      console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
      process.exitCode = 1;
    }
  })
  .finally(() => {
    delete process.env.TAWASSUL_N2_LOG;
    rmSync(work, { recursive: true, force: true });
  });
