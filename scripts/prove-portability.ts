import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const WORK = mkdtempSync(join(tmpdir(), "tawassul-portability-"));
const SHIMS = join(WORK, "bsd-shims");
const DATA = join(WORK, "data", "opencode");
const BK = join(WORK, "bk");
const EMPTY = join(WORK, "empty-path");
const DB = join(DATA, "opencode.db");

mkdirSync(SHIMS, { recursive: true });
mkdirSync(DATA, { recursive: true });
mkdirSync(BK, { recursive: true });
mkdirSync(EMPTY, { recursive: true });

writeFileSync(
  join(SHIMS, "stat"),
  [
    "#!/bin/bash",
    'for a in "$@"; do case "$a" in -c) echo "stat: illegal option -- c" >&2; exit 1 ;; esac; done',
    'if [ "${1:-}" = "-f" ] && [ "${2:-}" = "%z" ]; then shift 2; wc -c < "$1"; exit 0; fi',
    'exec /usr/bin/stat "$@"',
    "",
  ].join("\n"),
  { mode: 0o755 },
);

writeFileSync(
  join(SHIMS, "date"),
  [
    "#!/bin/bash",
    'case "${1:-}" in',
    '  -d) echo "date: illegal option -- d" >&2; exit 1 ;;',
    "  -v-*)",
    '    n="$(printf \'%s\' "${1#-v-}" | tr -d "d")"',
    "    case \"$n\" in ''|*[!0-9]*) exit 1 ;; esac",
    "    awk -v now=\"$(/usr/bin/date +%s)\" -v n=\"$n\" 'BEGIN{print int(now - n*86400)}'",
    "    ;;",
    '  *) exec /usr/bin/date "$@" ;;',
    "esac",
    "",
  ].join("\n"),
  { mode: 0o755 },
);

writeFileSync(
  join(SHIMS, "df"),
  [
    "#!/bin/bash",
    'for a in "$@"; do case "$a" in -B1|*output=avail*) echo "df: illegal option" >&2; exit 1 ;; esac; done',
    'exec /usr/bin/df "$@"',
    "",
  ].join("\n"),
  { mode: 0o755 },
);

for (const tool of ["awk", "python3", "wc"]) {
  symlinkSync(`/usr/bin/${tool}`, join(SHIMS, tool));
}

function variantDir(name: string, omit: Array<string>, extra: Array<string>): string {
  const dir = join(WORK, name);
  mkdirSync(dir, { recursive: true });
  for (const tool of ["stat", "date", "df", "awk", "python3", "wc"]) {
    if (omit.includes(tool)) continue;
    symlinkSync(join(SHIMS, tool), join(dir, tool));
  }
  for (const tool of extra) {
    symlinkSync(`/usr/bin/${tool}`, join(dir, tool));
  }
  return dir;
}

const VMSTAT_DIR = variantDir("var-vmstat", [], ["true"]);
mkdirSync(VMSTAT_DIR, { recursive: true });
writeFileSync(
  join(VMSTAT_DIR, "vm_stat"),
  [
    "#!/bin/bash",
    "echo 'Mach Virtual Memory Statistics: (page size of 4096 bytes)'",
    "echo 'Pages free: 65536.'",
    "echo 'Pages active: 131072.'",
    "echo 'Pages inactive: 98304.'",
    "echo 'Pages speculative: 16384.'",
    "",
  ].join("\n"),
  { mode: 0o755 },
);
const NOSTAT_DIR = variantDir("var-nostat", ["stat"], []);
const NODATE_DIR = variantDir("var-nodate", ["date"], []);

const shimEnv: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: `${SHIMS}:/usr/bin:/bin`,
  OPENCODE_DB: DB,
  TAWASSUL_BACKUP_DIR: BK,
};

function which(tool: string, env: NodeJS.ProcessEnv): string {
  const result = spawnSync("/bin/bash", ["-c", `command -v ${tool}`], { env, encoding: "utf-8" });
  return `${result.stdout ?? ""}`.trim();
}

function helper(name: string, args: string[], env: NodeJS.ProcessEnv): { code: number; out: string } {
  const probe = [`set -u`, `. "${join(REPO, "scripts", "db-env.sh")}"`, `${name} ${args.join(" ")}`].join("\n");
  const result = spawnSync("/bin/bash", ["-c", probe], { env, encoding: "utf-8" });
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}`.trim() };
}

function maintenance(args: string[]): { code: number; out: string } {
  const result = spawnSync("/bin/bash", [join(REPO, "scripts", "opencode-db-maintenance.sh"), ...args], {
    env: shimEnv,
    encoding: "utf-8",
  });
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function seed(rows: number): void {
  const nowMs = Date.now();
  const oldMs = nowMs - 200 * 86400000;
  const lines = [
    "PRAGMA journal_mode=wal;",
    "CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY);",
    "CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY);",
    "CREATE TABLE IF NOT EXISTS session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, created INTEGER DEFAULT 0 NOT NULL);",
    "CREATE TABLE IF NOT EXISTS event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, owner_id TEXT);",
    "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "DELETE FROM session_message;",
    "INSERT OR REPLACE INTO session_v2 VALUES ('s0');",
    "INSERT OR REPLACE INTO kv VALUES ('migration.v1-v2','{\"completed\":true}');",
    `INSERT OR REPLACE INTO event VALUES ('e0','s0',1,'t','{}',${nowMs});`,
  ];
  for (let i = 0; i < rows; i++) {
    lines.push(`INSERT INTO session_message VALUES ('m${rows}-${i}','s0','assistant',${i},${oldMs},${oldMs},'padding');`);
  }
  const result = spawnSync("sqlite3", [DB], { input: lines.join(""), encoding: "utf-8" });
  if (result.status !== 0) fail(`sqlite3 seeding failed: ${result.stderr ?? ""}`);
}

const envWith = (dir: string): NodeJS.ProcessEnv => ({ ...shimEnv, PATH: dir });

try {
  assert(which("stat", shimEnv) === join(SHIMS, "stat"), "the BSD stat shim shadows the GNU stat");
  assert(spawnSync("/bin/bash", ["-c", "stat -c %s /etc/hostname"], { env: shimEnv }).status !== 0, "the shim refuses GNU-only stat -c like real BSD stat");
  assert(spawnSync("/bin/bash", ["-c", "date -d 'now -90 days' +%s"], { env: shimEnv }).status !== 0, "the shim refuses GNU-only date -d like real BSD date");
  assert(spawnSync("/bin/bash", ["-c", "df -B1 --output=avail /tmp/opencode"], { env: shimEnv }).status !== 0, "the shim refuses GNU-only df -B1 like real BSD df");
  assert(which("free", envWith(SHIMS)) === "", "free is absent in the restricted PATH");
  assert(which("vm_stat", envWith(SHIMS)) === "", "vm_stat is absent in the restricted PATH");

  seed(60);

  const bytesGnu = helper("tawassul_file_bytes", [`"${DB}"`], shimEnv);
  assert(bytesGnu.code === 0 && /^\d+$/.test(bytesGnu.out), "tawassul_file_bytes resolves on the GNU rung in the plain environment");

  const bytes = helper("tawassul_file_bytes", [`"${DB}"`], envWith(SHIMS));
  assert(bytes.code === 0 && /^\d+$/.test(bytes.out) && Number(bytes.out) > 0, "tawassul_file_bytes falls through to the BSD stat rung");

  const bytesPy = helper("tawassul_file_bytes", [`"${DB}"`], envWith(NOSTAT_DIR));
  assert(bytesPy.code === 0 && /^\d+$/.test(bytesPy.out) && Number(bytesPy.out) > 0, "tawassul_file_bytes falls through to the python3 rung without stat");

  const epoch = helper("tawassul_date_epoch_days", ["90"], envWith(SHIMS));
  assert(epoch.code === 0 && /^\d+$/.test(epoch.out), "tawassul_date_epoch_days falls through to the BSD date -v rung");
  const nowSec = Math.floor(Date.now() / 1000);
  assert(Math.abs(Number(epoch.out) - (nowSec - 90 * 86400)) < 120, "the BSD rung returns a true 90-day-old epoch");

  const epochPy = helper("tawassul_date_epoch_days", ["90"], envWith(NODATE_DIR));
  assert(epochPy.code === 0 && /^\d+$/.test(epochPy.out), "tawassul_date_epoch_days falls through to the python3 rung without date");

  const ramFree = helper("tawassul_free_ram_mb", [], shimEnv);
  assert(ramFree.code === 0 && /^\d+$/.test(ramFree.out) && Number(ramFree.out) > 0, "tawassul_free_ram_mb resolves on the GNU free rung");

  const ramVm = helper("tawassul_free_ram_mb", [], envWith(VMSTAT_DIR));
  assert(ramVm.code === 0 && ramVm.out === "704", "tawassul_free_ram_mb parses the macOS vm_stat output (704 MB)");

  const ramProc = helper("tawassul_free_ram_mb", [], envWith(NOSTAT_DIR));
  assert(ramProc.code === 0 && /^\d+$/.test(ramProc.out) && Number(ramProc.out) > 0, "tawassul_free_ram_mb falls through to the python3 /proc rung");

  const avail = helper("tawassul_avail_bytes", [`"/tmp/opencode"`], envWith(SHIMS));
  assert(avail.code === 0 && /^\d+$/.test(avail.out) && Number(avail.out) > 1024, "tawassul_avail_bytes uses the POSIX df -Pk form");

  const noTool = helper("tawassul_file_bytes", [`"${DB}"`], envWith(EMPTY));
  assert(noTool.code !== 0, "tawassul_file_bytes fails closed when no size tool exists");
  const noEpoch = helper("tawassul_date_epoch_days", ["90"], envWith(EMPTY));
  assert(noEpoch.code !== 0, "tawassul_date_epoch_days fails closed when no epoch tool exists");
  const noRam = helper("tawassul_free_ram_mb", [], envWith(EMPTY));
  assert(noRam.code !== 0, "tawassul_free_ram_mb fails closed when no RAM tool exists");
  const noAvail = helper("tawassul_avail_bytes", [`"/tmp/opencode"`], envWith(EMPTY));
  assert(noAvail.code !== 0, "tawassul_avail_bytes fails closed when df is unreadable");

  const checked = maintenance(["--db", DB, "--check", "--ignore-low-ram"]);
  assert(checked.code === 0, "maintenance --check completes in the macOS-like environment");
  assert(checked.out.includes("target:") && checked.out.includes("db+wal"), "the check reports sizes without dying at the size line");

  seed(320);
  const pruned = maintenance(["--db", DB, "--prune-days", "90", "--backup-dir", BK, "--ignore-low-ram"]);
  assert(pruned.code === 0, "a small prune completes in the macOS-like environment");
  assert(pruned.out.includes("prune: deleted 320 rows"), "the prune deleted the old rows under BSD shims");
  assert(pruned.out.includes("❌") === false, "no hard failure appears in the prune run");

  rmSync(WORK, { recursive: true, force: true });
  console.log(`PROOF PASS: ${passed} assertions`);
} finally {
  rmSync(WORK, { recursive: true, force: true });
}
