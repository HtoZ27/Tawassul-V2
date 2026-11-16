import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unwrapWithHmac, wrapWithHmac } from "../src/utils/crypto.ts";
import { atomicWriteFile } from "../src/utils/atomic.ts";
import { sweepRetiredModelPins } from "../src/services/proxy-fallback-chains.ts";

function fail(msg: string): never {
  console.error(`STATE SWEEP FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

const statePath = process.argv[2] ?? resolve(process.cwd(), ".opencode", "tawassul-state.json");
const raw = readFileSync(statePath, "utf-8");
const payload = unwrapWithHmac(raw);
if (payload === null) fail(`signature invalid or unreadable: ${statePath}`);

let data: Record<string, unknown>;
try {
  data = JSON.parse(payload as string) as Record<string, unknown>;
} catch {
  fail(`envelope payload is not JSON: ${statePath}`);
  throw new Error("unreachable");
}

const agentModelMap = (data as { agentModelMap?: unknown }).agentModelMap;
if (!agentModelMap || typeof agentModelMap !== "object" || Array.isArray(agentModelMap)) {
  fail(`envelope has no agentModelMap object: ${statePath}`);
}

const reassigned = sweepRetiredModelPins(agentModelMap as Record<string, string>);
if (reassigned.length === 0) {
  console.log(`STATE SWEEP: clean — no retired pins in ${statePath}`);
} else {
  await atomicWriteFile(statePath, wrapWithHmac(JSON.stringify(data)));
  const reread = unwrapWithHmac(readFileSync(statePath, "utf-8"));
  if (reread === null) fail(`re-signed envelope does not verify: ${statePath}`);
  const check = JSON.parse(reread as string) as { agentModelMap?: Record<string, string> };
  for (const r of reassigned) {
    if (check.agentModelMap?.[r.name] !== r.newModel) fail(`pin ${r.name} did not persist`);
  }
  for (const r of reassigned) {
    console.log(`STATE SWEEP: ${r.name} ${r.oldModel} -> ${r.newModel}`);
  }
  console.log(`STATE SWEEP: re-signed and verified ${statePath}`);
}
