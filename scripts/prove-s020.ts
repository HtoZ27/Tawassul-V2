import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAvailableModelsCached, resetModelCache, getModelListProvenance } from "../src/hooks/guards/shared/model-cache.ts";
import { stripBashComment, consentKey } from "../src/hooks/guards/consent-gate-guard.ts";
import { warnThrottled, warnThrottleSuppressed, resetWarnThrottle } from "../src/hooks/guards/shared/warn-throttle.ts";
import { recordFetchWait, getFetchWaitStats, resetFetchWaitStats } from "../src/hooks/guards/shared/fetch-wait-metrics.ts";
import { passesComplexityGate, isComplexEffort } from "../src/services/effort-analyzer.ts";
import { writeIfChanged } from "../src/services/persist-utils.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

resetModelCache();
const [a, b] = await Promise.all([getAvailableModelsCached("s20-a"), getAvailableModelsCached("s20-b")]);
assert(Array.isArray(a) && Array.isArray(b), "cache concurrent resolves arrays");
assert(JSON.stringify(a) === JSON.stringify(b), "cache single-flight same value");
const prov = getModelListProvenance();
assert(prov !== null && typeof prov.gen === "number" && prov.stale === false, "cache list provenanced");
resetModelCache();
assert(getModelListProvenance() === null, "cache reset clears slot");

const heredoc = "cat <<EOF # head\nbody # kept\nEOF\nls # tail";
const stripped = stripBashComment(heredoc);
assert(stripped.includes("body # kept"), "heredoc body hash kept literal");
assert(stripped.includes("# head"), "operator-line hash kept safe side");
assert(!stripped.includes("# tail"), "trailing comment stripped");
assert(consentKey("kick", { agent: "dev" }, "s") === "kick:dev@s", "kick key carries target");
assert(consentKey("kick", {}, "s") === "kick:@s", "kick key empty target distinct");

resetWarnThrottle();
warnThrottled("s20", 60_000, "first");
warnThrottled("s20", 60_000, "second");
assert(warnThrottleSuppressed("s20") === 1, "warn repeat counted not logged");
resetWarnThrottle();
assert(warnThrottleSuppressed("s20") === 0, "warn reset clears");

resetFetchWaitStats();
recordFetchWait(10);
recordFetchWait(Number.NaN);
const stats = getFetchWaitStats();
assert(stats !== null && stats.count === 1 && stats.p50 === 10 && stats.max === 10, "fetch-wait finite-only stats");
resetFetchWaitStats();
assert(getFetchWaitStats() === null, "fetch-wait reset clears");

assert(passesComplexityGate("fix bug") === false, "gate trivial short-circuits");
assert(passesComplexityGate("implement user authentication with login then dashboard then tests in src/auth.ts") === true, "gate complex passes");
assert(isComplexEffort(null, "anything") === false, "effort null false without analyze");
assert(isComplexEffort({ thinking_effort: "deep" } as never, "short") === false, "effort gate still applies");

const dir = mkdtempSync(join(tmpdir(), "s20-"));
const fp = join(dir, "f.txt");
writeFileSync(fp, "same");
assert((await writeIfChanged(fp, "same")) === false, "writeIfChanged skips identical");
assert((await writeIfChanged(fp, "diff")) === true, "writeIfChanged writes changed");
assert((await writeIfChanged(join(dir, "new.txt"), "x")) === true, "writeIfChanged writes missing");
rmSync(dir, { recursive: true, force: true });

console.log("PROOF PASS: s020 nine-day ports");
