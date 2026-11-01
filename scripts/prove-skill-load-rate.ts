import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

type ManifestSkill = { id: string; evalId: string; loadRateThreshold: number; directory: string };

type ReceiptSession = { evalId: string; session: string; agent: string; loaded: boolean };

type Receipt = {
  fixtures: Array<{ evalId: string; relevant: number; loaded: number; procedureExecuted: boolean }>;
  replayLoadRate: { relevant: number; loaded: number; rate: number };
  liveLoadRate: { sessions: ReceiptSession[]; relevant: number; loaded: number; rate: number; skillsOff: number };
};

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(repo, "skills", "manifest.json"), "utf8")) as {
  skills: ManifestSkill[];
};
const ledger = JSON.parse(readFileSync(join(repo, "docs", "experiments", "evals.json"), "utf8")) as {
  evals: Array<{ id: string; skillId: string; receipt: string; verdict: string }>;
};
const receipt = JSON.parse(
  readFileSync(join(repo, "docs", "experiments", "receipts", "2026-10-31-pilot-eval.json"), "utf8"),
) as Receipt;

assert(manifest.skills.length === 3, "the manifest ships three skills");
assert(receipt.liveLoadRate.skillsOff === 0, "the live sample carries no skills-off session");

for (const skill of manifest.skills) {
  const label = skill.id;
  const sessions = receipt.liveLoadRate.sessions.filter((session) => session.evalId === skill.evalId);
  assert(sessions.length > 0, `${label} has a live load sample`);
  const loaded = sessions.filter((session) => session.loaded).length;
  const rate = loaded / sessions.length;
  assert(rate >= skill.loadRateThreshold, `${label} meets its load-rate threshold (${loaded}/${sessions.length})`);
  assert(skill.loadRateThreshold > 0 && skill.loadRateThreshold <= 1, `${label} declares a threshold in (0, 1]`);
  assert(skill.loadRateThreshold < 1 || rate === 1, `${label} loads in every sample when its threshold is 1`);
  const entry = ledger.evals.find((candidate) => candidate.id === skill.evalId);
  assert(entry !== undefined && entry.verdict === "pass", `${label} eval verdict is pass`);
  assert(
    entry !== undefined && entry.receipt === "docs/experiments/receipts/2026-10-31-pilot-eval.json",
    `${label} eval cites the live receipt`,
  );
  const fixture = receipt.fixtures.find((candidate) => candidate.evalId === skill.evalId);
  assert(fixture !== undefined && fixture.procedureExecuted, `${label} executed its procedure in the replay`);
}

const totalLoaded = receipt.liveLoadRate.sessions.filter((session) => session.loaded).length;
assert(totalLoaded === receipt.liveLoadRate.loaded, "the receipt total matches the per-session rows");
assert(receipt.liveLoadRate.relevant === receipt.liveLoadRate.sessions.length, "the receipt counts every relevant session");
assert(receipt.replayLoadRate.rate === 1, "the offline replay loads every relevant skill");

const thresholdBreach = manifest.skills.filter((skill) => {
  const sessions = receipt.liveLoadRate.sessions.filter((session) => session.evalId === skill.evalId);
  if (sessions.length === 0) return true;
  const loaded = sessions.filter((session) => session.loaded).length;
  return loaded / sessions.length < skill.loadRateThreshold;
});
assert(thresholdBreach.length === 0, "no shipped skill falls below its declared threshold");

console.log(`PROOF PASS: every shipped skill met its declared load rate (${passed} assertions)`);
