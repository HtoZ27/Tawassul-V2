import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch } from "../src/services/apply-patch.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

function tempRoot(tag: string): string {
  return mkdtempSync(join(tmpdir(), `tawassul-e30-${tag}-`));
}

function patchTempFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.startsWith(".tawassul-patch-"));
  } catch {
    return [];
  }
}

async function proveTraversal(): Promise<void> {
  const root = tempRoot("traversal");
  try {
    const base = join(root, "base");
    mkdirSync(base, { recursive: true });
    const relative = await applyPatch("../escape.txt", "x", { baseDir: base });
    assert(!relative.applied && (relative.error ?? "").includes("traversal"), "relative traversal is rejected");
    const absolute = await applyPatch(join(root, "base2", "file.txt"), "x", { baseDir: base });
    assert(!absolute.applied && (absolute.error ?? "").includes("outside"), "sibling prefix is rejected");
    const missingBase = await applyPatch("file.txt", "x", { baseDir: join(root, "missing") });
    assert(!missingBase.applied && (missingBase.error ?? "").includes("not accessible"), "missing base is rejected");
    assert(!existsSync(join(root, "base2")), "rejected writes create nothing");
    console.log("traversal ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveSymlinks(): Promise<void> {
  const root = tempRoot("symlink");
  try {
    const base = join(root, "base");
    const outside = join(root, "outside");
    mkdirSync(base, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "secret", "utf-8");
    symlinkSync(outside, join(base, "link"));
    const parent = await applyPatch("link/evil.txt", "pwned", { baseDir: base });
    assert(!parent.applied && (parent.error ?? "").includes("Symlink escape"), "symlinked parent is rejected");
    assert(!existsSync(join(outside, "evil.txt")), "symlinked parent writes nothing outside");

    symlinkSync(join(outside, "secret.txt"), join(base, "target.txt"));
    const target = await applyPatch("target.txt", "pwned", { baseDir: base });
    assert(!target.applied && (target.error ?? "").includes("Symlink escape"), "symlinked target is rejected");
    assert(readFileSync(join(outside, "secret.txt"), "utf-8") === "secret", "symlinked target stays untouched");

    symlinkSync(join(outside, "secret.txt"), join(base, "safe.txt.bak"));
    writeFileSync(join(base, "safe.txt"), "old", "utf-8");
    const backup = await applyPatch("safe.txt", "new", { baseDir: base });
    assert(backup.applied, "regular target with a symlinked backup still applies");
    assert(readFileSync(join(outside, "secret.txt"), "utf-8") === "secret", "symlinked backup never writes outside");
    assert(readFileSync(join(base, "safe.txt.bak"), "utf-8") === "old", "backup is a regular file with the old content");
    console.log("symlinks ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveWrite(): Promise<void> {
  const root = tempRoot("write");
  try {
    const base = join(root, "base");
    mkdirSync(base, { recursive: true });
    const target = join(base, "nested", "deep", "file.txt");
    const created = await applyPatch("nested/deep/file.txt", "hello", { baseDir: base });
    assert(created.applied, "missing parent inside the base is created");
    assert(readFileSync(target, "utf-8") === "hello", "content is written");
    assert(patchTempFiles(join(base, "nested", "deep")).length === 0, "no temp file is left behind");

    writeFileSync(target, "old", "utf-8");
    chmodSync(target, 0o640);
    const replaced = await applyPatch("nested/deep/file.txt", "new", { baseDir: base });
    assert(replaced.applied, "existing file is replaced");
    assert(readFileSync(target, "utf-8") === "new", "replacement content wins");
    assert(readFileSync(`${target}.bak`, "utf-8") === "old", "backup keeps the previous content");
    assert((statSync(target).mode & 0o777) === 0o640, "replacement preserves the file mode");

    const dry = await applyPatch("nested/deep/file.txt", "dry", { baseDir: base, dryRun: true });
    assert(dry.applied && readFileSync(target, "utf-8") === "new", "dry run applies nothing");

    const lockName = Buffer.from(target).toString("base64url");
    assert(!existsSync(join(tmpdir(), "tawassul-v2-locks", lockName)), "lock is released");
    console.log("write ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveFailureCleanup(): Promise<void> {
  const root = tempRoot("cleanup");
  try {
    const base = join(root, "base");
    const readonly = join(base, "readonly");
    mkdirSync(readonly, { recursive: true });
    chmodSync(readonly, 0o500);
    const failed = await applyPatch("readonly/file.txt", "x", { baseDir: base });
    assert(!failed.applied, "unwritable parent fails the patch");
    assert((failed.error ?? "").includes("Write failed"), "write failure is reported");
    assert(patchTempFiles(readonly).length === 0, "failed write leaves no temp file");
    chmodSync(readonly, 0o700);
    assert(!existsSync(join(readonly, "file.txt")), "failed write creates no target");

    const dirTarget = join(base, "dir-target");
    mkdirSync(dirTarget);
    const notFile = await applyPatch("dir-target", "x", { baseDir: base });
    assert(!notFile.applied && (notFile.error ?? "").includes("regular file"), "directory target is rejected");
    console.log("failure-cleanup ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveTmpdirIsolation(): Promise<void> {
  const root = tempRoot("tmpdir");
  try {
    const base = join(root, "base");
    mkdirSync(base, { recursive: true });
    const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith(".tawassul-patch-")));
    const result = await applyPatch("file.txt", "payload", { baseDir: base });
    assert(result.applied, "tmpdir isolation patch applies");
    const after = readdirSync(tmpdir()).filter(
      (name) => name.startsWith(".tawassul-patch-") && !before.has(name),
    );
    assert(after.length === 0, "no patch temp file lands in the system tmpdir");
    console.log("tmpdir-isolation ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await proveTraversal();
await proveSymlinks();
await proveWrite();
await proveFailureCleanup();
await proveTmpdirIsolation();
console.log("PROOF PASS: applyPatch containment and atomic writes");
