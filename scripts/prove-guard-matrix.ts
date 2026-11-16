import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const GUARD = join(REPO, "scripts", "guard-db-generation.sh");
const ROOT = mkdtempSync(join(tmpdir(), "tawassul-guard-matrix-"));

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

function sqlite(db: string, sql: string): void {
  const result = spawnSync("sqlite3", [db, sql], { encoding: "utf-8" });
  if (result.status !== 0) fail(`sqlite3 failed for ${db}: ${result.stderr ?? ""}`);
}

type GuardResult = {
  code: number;
  generation: string;
  verdict: string;
  reason: string;
  warnings: string[];
  stderr: string;
};

function guard(db: string, expect: "v1" | "v2", extra: string[] = []): GuardResult {
  const result = spawnSync(
    "bash",
    [GUARD, "--db", db, "--expect", expect, "--json", ...extra],
    { encoding: "utf-8" },
  );
  const line = (result.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    fail(`guard emitted no JSON for ${expect} on ${db}: ${line || "(empty)"} ${result.stderr ?? ""}`);
  }
  return {
    code: result.status ?? -1,
    generation: String(parsed["generation"] ?? ""),
    verdict: String(parsed["verdict"] ?? ""),
    reason: String(parsed["reason"] ?? ""),
    warnings: Array.isArray(parsed["warnings"]) ? (parsed["warnings"] as string[]) : [],
    stderr: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

try {
  const V2_DIR = join(ROOT, "tawassul-v2");
  const PLAIN = join(ROOT, "plain");
  mkdirSync(V2_DIR, { recursive: true });
  mkdirSync(PLAIN, { recursive: true });

  const v1AtV2 = join(V2_DIR, "v1-content.db");
  sqlite(
    v1AtV2,
    [
      "CREATE TABLE session (id TEXT PRIMARY KEY);",
      "CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT);",
      "CREATE TABLE data_migration (id TEXT PRIMARY KEY);",
      "INSERT INTO session VALUES ('s1');",
      "INSERT INTO session_message VALUES ('m1','s1');",
    ].join(""),
  );
  const refusal = guard(v1AtV2, "v2");
  assert(refusal.code === 2, "v2 lane refuses v1 content at a tawassul-v2 path (rc=2)");
  assert(refusal.verdict === "refused", "the v1-content refusal is reported as refused");
  assert(refusal.reason === "marker-v1-content", "the reason is marker-v1-content");
  assert(refusal.generation === "v1", "the refusal names the detected v1 generation");

  const v1AtPlain = join(PLAIN, "v1-content.db");
  copyFileSync(v1AtV2, v1AtPlain);
  const v1Lane = guard(v1AtPlain, "v1");
  assert(v1Lane.code === 0, "the v1 lane accepts the same v1 content at a plain path");
  assert(v1Lane.reason === "ok", "the v1 acceptance carries reason=ok");

  const v2AtPlain = join(PLAIN, "v2-content.db");
  sqlite(v2AtPlain, "CREATE TABLE session_v2 (id TEXT PRIMARY KEY); INSERT INTO session_v2 VALUES ('sm1');");
  const reverse = guard(v2AtPlain, "v1");
  assert(reverse.code === 2, "v1 lane refuses v2 content at a plain path (rc=2)");
  assert(reverse.reason === "marker-session_v2", "the reverse row reports marker-session_v2");
  assert(reverse.generation === "v2", "the reverse refusal names the detected v2 generation");

  const v2Warn = guard(v2AtPlain, "v2", ["--path-rule", "warn"]);
  assert(v2Warn.code === 0, "the v2 lane accepts v2 content on a plain path in warn mode");
  assert(
    v2Warn.warnings.some((warning) => warning.includes("non-v2-path")),
    "warn mode records the non-v2 path suspicion",
  );

  const v1Warn = guard(v1AtV2, "v2", ["--path-rule", "warn"]);
  assert(v1Warn.code === 2, "warn mode still refuses v1 content by content");
  assert(v1Warn.reason === "marker-v1-content", "warn mode keeps the marker-v1-content reason");

  const enforce = guard(v2AtPlain, "v2");
  assert(enforce.code === 2, "enforce mode still refuses a plain path before content probes");
  assert(enforce.reason === "non-v2-path", "the path refusal names non-v2-path");

  const kvV2 = join(PLAIN, "kv-content.db");
  sqlite(
    kvV2,
    [
      "CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
      "INSERT INTO kv VALUES ('migration.v1-v2','{\"phase\":\"completed\"}');",
    ].join(""),
  );
  const kvRefusal = guard(kvV2, "v1");
  assert(kvRefusal.code === 2, "the v1 lane refuses a kv migration marker (rc=2)");
  assert(kvRefusal.reason === "marker-kv-migration", "the kv marker reports marker-kv-migration");

  const empty = join(V2_DIR, "empty.db");
  writeFileSync(empty, "");
  const emptyRun = guard(empty, "v2");
  assert(emptyRun.code === 0, "an empty DB is accepted as a fresh v2 surface");
  assert(emptyRun.generation === "empty", "the empty DB reports generation=empty");

  const missing = join(V2_DIR, "missing.db");
  assert(!existsSync(missing), "the fresh-file fixture does not exist");
  const fresh = guard(missing, "v2");
  assert(fresh.code === 0, "a missing DB file is fresh and allowed");
  assert(fresh.generation === "fresh", "the missing DB reports generation=fresh");

  console.log(`PROOF PASS: the generation guard matrix refuses cross-generation content in both directions (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
