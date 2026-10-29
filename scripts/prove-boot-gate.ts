import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

const repo = dirname(fileURLToPath(import.meta.url));
const launcher = join(repo, "opencode-v2-iso.sh");
const scorecard = join(repo, "boot-scorecard-v2.sh");
const PATH = process.env.PATH ?? "/usr/bin:/bin";
const dirs: string[] = [];

function tempHome(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `tawassul-boot-gate-${tag}-`));
  dirs.push(dir);
  return dir;
}

function cleanEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  return { HOME: home, PATH, LANG: "C", ...extra };
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body, "utf8");
  chmodSync(path, 0o755);
}

function supportedBinary(dir: string, name: string): string {
  const path = join(dir, name);
  writeExecutable(
    path,
    "#!/usr/bin/env bash\nif [ \"${1:-}\" = \"--version\" ]; then echo \"opencode v2.2.0\"; exit 0; fi\nprintf 'FLAG=%s\\n' \"${OPENCODE_DISABLE_FILEWATCHER:-unset}\"\n",
  );
  return path;
}

function unsupportedBinary(dir: string, name: string): string {
  const path = join(dir, name);
  writeExecutable(
    path,
    "#!/usr/bin/env bash\nif [ \"${1:-}\" = \"--version\" ]; then echo \"opencode v2.2.0\"; exit 0; fi\nenv | sort\n",
  );
  return path;
}

function argsBinary(dir: string, name: string): string {
  const path = join(dir, name);
  writeExecutable(
    path,
    "#!/usr/bin/env bash\nif [ \"${1:-}\" = \"--version\" ]; then echo \"opencode v2.2.0\"; exit 0; fi\nprintf 'ARGS=%s\\n' \"$*\"\n",
  );
  return path;
}

function versionBinary(dir: string, name: string, version: string): string {
  const path = join(dir, name);
  writeExecutable(
    path,
    "#!/usr/bin/env bash\nif [ \"${1:-}\" = \"--version\" ]; then echo \"opencode v" +
      version +
      "\"; exit 0; fi\nprintf 'FLAG=%s\\n' \"${OPENCODE_DISABLE_FILEWATCHER:-unset}\"\n",
  );
  return path;
}

function launcherLines(home: string): string[] {
  const log = join(home, ".local", "share", "tawassul-v2", "tawassul", "tawassul.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter((l) => l.includes("[launcher]"));
}

function runLauncher(home: string, extra: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  return runLauncherArgs(home, ["run"], extra);
}

function runLauncherArgs(
  home: string,
  args: string[],
  extra: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("/bin/bash", [launcher, ...args], { env: cleanEnv(home, extra), encoding: "utf8", timeout: 60000 });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

try {
  const lHome = tempHome("launcher");
  const lBin = join(lHome, "bin");
  mkdirSync(lBin, { recursive: true });
  const supported = supportedBinary(lBin, "opencode-supported");
  const unsupported = unsupportedBinary(lBin, "opencode-unsupported");
  mkdirSync(join(lHome, ".opencode", "bin"), { recursive: true });
  const defaultBin = supportedBinary(join(lHome, ".opencode", "bin"), "opencode");

  {
    const before = launcherLines(lHome).length;
    const res = runLauncher(lHome);
    assert(res.status === 0, "auto watcher launch succeeds");
    const lines = launcherLines(lHome);
    assert(lines.length === before + 1, "auto launch appends exactly one launcher line");
    const line = lines.at(-1) ?? "";
    const d7 = /d7=(\S+)/.exec(line)?.[1] ?? "";
    const decision = /decision=(\S+)/.exec(line)?.[1] ?? "";
    assert(d7 === "rotational-disk" || d7 === "none", "auto line records the rotational probe verdict");
    if (d7 === "rotational-disk") {
      assert(decision === "off" && res.stdout.includes("FLAG=true"), "rotational auto disables the watcher");
    } else {
      assert(decision === "on" && res.stdout.includes("FLAG=unset"), "non-rotational auto leaves the watcher on");
    }
  }

  {
    const res = runLauncher(lHome, { TAWASSUL_WATCHER: "on" });
    assert(res.status === 0 && res.stdout.includes("FLAG=unset"), "explicit on exports no disable flag");
    assert((launcherLines(lHome).at(-1) ?? "").includes("decision=on"), "explicit on is logged");
  }

  {
    const res = runLauncher(lHome, { TAWASSUL_WATCHER: "off" });
    assert(res.status === 0 && res.stdout.includes("FLAG=true"), "explicit off exports the disable flag");
    assert((launcherLines(lHome).at(-1) ?? "").includes("decision=off"), "explicit off is logged");
  }

  {
    mkdirSync(join(lHome, ".config", "tawassul-v2"), { recursive: true });
    writeFileSync(join(lHome, ".config", "tawassul-v2", "pinned.env"), "TAWASSUL_WATCHER=off\n", "utf8");
    const res = runLauncher(lHome);
    assert(res.status === 0 && res.stdout.includes("FLAG=true"), "pinned.env off is honored without an env value");
    assert((launcherLines(lHome).at(-1) ?? "").includes("reason=TAWASSUL_WATCHER=off"), "pinned off keeps the reason");
    const overridden = runLauncher(lHome, { TAWASSUL_WATCHER: "on" });
    assert(overridden.stdout.includes("FLAG=unset"), "env on overrides pinned off");
    rmSync(join(lHome, ".config", "tawassul-v2", "pinned.env"));
  }

  {
    const res = runLauncher(lHome, { TW_DISABLE_FILEWATCHER: "1" });
    assert(res.status === 0 && res.stdout.includes("FLAG=true"), "legacy flag disables the watcher in auto mode");
    assert((launcherLines(lHome).at(-1) ?? "").includes("legacy TW_DISABLE_FILEWATCHER=1"), "legacy auto reason is logged");
    const explicit = runLauncher(lHome, { TW_DISABLE_FILEWATCHER: "1", TAWASSUL_WATCHER: "on" });
    assert(explicit.stdout.includes("FLAG=unset"), "explicit on wins over the legacy flag");
  }

  {
    const res = runLauncher(lHome, { TAWASSUL_WATCHER: "bogus" });
    assert(res.status === 0 && res.stderr.includes("invalid TAWASSUL_WATCHER"), "invalid watcher value is loud");
    assert((launcherLines(lHome).at(-1) ?? "").includes("mode=auto"), "invalid watcher value falls back to auto");
  }

  {
    const res = runLauncher(lHome, { TAWASSUL_OPENCODE_BIN: unsupported, TAWASSUL_WATCHER: "off" });
    assert(res.status === 0, "unsupported build still launches");
    assert(!res.stdout.includes("OPENCODE_DISABLE_FILEWATCHER=true"), "unsupported build receives no blind flag");
    assert(res.stderr.includes("does not advertise a watcher flag"), "unsupported disable request is loud");
    const line = launcherLines(lHome).at(-1) ?? "";
    assert(line.includes("decision=on") && line.includes("disable-requested-unsupported"), "unsupported decision is logged");
  }

  {
    const res = runLauncher(lHome, { OPENCODE: "1" });
    assert(res.status === 0 && res.stdout.includes("FLAG="), "ambient OPENCODE=1 is ignored and the default binary runs");
    const explicit = runLauncher(lHome, { OPENCODE: supported, TAWASSUL_OPENCODE_BIN: unsupported, TAWASSUL_WATCHER: "off" });
    assert(explicit.stderr.includes("does not advertise a watcher flag"), "TAWASSUL_OPENCODE_BIN wins over OPENCODE");
    const bad = runLauncher(lHome, { TAWASSUL_OPENCODE_BIN: "/nope/opencode" });
    assert(bad.status === 2 && bad.stderr.includes("host binary not found"), "missing explicit binary refuses with rc 2");
  }

  {
    const dHome = tempHome("desktop-cli");
    const dDir = join(dHome, ".config", "ai.opencode.desktop", "cli", "2.2.0-x64");
    mkdirSync(dDir, { recursive: true });
    argsBinary(dDir, "opencode-cli");
    const res = runLauncherArgs(dHome, ["run"]);
    assert(res.status === 0, "launcher runs the Desktop CLI when the terminal copy is absent");
    assert(res.stdout.includes("ARGS=run --standalone"), "run gets --standalone in isolated mode");
    assert(res.stderr.includes("isolated client mode"), "isolation injection is announced");
    assert(!existsSync(join(dHome, ".opencode")), "no terminal install was required");
    const explicit = runLauncherArgs(dHome, ["run", "--standalone"]);
    assert(explicit.stdout.includes("ARGS=run --standalone"), "explicit --standalone is not duplicated");
    const serve = runLauncherArgs(dHome, ["serve", "--port", "0"]);
    assert(serve.stdout.includes("ARGS=serve --port 0"), "serve is never forced into standalone");
    assert(!serve.stderr.includes("isolated client mode"), "serve skips the isolation notice");
    const tui = runLauncherArgs(dHome, []);
    assert(tui.stdout.includes("ARGS=--standalone"), "bare TUI gets a private server");
    const missing = runLauncherArgs(tempHome("no-host"), ["run"]);
    assert(missing.status === 2 && missing.stderr.includes("host binary not found"), "no host anywhere refuses with rc 2");
  }

  {
    const future = versionBinary(lBin, "opencode-future", "2.2.2");
    const newer = runLauncher(lHome, { TAWASSUL_OPENCODE_BIN: future, TAWASSUL_WATCHER: "off" });
    assert(newer.status === 0, "a newer 2.x host is accepted");
    assert(newer.stderr.includes("newer than the audited v2.2.1"), "a newer 2.x host warns about the audited ceiling");

    const major = versionBinary(lBin, "opencode-major", "3.0.0");
    const refusedMajor = runLauncher(lHome, { TAWASSUL_OPENCODE_BIN: major });
    assert(refusedMajor.status === 2, "a 3.x host is refused");
    assert(refusedMajor.stderr.includes("supported v>=2.2.0 <3.0.0"), "the refusal names the supported range");

    const old = versionBinary(lBin, "opencode-old", "2.1.4");
    const refusedOld = runLauncher(lHome, { TAWASSUL_OPENCODE_BIN: old });
    assert(refusedOld.status === 2 && refusedOld.stderr.includes("supported v>=2.2.0 <3.0.0"), "a pre-2.2 host is refused");

    const pinned = runLauncher(lHome, {
      TAWASSUL_OPENCODE_BIN: future,
      TAWASSUL_OPENCODE_VERSION: "2.2.2",
      TAWASSUL_WATCHER: "off",
    });
    assert(pinned.status === 0, "an explicit pin accepts its exact version");
    const pinnedMismatch = runLauncher(lHome, { TAWASSUL_OPENCODE_BIN: supported, TAWASSUL_OPENCODE_VERSION: "2.2.2" });
    assert(pinnedMismatch.status === 2 && pinnedMismatch.stderr.includes("pinned v2.2.2"), "an explicit pin refuses another version");

    const pinBelowRange = runLauncher(lHome, { TAWASSUL_OPENCODE_BIN: old, TAWASSUL_OPENCODE_VERSION: "2.1.4" });
    assert(pinBelowRange.status === 2, "an explicit pin below the supported range is refused");
    assert(pinBelowRange.stderr.includes("outside the supported range"), "the pin refusal names the range");
  }

  {
    const bad = spawnSync("/bin/bash", [launcher, "--version"], { env: cleanEnv(lHome), encoding: "utf8", timeout: 60000 });
    assert((bad.status ?? -1) === 0, "fake host version passes the pin");
    const before = launcherLines(lHome).length;
    const res = runLauncher(lHome);
    assert(res.status === 0 && launcherLines(lHome).length === before + 1, "every successful launch logs one line");
    assert(defaultBin.length > 0 && existsSync(defaultBin), "default fake binary exists");
  }

  function scoreHome(tag: string): string {
    const home = tempHome(tag);
    mkdirSync(join(home, ".local", "share", "tawassul-v2", "tawassul"), { recursive: true });
    mkdirSync(join(home, ".local", "share", "opencode", "log"), { recursive: true });
    return home;
  }

  function writeTlog(home: string, lines: string[]): void {
    writeFileSync(join(home, ".local", "share", "tawassul-v2", "tawassul", "tawassul.log"), lines.join("\n") + "\n", "utf8");
  }

  function writeOlog(home: string, lines: string[]): void {
    writeFileSync(join(home, ".local", "share", "opencode", "log", "opencode.log"), lines.join("\n") + "\n", "utf8");
  }

  function writeN2(home: string, records: Array<Record<string, unknown>>): void {
    writeFileSync(
      join(home, ".local", "share", "tawassul-v2", "n2-auto.jsonl"),
      records.map((r) => JSON.stringify(r)).join("\n") + "\n",
      "utf8",
    );
  }

  function runScore(home: string, args: string[]): { status: number; stdout: string; stderr: string } {
    const res = spawnSync("/bin/bash", [scorecard, ...args], { env: cleanEnv(home), encoding: "utf8", timeout: 60000 });
    return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  }

  function iso(ms: number): string {
    return new Date(ms).toISOString();
  }

  function healthyLogs(home: string, sinceMs: number): void {
    const at = sinceMs + 10_000;
    writeTlog(home, [
      `${iso(at)} [tawassul] initPlugin=1200ms`,
      `${iso(at + 1000)} [tawassul] [bash] State validation failed: echoed command`,
      `${iso(at + 1000)} [tawassul] State validation failed: pattern=permission`,
    ]);
    writeOlog(home, [
      `timestamp=${iso(at)} level=INFO message="failed to subscribe to events"`,
      `timestamp=${iso(at)} level=INFO message="project copy refresh started" projectID=prj_proof`,
      `timestamp=${iso(at + 2000)} level=INFO message="project copy refresh done" projectID=prj_proof`,
    ]);
  }

  function n2Record(sinceMs: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ts_ms: sinceMs + 8000,
      iso: iso(sinceMs + 8000),
      session_id: "ses_proof",
      message_id: "msg_proof",
      part_id: "part_proof",
      len: 6,
      process_start_ms: sinceMs + 1000,
      since_init_ms: 7000,
      source: "event:message.part.updated",
      role_gate: true,
      ...extra,
    };
  }

  {
    const home = scoreHome("empty");
    const res = runScore(home, ["--n2", "10"]);
    assert(res.status === 2, "empty window is INCOMPLETE (rc 2)");
    assert(res.stdout.includes("N1 INCOMPLETE") && res.stdout.includes("N3 INCOMPLETE"), "missing streams are incomplete, not pass");
  }

  {
    const home = scoreHome("healthy");
    const now = Date.now();
    const sinceMs = now - 60_000;
    healthyLogs(home, sinceMs);
    const res = runScore(home, ["--since", iso(sinceMs), "--n2", "10"]);
    assert(res.status === 0, "healthy window passes (rc 0)");
    assert(res.stdout.includes("overall: PASS"), "healthy window reports PASS");
    assert(res.stdout.includes("N1 PASS") && res.stdout.includes("N4 PASS"), "INFO subscribe and command echoes do not fail N1/N4");
    assert(res.stdout.includes("N5 PASS"), "refresh pair passes N5");
    const slow = runScore(home, ["--since", iso(sinceMs), "--n2", "18"]);
    assert(slow.status === 1 && slow.stdout.includes("N2 FAIL"), "slow first stream fails N2");
  }

  {
    const home = scoreHome("n5-na");
    const now = Date.now();
    const sinceMs = now - 60_000;
    writeTlog(home, [`${iso(sinceMs + 10_000)} [tawassul] initPlugin=1200ms`]);
    writeOlog(home, [`timestamp=${iso(sinceMs + 10_000)} level=INFO message="location services booted" durationMs=307`]);
    const res = runScore(home, ["--since", iso(sinceMs), "--n2", "10"]);
    assert(res.status === 0, "host without project-copy refresh marks N5 N/A (rc 0)");
    assert(res.stdout.includes("N5 N/A"), "N5 is N/A when the host has no refresh signal");
    assert(res.stdout.includes("overall: PASS"), "N5 N/A does not block PASS");
  }

  {
    const home = scoreHome("n4fail");
    const now = Date.now();
    const sinceMs = now - 60_000;
    healthyLogs(home, sinceMs);
    appendFileSync(join(home, ".local", "share", "tawassul-v2", "tawassul", "tawassul.log"), `${iso(sinceMs + 11_000)} [tawassul] State validation failed: boom\n`, "utf8");
    const res = runScore(home, ["--since", iso(sinceMs), "--n2", "10"]);
    assert(res.status === 1 && res.stdout.includes("N4 FAIL"), "a real state failure fails N4");
  }

  {
    const home = scoreHome("n1fail");
    const now = Date.now();
    const sinceMs = now - 60_000;
    healthyLogs(home, sinceMs);
    appendFileSync(join(home, ".local", "share", "opencode", "log", "opencode.log"), `timestamp=${iso(sinceMs + 11_000)} level=ERROR message="failed to subscribe to events"\n`, "utf8");
    const res = runScore(home, ["--since", iso(sinceMs), "--n2", "10"]);
    assert(res.status === 1 && res.stdout.includes("N1 FAIL"), "an ERROR subscribe line fails N1");
  }

  {
    const home = scoreHome("stale");
    const now = Date.now();
    writeTlog(home, [`${iso(now - 7_200_000)} [tawassul] initPlugin=900ms`]);
    writeOlog(home, [`timestamp=${iso(now - 7_200_000)} level=INFO message="project copy refresh started" projectID=old`]);
    const res = runScore(home, ["--since", iso(now - 60_000), "--n2", "10"]);
    assert(res.status === 2, "out-of-window lines are not evidence (rc 2)");
    assert(res.stdout.includes("N1 INCOMPLETE") && res.stdout.includes("N3 INCOMPLETE"), "stale streams are incomplete");
  }

  {
    const home = scoreHome("n2-gate");
    const now = Date.now();
    const sinceMs = now - 60_000;
    healthyLogs(home, sinceMs);
    writeN2(home, [{ ...n2Record(sinceMs), role_gate: undefined }].map((r) => {
      const copy = { ...r };
      delete copy.role_gate;
      return copy;
    }));
    const auto = runScore(home, ["--since", iso(sinceMs), "--n2", "auto"]);
    assert(auto.status === 2, "auto N2 without a post-gate record is INCOMPLETE (rc 2)");
    assert(auto.stdout.includes("pre-gate record(s) discarded"), "auto N2 reports discarded pre-gate records");
    writeN2(home, [n2Record(sinceMs)]);
    const pass = runScore(home, ["--since", iso(sinceMs), "--n2", "auto"]);
    assert(pass.status === 0, "auto N2 with a post-gate record passes (rc 0)");
    assert(pass.stdout.includes("role_gate"), "auto N2 note names the gate marker");
    const noSince = runScore(home, ["--hours", "1", "--n2", "auto"]);
    assert(noSince.status === 2 && noSince.stdout.includes("explicit --since"), "auto N2 without --since is INCOMPLETE");
    const noSinceShort = runScore(home, ["--n2", "auto"]);
    assert(noSinceShort.status === 2 && noSinceShort.stdout.includes("explicit --since"), "auto N2 with only --hours is INCOMPLETE");
  }

  {
    const home = scoreHome("json");
    const now = Date.now();
    const sinceMs = now - 60_000;
    healthyLogs(home, sinceMs);
    writeN2(home, [n2Record(sinceMs)]);
    const res = runScore(home, ["--since", iso(sinceMs), "--n2", "auto", "--json", "--case", "7"]);
    assert(res.status === 0, "JSON run passes");
    const doc = JSON.parse(res.stdout.trim()) as { overall?: string; case?: string; criteria?: Array<{ id?: string }> };
    assert(doc.overall === "PASS" && doc.case === "7", "JSON carries the verdict and case");
    assert((doc.criteria ?? []).map((c) => c.id).join(",") === "N1,N2,N3,N4,N5", "JSON carries all five criteria");
  }

  {
    const home = scoreHome("usage");
    assert(runScore(home, ["--bogus"]).status === 64, "unknown flag exits 64");
    assert(runScore(home, ["--since"]).status === 64, "missing --since value exits 64");
    assert(runScore(home, ["--since", "not-a-date"]).status === 64, "bad --since exits 64");
    assert(runScore(home, ["--n2", "soon"]).status === 64, "bad --n2 exits 64");
  }

  console.log("PROOF PASS: launcher watcher policy and v2 boot scorecard gates");
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
