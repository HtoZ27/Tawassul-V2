import {
  chmodSync,
  fsyncSync as realFsync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync as realRename,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { syncLiveEntry } from "./live-entry-sync.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
  console.log(`ok ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) fail(`${message} (expected ${String(expected)}, got ${String(actual)})`);
  console.log(`ok ${message}`);
}

function tempsIn(directory: string): string[] {
  return readdirSync(directory).filter((name) => name.endsWith(".tmp"));
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-live-entry-"));
try {
  const source = join(work, "dist-index.js");
  const live = join(work, "tawassul.js");
  writeFileSync(source, "console.log('v1')\n");
  writeFileSync(live, "console.log('v1')\n");
  chmodSync(live, 0o755);
  const identicalBefore = statSync(live);

  const identical = syncLiveEntry(source, live);
  const identicalAfter = statSync(live);
  equal(identical.written, false, "identical bytes are skipped");
  equal(identicalAfter.ino, identicalBefore.ino, "the skipped entry keeps its inode");
  equal(identicalAfter.mtimeMs, identicalBefore.mtimeMs, "the skipped entry keeps its mtime");

  const freshRoot = mkdtempSync(join(work, "fresh-"));
  const freshLive = join(freshRoot, "tawassul.js");
  const fresh = syncLiveEntry(source, freshLive);
  const expectedMode = (statSync(source).mode & 0o7777) & ~process.umask();
  equal(fresh.written, true, "a missing live entry is created");
  assert(readFileSync(freshLive).equals(readFileSync(source)), "a missing live entry receives the source bytes");
  equal(statSync(freshLive).mode & 0o7777, expectedMode, "a fresh live entry inherits the source mode under the umask");

  writeFileSync(source, "console.log('v2')\n");
  const events: string[] = [];
  const changed = syncLiveEntry(source, live, {
    fs: {
      fsyncSync: (descriptor) => {
        events.push("fsync");
        return realFsync(descriptor);
      },
      renameSync: (from, to) => {
        events.push("rename");
        return realRename(from, to);
      },
    },
  });
  const changedAfter = statSync(live);
  equal(changed.written, true, "different bytes are written");
  assert(readFileSync(live).equals(readFileSync(source)), "the live entry equals the source after the write");
  assert(changedAfter.ino !== identicalAfter.ino, "the atomic replace changes the inode");
  equal(changedAfter.mode & 0o777, 0o755, "the existing entry mode survives the replace");
  equal(events.join(","), "fsync,rename", "fsync completes before the rename");

  writeFileSync(source, "console.log('v3')\nTAWASSUL_SOURCE_SHA=current\n");
  writeFileSync(live, "console.log('stale-body')\nTAWASSUL_SOURCE_SHA=current\n");
  const stale = syncLiveEntry(source, live);
  equal(stale.written, true, "a stale entry with the current trailer is replaced");
  assert(readFileSync(live).equals(readFileSync(source)), "a stale trailer never hides a byte difference");

  const staleTemp = `${live}.${process.pid}.0.tmp`;
  writeFileSync(staleTemp, "crashed-build\n");
  writeFileSync(source, "console.log('v4')\n");
  const retried = syncLiveEntry(source, live);
  equal(retried.written, true, "a stale temp file is skipped through the exclusive-create retry");
  equal(readFileSync(staleTemp, "utf8"), "crashed-build\n", "another build's temp file is left untouched");
  assert(readFileSync(live, "utf8").includes("v4"), "the retried create writes the new bytes");
  rmSync(staleTemp);

  const linkRoot = mkdtempSync(join(work, "link-"));
  const linkTarget = join(linkRoot, "real-entry.js");
  writeFileSync(linkTarget, "old\n");
  const linkPath = join(linkRoot, "entry.js");
  symlinkSync(linkTarget, linkPath);
  writeFileSync(source, "console.log('linked')\n");
  const linked = syncLiveEntry(source, linkPath);
  equal(linked.written, true, "a symlinked live entry is written through the link");
  assert(lstatSync(linkPath).isSymbolicLink(), "the symlink itself is preserved");
  assert(readFileSync(linkTarget, "utf8").includes("linked"), "the symlink target receives the bytes");

  const danglingRoot = mkdtempSync(join(work, "dangling-"));
  const dangling = join(danglingRoot, "entry.js");
  symlinkSync(join(danglingRoot, "missing-target.js"), dangling);
  let danglingThrew = false;
  try {
    syncLiveEntry(source, dangling);
  } catch {
    danglingThrew = true;
  }
  assert(danglingThrew, "a dangling symlink is a hard error");
  assert(!readdirSync(danglingRoot).includes("missing-target.js"), "a dangling symlink target is never created");
  assert(lstatSync(dangling).isSymbolicLink(), "the dangling symlink itself is not replaced");

  const missingWork = mkdtempSync(join(work, "missing-"));
  const missingLive = join(missingWork, "tawassul.js");
  let missingThrew = false;
  try {
    syncLiveEntry(join(missingWork, "absent.js"), missingLive);
  } catch {
    missingThrew = true;
  }
  assert(missingThrew, "a missing source throws");
  assert(!readdirSync(missingWork).includes("tawassul.js"), "a missing source writes nothing");

  const failingRoot = mkdtempSync(join(work, "failing-"));
  const failingLive = join(failingRoot, "tawassul.js");
  writeFileSync(failingLive, "old\n");
  writeFileSync(source, "console.log('failing')\n");
  let renameThrew = false;
  try {
    syncLiveEntry(source, failingLive, {
      fs: {
        renameSync: () => {
          const error = new Error("injected rename failure") as Error & { code: string };
          error.code = "EACCES";
          throw error;
        },
      },
    });
  } catch {
    renameThrew = true;
  }
  assert(renameThrew, "an injected rename failure throws");
  equal(tempsIn(failingRoot).length, 0, "an injected rename failure removes its temp file");
  equal(readFileSync(failingLive, "utf8"), "old\n", "an injected rename failure leaves the live entry untouched");

  console.log("skipped: the native EPERM/EBUSY rename lane is not driven; the injected retry seam covers the mapping");

  let epermAttempts = 0;
  const epermRoot = mkdtempSync(join(work, "eperm-"));
  const epermLive = join(epermRoot, "tawassul.js");
  writeFileSync(epermLive, "old\n");
  const eperm = syncLiveEntry(source, epermLive, {
    retryDelayMs: 1,
    fs: {
      renameSync: (from, to) => {
        epermAttempts += 1;
        if (epermAttempts === 1) {
          const error = new Error("injected EPERM") as Error & { code: string };
          error.code = "EPERM";
          throw error;
        }
        return realRename(from, to);
      },
    },
  });
  equal(eperm.written, true, "an EPERM rename is retried once");
  equal(epermAttempts, 2, "the EPERM retry runs exactly twice");
  assert(readFileSync(epermLive, "utf8").includes("failing"), "the retried rename replaces the entry");

  equal(tempsIn(work).length, 0, "the sync leaves no temp residue in the work root");
  equal(tempsIn(linkRoot).length, 0, "the sync leaves no temp residue beside a link target");
  equal(tempsIn(failingRoot).length, 0, "the sync leaves no temp residue after a failure");

  const build = readFileSync(join(repo, "build-v2.mjs"), "utf8");
  assert(build.includes("syncLiveEntry("), "the build calls syncLiveEntry for the live entry");
  const smoke = readFileSync(join(repo, "scripts", "release-smoke.sh"), "utf8");
  const comparator = 'if ! cmp -s "$ENTRY" "$REPO/dist/index.js"; then';
  assert(smoke.includes(comparator), "release smoke pins the comparator line");
  const beforeCopy = smoke.indexOf(comparator) < smoke.indexOf('cp "$ENTRY"');
  assert(beforeCopy, "release smoke compares the live entry before it copies it");

  const pairRoot = mkdtempSync(join(work, "cmp-"));
  const entry = join(pairRoot, "entry.js");
  const dist = join(pairRoot, "dist.js");
  writeFileSync(entry, "same\n");
  writeFileSync(dist, "same\n");
  const equalPair = spawnSync("bash", ["-c", 'if ! cmp -s "$1" "$2"; then exit 3; fi', "cmp", entry, dist], {
    encoding: "utf8",
  });
  equal(equalPair.status, 0, "the smoke comparator accepts an equal pair");
  writeFileSync(dist, "different\n");
  const differentPair = spawnSync("bash", ["-c", 'if ! cmp -s "$1" "$2"; then exit 3; fi', "cmp", entry, dist], {
    encoding: "utf8",
  });
  equal(differentPair.status, 3, "the smoke comparator maps a difference to exit 3");
  const missingPair = spawnSync("bash", ["-c", 'if ! cmp -s "$1" "$2"; then exit 3; fi', "cmp", entry, join(pairRoot, "absent.js")], {
    encoding: "utf8",
  });
  equal(missingPair.status, 3, "the smoke comparator maps a missing file to exit 3");

  console.log("PROOF PASS: live entry sync is byte-exact, atomic, symlink-safe, and smoke-pinned");
} finally {
  rmSync(work, { recursive: true, force: true });
}
