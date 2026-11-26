import "./proof-log-isolate.ts";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getWorktreeBlockReason } from "../src/services/isolation.ts";
import {
  canonicalPathKey,
  projectRootFor,
  resolveProjectIdentity,
  sanitizeProjectKey,
  usableProjectID,
} from "../src/utils/project-identity.ts";
import {
  bootPlugin,
  disposePlugin,
  prepareHarnessEnv,
  prepareWorkspace,
  recordTitles,
  writeRecord,
} from "./state-root-harness.ts";

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

function digest(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

const work = mkdtempSync(join(tmpdir(), "tawassul-state-root-survival-"));
const ID_A = "aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00";
const ID_B = "1111222233334444555566667777888899990000";

try {
  prepareHarnessEnv(work, join(work, "hmac"));
  const dirA = resolve(work, "workspace-a");
  const dirB = resolve(work, "workspace-b");
  const dirC = resolve(work, "workspace-c");
  prepareWorkspace(dirA);
  prepareWorkspace(dirB);
  prepareWorkspace(dirC);

  const identityA = resolveProjectIdentity({
    directory: dirA,
    project: { id: ID_A, directory: dirA, canonical: dirA },
  });
  const identityB = resolveProjectIdentity({
    directory: dirB,
    project: { id: ID_A, directory: dirB, canonical: dirA },
  });
  assert(identityA.key === identityB.key, "two working directories of one project share one key");
  assert(identityA.source === "project-id", "the host project id is the primary identity source");
  assert(identityA.key === sanitizeProjectKey(ID_A), "the key is the sanitized host project id");
  assert(/^[a-z0-9][a-z0-9._-]*$/.test(identityA.key), "the key is filesystem-safe");
  assert(identityA.key !== identityB.directory, "the key is not the working directory");

  const redirected = resolveProjectIdentity({
    directory: dirA,
    project: { id: "global", directory: dirA, canonical: dirA },
  });
  assert(usableProjectID("global") === undefined, "the global sentinel is not a project id");
  assert(redirected.source === "canonical", "the global sentinel falls back to the canonical path");
  assert(redirected.key === canonicalPathKey(dirA), "the canonical fallback key is the path hash");

  const noLocation = resolveProjectIdentity(undefined, dirA);
  assert(noLocation.source === "cwd", "a host without project data falls back to the working directory");
  assert(noLocation.key === canonicalPathKey(dirA), "the working-directory fallback key is the path hash");
  assert(
    resolveProjectIdentity(undefined, dirA).key === noLocation.key,
    "the working-directory fallback is stable across calls",
  );

  const linkPath = join(work, "linked-workspace");
  symlinkSync(dirA, linkPath);
  const linked = resolveProjectIdentity({ directory: linkPath });
  assert(linked.canonical === dirA, "a symlinked working directory resolves to the real path");
  assert(linked.key === noLocation.key, "a symlink and its target share one fallback key");

  assert(sanitizeProjectKey("Team/Repo").startsWith("h-"), "an unsafe id is hashed, never used raw");
  assert(sanitizeProjectKey("Team/Repo").length === 18, "the hashed key keeps a fixed length");
  assert(sanitizeProjectKey(ID_A.toUpperCase()) === ID_A.toLowerCase(), "a safe id is lowercased only");

  const dataRoot = resolve(work, "xdg-data", "tawassul-v2");
  const root = projectRootFor(identityA) as string;
  assert(root === join(dataRoot, "projects", identityA.key), "the project root lives under the namespaced data root");

  const first = await bootPlugin({ workspace: dirA, projectID: ID_A, canonical: dirA, worktreeRoot: dirA });
  assert(first.persistDir === root, "the boot resolves the shared project root from the host identity");
  assert(first.ctx.stateDir === dirA, "the workspace directory stays the working directory");
  assert(first.ctx.toolRunLog !== undefined, "the project root passes the worktree guard when it is the resolved root");
  assert(existsSync(join(root, "identity.json")), "the project root records its identity");
  const identityFile = JSON.parse(readFileSync(join(root, "identity.json"), "utf8")) as {
    key: string;
    source: string;
    projectID?: string;
  };
  assert(identityFile.key === identityA.key, "the identity file carries the resolved key");
  assert(identityFile.source === "project-id", "the identity file records the host id as the source");
  assert(identityFile.projectID === ID_A, "the identity file records the host project id");

  await writeRecord(first, dirA, "survival alpha");
  const projectStateFile = join(root, ".opencode", "tawassul-state.json");
  assert(existsSync(projectStateFile), "the ledger is written under the project root");
  assert(
    !existsSync(join(dirA, ".opencode", "tawassul-state.json")),
    "the workspace keeps no project-scope ledger",
  );
  const ledgerDigest = digest(projectStateFile);
  assert(recordTitles(first).includes("survival alpha"), "the first working directory sees its own record");
  await disposePlugin(first);

  const second = await bootPlugin({ workspace: dirB, projectID: ID_A, canonical: dirA });
  assert(second.persistDir === root, "a second working directory resolves the same project root");
  assert(second.identity?.key === identityA.key, "the second boot derives the same key");
  assert(recordTitles(second).includes("survival alpha"), "the second working directory reads the first ledger");
  assert(digest(projectStateFile) === ledgerDigest, "the second boot does not fork the ledger");
  assert(
    !existsSync(join(dirB, ".opencode", "tawassul-state.json")),
    "the second workspace keeps no project-scope ledger",
  );
  await disposePlugin(second);

  const other = await bootPlugin({ workspace: dirC, projectID: ID_B, canonical: dirC });
  assert(other.persistDir !== root, "a different project id resolves a different root");
  assert(!recordTitles(other).includes("survival alpha"), "a different project never reads another ledger");
  assert(
    !existsSync(join(other.persistDir ?? "", ".opencode", "tawassul-state.json")),
    "the unrelated project starts without the shared ledger",
  );
  await disposePlugin(other);

  const rootDigest = digest(projectStateFile);
  const rollback = await bootPlugin({ workspace: dirA, projectID: ID_A, canonical: dirA, stateRootMode: "legacy" });
  assert(rollback.persistDir === undefined, "rollback mode resolves no project root");
  assert(rollback.ctx.persistDir === dirA, "rollback mode keeps the workspace as the state root");
  assert(!recordTitles(rollback).includes("survival alpha"), "rollback mode reads the legacy workspace ledger");
  await writeRecord(rollback, dirA, "rollback record");
  assert(
    existsSync(join(dirA, ".opencode", "tawassul-state.json")),
    "rollback mode writes the legacy workspace ledger",
  );
  assert(digest(projectStateFile) === rootDigest, "rollback mode never touches the project root");
  await disposePlugin(rollback);

  process.env.TAWASSUL_WORKTREE_ROOT = dirA;
  assert(getWorktreeBlockReason(root) === "worktree", "an unlisted root outside the worktree is still blocked");
  assert(getWorktreeBlockReason(dirA) === null, "the worktree root itself stays inside the guard");
  assert(getWorktreeBlockReason(root, root) === null, "the resolved project root is an accepted worktree scope");
  assert(
    getWorktreeBlockReason(join(work, "stray")) === "worktree",
    "a stray directory stays blocked under an active worktree guard",
  );
  delete process.env.TAWASSUL_WORKTREE_ROOT;

  console.log(`INFO  project key ${identityA.key}, ledger ${projectStateFile}`);
  console.log(`PROOF PASS: two working directories share one project ledger and every fallback stays isolated (${passed} assertions)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
