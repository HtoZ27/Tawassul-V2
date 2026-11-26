import "./proof-log-isolate.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleFingerprint } from "../src/utils/bundle-fingerprint.ts";

let passed = 0;

function check(condition: unknown, name: string): void {
  if (!condition) {
    console.error(`PROOF FAIL: ${name}`);
    process.exitCode = 1;
    throw new Error(name);
  }
  passed += 1;
  console.log(`ok ${name}`);
}

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const HELPER = join(REPO, "scripts", "host-refresh.sh");
const ROOT = mkdtempSync(join(tmpdir(), "tawassul-host-refresh-"));
const HOME = join(ROOT, "home");
const LOG = join(ROOT, "plugin.log");
const ENTRY = join(ROOT, "tawassul.js");
const SERVICE = join(ROOT, "service.json");
const CLI = join(ROOT, "opencode-cli");
const MARKER_FILE = join(ROOT, "cli-called");
const REPORT = join(ROOT, "host-refresh.json");
const DIGEST = "a".repeat(64);

const FAKE_CLI = [
  "#!/usr/bin/env bash",
  "set -eu",
  'emit_init() {',
  '  if [ -n "${FAKE_SHA:-}" ]; then',
  '    printf "%s [tawassul] v2 bundle sha256=%s bytes=%s entry=%s\\n" "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$FAKE_SHA" "${FAKE_BYTES:-0}" "${FAKE_ENTRY:-unknown}" >> "$FAKE_LOG"',
  "  fi",
  '  printf "%s [tawassul] [tawassul] Background init completed successfully\\n" "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" >> "$FAKE_LOG"',
  "}",
  'if [ -n "${FAKE_MARKER:-}" ]; then',
  '  printf "called\\n" >> "$FAKE_MARKER"',
  "fi",
  'case "${1:-}" in',
  "  reload)",
  '    printf "%s\\n" "${FAKE_RELOAD_OUTPUT:-Configuration reloaded}"',
  '    if [ "${FAKE_APPEND:-0}" = "1" ]; then',
  "      emit_init",
  "    fi",
  "    ;;",
  "  service)",
  '    printf "service restarted\\n"',
  '    if [ "${FAKE_RESTART_APPEND:-0}" = "1" ]; then',
  "      emit_init",
  "    fi",
  "    ;;",
  "  *)",
  '    printf "unexpected command: %s\\n" "${1:-}" >&2',
  "    exit 3",
  "    ;;",
  "esac",
  "",
].join("\n");

type RunResult = {
  status: number | null;
  output: string;
};

let entrySha = "";

function run(args: string[], extraEnv: Record<string, string> = {}): RunResult {
  const result = spawnSync("bash", [HELPER, ...args], {
    cwd: REPO,
    env: {
      ...process.env,
      HOME,
      TAWASSUL_HOST_CLI: CLI,
      TAWASSUL_PLUGIN_LOG: LOG,
      TAWASSUL_SERVICE_JSON: SERVICE,
      TAWASSUL_ENTRY_FILE: ENTRY,
      TAWASSUL_SOURCE_DIGEST: DIGEST,
      TAWASSUL_REFRESH_REPORT: REPORT,
      TAWASSUL_REFRESH_TIMEOUT: "2",
      TAWASSUL_REFRESH_INTERVAL: "1",
      TAWASSUL_RESTART_DELAY: "1",
      FAKE_LOG: LOG,
      FAKE_ENTRY: ENTRY,
      FAKE_SHA: entrySha,
      ...extraEnv,
    },
    encoding: "utf8",
    timeout: 30000,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function writeEntry(digest: string): void {
  writeFileSync(ENTRY, `console.log("entry");\n// TAWASSUL_CONTENT_SHA=${digest}\n`);
}

function touchEntry(epoch: number): void {
  utimesSync(ENTRY, epoch, epoch);
}

function initLine(epoch: number): string {
  return `${new Date(epoch * 1000).toISOString()} [tawassul] [tawassul] Background init completed successfully\n`;
}

function fingerprintLine(epoch: number, sha: string): string {
  return `${new Date(epoch * 1000).toISOString()} [tawassul] v2 bundle sha256=${sha} bytes=1 entry=${ENTRY}\n`;
}

function resetState(entryEpoch: number, initEpochs: number[], liveSha: string | null = null): void {
  writeEntry(DIGEST);
  touchEntry(entryEpoch);
  entrySha = createHash("sha256").update(readFileSync(ENTRY)).digest("hex");
  const sha = liveSha === null ? entrySha : liveSha;
  const lines: string[] = [];
  for (const epoch of initEpochs) {
    if (sha !== "") lines.push(fingerprintLine(epoch, sha));
    lines.push(initLine(epoch));
  }
  writeFileSync(LOG, lines.join(""));
  rmSync(REPORT, { force: true });
  rmSync(MARKER_FILE, { force: true });
}

try {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(CLI, FAKE_CLI);
  chmodSync(CLI, 0o755);
  writeFileSync(SERVICE, `{"pid":4242}\n`);

  const utilFile = join(ROOT, "fingerprint-entry.js");
  writeFileSync(utilFile, "console.log(1);\n");
  const utilBytes = readFileSync(utilFile);
  const utilFingerprint = bundleFingerprint(utilFile);
  check(utilFingerprint !== null, "bundleFingerprint reads an existing file");
  check(utilFingerprint?.entry === utilFile, "bundleFingerprint reports the entry path");
  check(
    utilFingerprint?.sha256 === createHash("sha256").update(utilBytes).digest("hex"),
    "bundleFingerprint hashes the file bytes",
  );
  check(utilFingerprint?.bytes === utilBytes.byteLength, "bundleFingerprint reports the byte size");
  check(bundleFingerprint(join(ROOT, "missing-entry.js")) === null, "bundleFingerprint returns null for a missing file");

  const now = Math.floor(Date.now() / 1000);

  const help = run(["--help"]);
  check(help.status === 0, "help exits zero");
  check(help.output.includes("usage: host-refresh.sh"), "help prints the usage line");

  const unknown = run(["--unknown"]);
  check(unknown.status === 2, "an unknown argument exits two");

  resetState(now - 7200, [now - 3600]);
  const desktopCli = join(HOME, ".config", "ai.opencode.desktop", "cli", "9.9.9-x64", "opencode-cli");
  mkdirSync(dirname(desktopCli), { recursive: true });
  writeFileSync(desktopCli, FAKE_CLI);
  chmodSync(desktopCli, 0o755);
  const discovery = run(["--dry-run"], { TAWASSUL_HOST_CLI: "" });
  check(discovery.status === 0, "a dry-run reload exits zero");
  check(discovery.output.includes(desktopCli), "the Desktop CLI is discovered when no override is set");
  check(!existsSync(MARKER_FILE), "a dry-run reload does not invoke the CLI");

  resetState(now - 7200, [now - 3600]);
  const reload = run([], { FAKE_APPEND: "1", FAKE_MARKER: MARKER_FILE });
  check(reload.status === 0, "a reload with a fresh init exits zero");
  check(reload.output.includes("Configuration reloaded"), "the reload output is relayed");
  check(reload.output.includes("mode=reload init="), "the reload reports the init timestamp");
  check(reload.output.includes("pid=4242"), "the reload reports the service pid");
  check(reload.output.includes("live_bundle="), "the reload reports the live bundle fingerprint");
  check(readFileSync(LOG, "utf8").trim().split("\n").length === 4, "the successful reload appends one init record");
  check(existsSync(MARKER_FILE), "the reload invokes the resolved CLI");

  resetState(now - 7200, [now - 3600]);
  const stale = run([], { FAKE_APPEND: "0" });
  check(stale.status === 1, "a reload without a fresh init fails");
  check(stale.output.includes("no fresh plugin init"), "the stale reload names the missing init");
  check(stale.output.includes("host:refresh -- --restart"), "the stale reload points at the restart fallback");

  resetState(now - 7200, [now - 3600]);
  const reloadMismatch = run([], { FAKE_APPEND: "1", FAKE_SHA: "d".repeat(64) });
  check(reloadMismatch.status === 1, "a reload whose live bundle differs fails");
  check(reloadMismatch.output.includes("live bundle sha256=dddddddddddd"), "the reload mismatch names the live bundle");

  resetState(now - 7200, [now - 3600]);
  rmSync(LOG, { force: true });
  const missing = run([], { FAKE_APPEND: "1" });
  check(missing.status === 1, "a missing plugin log fails");
  check(missing.output.includes("plugin log not found"), "the missing log is named");
  check(!existsSync(MARKER_FILE), "the CLI is not invoked when the log is missing");

  resetState(now - 7200, [now - 3600], "c".repeat(64));
  appendFileSync(LOG, "binary tool output \u0000\n");
  appendFileSync(LOG, fingerprintLine(now - 60, entrySha));
  appendFileSync(LOG, initLine(now - 60));
  const nulLog = run(["--verify-only"]);
  check(nulLog.status === 0, "verify-only reads past a NUL byte in the plugin log");
  check(nulLog.output.includes("live_bundle="), "the post-NUL fingerprint is the live bundle");

  resetState(now - 7200, [now - 3600]);
  appendFileSync(
    LOG,
    `${new Date((now - 30) * 1000).toISOString()} [tawassul] v2 bundle sha256=${"d".repeat(64)} bytes=1 entry=${join(ROOT, "other.js")}\n`,
  );
  appendFileSync(LOG, initLine(now - 30));
  const otherWorkspace = run(["--verify-only"]);
  check(otherWorkspace.status === 0, "verify-only ignores a newer fingerprint from another workspace");
  check(otherWorkspace.output.includes("live_bundle="), "the current entry fingerprint is the live bundle");

  resetState(now - 7200, [now - 3600]);
  const verify = run(["--verify-only"]);
  check(verify.status === 0, "verify-only passes when the init is newer than the entry");
  check(verify.output.includes("mode=verify init="), "verify-only reports the init timestamp");
  check(verify.output.includes("live_bundle="), "verify-only reports the live bundle fingerprint");
  check(!existsSync(MARKER_FILE), "verify-only does not invoke the CLI");
  const verifyNoCli = run(["--verify-only"], { TAWASSUL_HOST_CLI: join(ROOT, "missing-cli") });
  check(verifyNoCli.status === 0, "verify-only does not need a host CLI");

  resetState(now + 3600, [now - 3600]);
  const verifyContent = run(["--verify-only"]);
  check(verifyContent.status === 0, "a matching fingerprint outranks an entry mtime in the future");

  resetState(now - 7200, [now - 3600], "c".repeat(64));
  const verifyMismatch = run(["--verify-only"]);
  check(verifyMismatch.status === 1, "verify-only fails when the live bundle differs");
  check(verifyMismatch.output.includes("live bundle sha256=cccccccccccc"), "the verify mismatch names the live bundle");

  resetState(now + 3600, [now - 3600], "");
  const fallback = run(["--verify-only"]);
  check(fallback.status === 1, "verify-only enforces the mtime when no fingerprint exists");
  check(fallback.output.includes("no v2 bundle fingerprint"), "the fingerprint fallback is announced");
  check(fallback.output.includes("older than the plugin entry"), "the fallback enforces the mtime ordering");

  resetState(now, [now - 3600], "");
  const verifyStale = run(["--verify-only"]);
  check(verifyStale.status === 1, "verify-only fails when the init is older than the entry");
  check(verifyStale.output.includes("older than the plugin entry"), "the stale verify names the ordering");
  check(verifyStale.output.includes("host:refresh"), "the stale verify suggests the refresh helper");

  resetState(now - 7200, [now - 3600]);
  const mismatch = run(["--verify-only"], { TAWASSUL_SOURCE_DIGEST: "b".repeat(64) });
  check(mismatch.status === 1, "a digest mismatch fails");
  check(mismatch.output.includes("plugin entry is stale"), "the digest mismatch names the stale entry");
  check(mismatch.output.includes("npm run build"), "the digest mismatch suggests a build");

  resetState(now - 7200, [now - 3600]);
  const restartDry = run(["--restart", "--dry-run"]);
  check(restartDry.status === 0, "a restart dry-run exits zero");
  check(restartDry.output.includes("systemd-run"), "the restart plan uses systemd-run");
  check(restartDry.output.includes("--restart-now"), "the restart plan runs the internal restart mode");
  check(restartDry.output.includes("--on-active=1s"), "the restart plan uses the configured delay");
  check(!existsSync(REPORT), "a restart dry-run writes no report");
  check(!existsSync(MARKER_FILE), "a restart dry-run does not invoke the CLI");

  resetState(now - 7200, []);
  const restartNow = run(["--restart-now"], { FAKE_RESTART_APPEND: "1", TAWASSUL_REFRESH_UNIT: "probe" });
  check(restartNow.status === 0, "restart-now exits zero after a fresh init");
  check(existsSync(REPORT), "restart-now writes a report");
  const freshReport = JSON.parse(readFileSync(REPORT, "utf8")) as { status?: string; pid?: number; unit?: string };
  check(freshReport.status === "fresh", "the restart report is fresh");
  check(freshReport.pid === 4242, "the restart report carries the service pid");
  check(freshReport.unit === "probe", "the restart report carries the unit name");

  resetState(now - 7200, []);
  const restartStale = run(["--restart-now"], { FAKE_RESTART_APPEND: "0" });
  check(restartStale.status === 1, "restart-now fails without a fresh init");
  const staleReport = JSON.parse(readFileSync(REPORT, "utf8")) as { status?: string };
  check(staleReport.status === "stale", "the failed restart report is stale");
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}

assert.equal(passed, 60);
console.log(`PROOF PASS: the host refresh helper reloads and verifies truthfully (${passed} assertions)`);
