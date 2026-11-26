import "./proof-log-isolate.ts";
import { existsSync, readFileSync } from "node:fs";
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

type LedgerEntry = { id: string; skillId: string; receipt: string; verdict: string };

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(repo, "skills", "manifest.json"), "utf8")) as {
  skills: ManifestSkill[];
};
const ledger = JSON.parse(readFileSync(join(repo, "docs", "experiments", "evals.json"), "utf8")) as {
  evals: LedgerEntry[];
};

const receipts = new Map<string, Receipt>();
function receiptFor(path: string): Receipt {
  const cached = receipts.get(path);
  if (cached) return cached;
  const parsed = JSON.parse(readFileSync(join(repo, path), "utf8")) as Receipt;
  receipts.set(path, parsed);
  return parsed;
}

assert(manifest.skills.length === 16, "the manifest ships sixteen skills");

for (const skill of manifest.skills) {
  const label = skill.id;
  const entry = ledger.evals.find((candidate) => candidate.id === skill.evalId);
  if (!entry) fail(`${label} has no ledger entry`);
  assert(entry.skillId === skill.id, `${label} eval entry names the skill`);
  assert(entry.verdict === "pass", `${label} eval verdict is pass`);
  assert(existsSync(join(repo, entry.receipt)), `${label} eval cites an existing receipt`);
  assert(
    entry.receipt.startsWith("docs/experiments/receipts/"),
    `${label} eval cites a dated receipt under docs/experiments/receipts`,
  );

  const receipt = receiptFor(entry.receipt);
  const sessions = receipt.liveLoadRate.sessions.filter((session) => session.evalId === skill.evalId);
  assert(sessions.length > 0, `${label} has a live load sample`);
  const loaded = sessions.filter((session) => session.loaded).length;
  const rate = loaded / sessions.length;
  assert(rate >= skill.loadRateThreshold, `${label} meets its load-rate threshold (${loaded}/${sessions.length})`);
  assert(skill.loadRateThreshold > 0 && skill.loadRateThreshold <= 1, `${label} declares a threshold in (0, 1]`);
  assert(skill.loadRateThreshold < 1 || rate === 1, `${label} loads in every sample when its threshold is 1`);
  const fixture = receipt.fixtures.find((candidate) => candidate.evalId === skill.evalId);
  assert(fixture !== undefined && fixture.procedureExecuted, `${label} executed its procedure in the replay`);
}

for (const [path, receipt] of receipts) {
  const live = receipt.liveLoadRate;
  const totalLoaded = live.sessions.filter((session) => session.loaded).length;
  assert(totalLoaded === live.loaded, `${path} live total matches the per-session rows`);
  assert(live.relevant === live.sessions.length, `${path} counts every relevant session`);
  assert(live.rate === live.loaded / live.relevant, `${path} live rate follows its rows`);
  assert(live.skillsOff === 0, `${path} live sample carries no skills-off session`);
  const replayLoaded = receipt.fixtures.reduce((sum, fixture) => sum + fixture.loaded, 0);
  assert(receipt.replayLoadRate.loaded === replayLoaded, `${path} replay count matches the fixture rows`);
  assert(receipt.replayLoadRate.rate === 1, `${path} offline replay loads every relevant skill`);
}

const thresholdBreach = manifest.skills.filter((skill) => {
  const entry = ledger.evals.find((candidate) => candidate.id === skill.evalId);
  if (!entry) return true;
  const sessions = receiptFor(entry.receipt).liveLoadRate.sessions.filter(
    (session) => session.evalId === skill.evalId,
  );
  if (sessions.length === 0) return true;
  const loaded = sessions.filter((session) => session.loaded).length;
  return loaded / sessions.length < skill.loadRateThreshold;
});
assert(thresholdBreach.length === 0, "no shipped skill falls below its declared threshold");

console.log(`PROOF PASS: every shipped skill met its declared load rate (${passed} assertions)`);
