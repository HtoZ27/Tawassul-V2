import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resetHmacKeyCache, unwrapWithHmac } from "../src/utils/crypto.ts";
import { projectRootFor, resolveProjectIdentity } from "../src/utils/project-identity.ts";
import { prepareProjectState } from "../src/utils/project-state-migration.ts";
import { StateManager } from "../src/context/managers/StateManager.ts";
import { hmacWriteFile } from "../src/services/persist-utils.ts";
import {
  bootPlugin,
  disposePlugin,
  prepareHarnessEnv,
  prepareWorkspace,
  readGoals,
  recordTitles,
  writeGoal,
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

function listFiles(base: string, name: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const full = join(base, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, name));
    else if (entry.name === name) out.push(full);
  }
  return out;
}

function newest(files: string[]): string | undefined {
  return files.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
}

const work = mkdtempSync(join(tmpdir(), "tawassul-state-root-rollback-"));
const ID = "ffeeddccbbaa99887766554433221100ffeeddcc";

try {
  prepareHarnessEnv(work, join(work, "hmac"));
  const workspace = resolve(work, "workspace");
  prepareWorkspace(workspace);
  const identity = resolveProjectIdentity({
    directory: workspace,
    project: { id: ID, directory: workspace, canonical: workspace },
  });
  const root = projectRootFor(identity) as string;
  const legacyFile = join(workspace, ".opencode", "tawassul-state.json");
  const projectFile = join(root, ".opencode", "tawassul-state.json");
  const legacyNotes = join(workspace, ".opencode", "legacy-notes.json");
  const projectNotes = join(root, ".opencode", "legacy-notes.json");
  const legacyGoals = join(workspace, "goals", "goals.jsonl");
  const projectGoals = join(root, "goals", "goals.jsonl");
  const legacyGoalsNotes = join(workspace, "goals", "legacy-notes.json");
  const projectGoalsNotes = join(root, "goals", "legacy-notes.json");
  writeFileSync(legacyNotes, JSON.stringify({ version: 1 }));
  mkdirSync(join(workspace, "goals"), { recursive: true });
  writeFileSync(legacyGoalsNotes, JSON.stringify({ version: 1 }));

  const seed = await bootPlugin({ workspace, projectID: ID, stateRootMode: "legacy" });
  await writeRecord(seed, workspace, "legacy origin");
  await writeGoal(seed, workspace, "legacy goal");
  await disposePlugin(seed);
  assert(existsSync(legacyFile), "the legacy boot writes the workspace ledger");
  assert(existsSync(legacyGoals), "the legacy boot writes the top-level goal ledger");
  const legacyGoalsDigest = digest(legacyGoals);
  const legacyDigest = digest(legacyFile);
  const legacySigned = readFileSync(legacyFile, "utf8");
  resetHmacKeyCache();
  assert(unwrapWithHmac(legacySigned) !== null, "the legacy ledger carries a verifiable signature");

  const directRoot = join(work, "direct-root");
  const direct = prepareProjectState({ workspaceDir: workspace, root: directRoot, identity });
  assert(direct.migrated.includes("tawassul-state.json"), "a direct migration copies the legacy ledger");
  assert(
    digest(join(directRoot, ".opencode", "tawassul-state.json")) === legacyDigest,
    "the migration copy is byte-identical to the legacy ledger",
  );
  const directBackup = newest(listFiles(join(directRoot, "backup"), "tawassul-state.json"));
  assert(directBackup !== undefined, "a direct migration copies the ledger into the backup");
  assert(digest(directBackup as string) === legacyDigest, "the direct backup keeps the legacy bytes");
  assert(
    direct.migrated.includes("state:goals/goals.jsonl"),
    "a direct migration copies the top-level goal ledger under a state key",
  );
  assert(
    direct.migrated.includes("state:goals/legacy-notes.json"),
    "a direct migration scans the whole top-level state directory",
  );
  assert(
    digest(join(directRoot, "goals", "goals.jsonl")) === legacyGoalsDigest,
    "the top-level goal copy is byte-identical to the legacy ledger",
  );
  const directGoalsBackup = newest(listFiles(join(directRoot, "backup"), "goals.jsonl"));
  assert(
    (directGoalsBackup ?? "").includes("/state/goals/"),
    "the top-level backup keeps the state layout",
  );
  assert(digest(directGoalsBackup as string) === legacyGoalsDigest, "the top-level backup keeps the legacy bytes");
  const repeated = prepareProjectState({ workspaceDir: workspace, root: directRoot, identity });
  assert(repeated.migrated.length === 0, "a repeated migration copies nothing twice");
  assert(repeated.skipped > 0, "a repeated migration recognises the copied ledger");
  assert(
    digest(join(directRoot, ".opencode", "tawassul-state.json")) === legacyDigest,
    "a repeated migration never rewrites the project copy",
  );

  const migrated = await bootPlugin({ workspace, projectID: ID });
  assert(migrated.persistDir === root, "the host boot resolves the project root");
  assert(recordTitles(migrated).includes("legacy origin"), "the migrated ledger keeps the legacy record");
  assert(
    (await readGoals(migrated, workspace)).includes("legacy goal"),
    "the migrated top-level goal ledger loads in project scope",
  );
  await writeGoal(migrated, workspace, "project goal");
  await disposePlugin(migrated);
  assert(existsSync(projectFile), "the host boot copies the ledger into the project root");
  assert(existsSync(projectNotes), "the host boot copies every legacy artifact, not only the ledger");
  assert(readFileSync(projectNotes, "utf8") === JSON.stringify({ version: 1 }), "the migrated artifact is byte-identical");
  assert(digest(legacyFile) === legacyDigest, "migration never rewrites the legacy ledger");
  assert(existsSync(projectGoals), "the host boot copies the top-level goal ledger into the project root");
  assert(digest(legacyGoals) === legacyGoalsDigest, "migration never rewrites the legacy goal ledger");
  const projectGoalsDigest = digest(projectGoals);
  resetHmacKeyCache();
  assert(unwrapWithHmac(readFileSync(projectFile, "utf8")) !== null, "the migrated ledger keeps a valid signature");

  const manifestFile = newest(listFiles(join(root, "backup"), "manifest.json"));
  assert(manifestFile !== undefined, "the migration writes a backup manifest");
  const manifest = JSON.parse(readFileSync(manifestFile as string, "utf8")) as {
    version: number;
    digest: string;
    files: Array<{ path: string; bytes: number; mode: number; sha256: string }>;
  };
  assert(manifest.version === 1, "the backup manifest uses schema version 1");
  const stateEntry = manifest.files.find((file) => file.path === "tawassul-state.json");
  assert(stateEntry !== undefined, "the backup manifest lists the migrated ledger");
  assert(stateEntry?.sha256 === legacyDigest, "the backup manifest records the legacy digest");
  const backupCopy = join(manifestFile as string, "..", ".opencode", "tawassul-state.json");
  assert(digest(backupCopy) === legacyDigest, "the backup copy matches the legacy bytes");
  const goalManifestEntry = manifest.files.find((file) => file.path === "state:goals/goals.jsonl");
  assert(goalManifestEntry?.sha256 === legacyGoalsDigest, "the backup manifest records the top-level goal digest");
  const goalBackupCopy = join(manifestFile as string, "..", "state", "goals", "goals.jsonl");
  assert(digest(goalBackupCopy) === legacyGoalsDigest, "the top-level backup copy matches the legacy bytes");
  const expectedDigest = createHash("sha256")
    .update(manifest.files.map((file) => `${file.path}:${file.sha256}`).join("\n"))
    .digest("hex");
  assert(manifest.digest === expectedDigest, "the manifest union digest matches its file list");

  const journalFile = join(root, "migration.jsonl");
  const journal = readFileSync(journalFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { action: string });
  assert(journal.some((line) => line.action === "backup"), "the journal records the pre-migration backup");
  assert(journal.some((line) => line.action === "migrate"), "the journal records the migration copy");
  assert(
    journal.some((line) => line.action === "migrate" && (line as { path?: string }).path === "state:goals/goals.jsonl"),
    "the journal records the top-level goal migration",
  );

  const projectDigest = digest(projectFile);
  const rolledBack = await bootPlugin({ workspace, projectID: ID, stateRootMode: "legacy" });
  assert(rolledBack.ctx.persistDir === workspace, "rollback reads the workspace ledger again");
  assert(recordTitles(rolledBack).includes("legacy origin"), "rollback sees the original record");
  await disposePlugin(rolledBack);
  assert(digest(projectFile) === projectDigest, "rollback leaves the project root untouched");
  assert(digest(projectGoals) === projectGoalsDigest, "rollback leaves the project goal ledger untouched");

  const legacyGrowth = await bootPlugin({ workspace, projectID: ID, stateRootMode: "legacy" });
  await writeRecord(legacyGrowth, workspace, "legacy second");
  await disposePlugin(legacyGrowth);
  const grownDigest = digest(legacyFile);
  assert(grownDigest !== legacyDigest, "a mid-window legacy write changes the legacy ledger");
  writeFileSync(legacyNotes, JSON.stringify({ version: 2 }));
  const grownNotesDigest = digest(legacyNotes);
  writeFileSync(legacyGoalsNotes, JSON.stringify({ version: 2 }));
  const grownGoalsNotesDigest = digest(legacyGoalsNotes);

  const refreshed = await bootPlugin({ workspace, projectID: ID });
  const refreshedTitles = recordTitles(refreshed);
  assert(refreshedTitles.includes("legacy origin"), "the mid-window boot keeps the original record");
  assert(!refreshedTitles.includes("legacy second"), "a changed project ledger is never replaced by the legacy ledger");
  await disposePlugin(refreshed);
  assert(digest(legacyFile) === grownDigest, "the conflict path never rewrites the legacy ledger");
  assert(digest(projectNotes) === grownNotesDigest, "an untouched project copy refreshes from the legacy change");
  assert(readFileSync(projectNotes, "utf8") === JSON.stringify({ version: 2 }), "the refresh writes the newest bytes");
  assert(
    digest(projectGoalsNotes) === grownGoalsNotesDigest,
    "an untouched top-level store refreshes from the legacy change",
  );
  assert(
    readFileSync(projectGoalsNotes, "utf8") === JSON.stringify({ version: 2 }),
    "the top-level refresh writes the newest bytes",
  );
  const refreshJournal = readFileSync(journalFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { action: string; path?: string; winner?: string });
  assert(
    refreshJournal.some((line) => line.action === "refresh" && line.path === "legacy-notes.json"),
    "the journal records the mid-window refresh",
  );
  assert(
    refreshJournal.some((line) => line.action === "refresh" && line.path === "state:goals/legacy-notes.json"),
    "the journal records the top-level refresh",
  );
  assert(
    refreshJournal.some(
      (line) => line.action === "conflict" && line.path === "tawassul-state.json" && line.winner === "project",
    ),
    "the journal records the ledger conflict with the project as winner",
  );
  const ledgerConflictCopy = newest(listFiles(join(root, "backup", "conflicts"), "tawassul-state.json"));
  assert(ledgerConflictCopy !== undefined, "the ledger conflict preserves the legacy copy");
  assert(digest(ledgerConflictCopy as string) === grownDigest, "the ledger conflict copy keeps the legacy bytes");
  assert(digest(projectFile) !== grownDigest, "the project ledger never adopts the conflicting legacy bytes");

  const projectGrowth = await bootPlugin({ workspace, projectID: ID });
  await writeRecord(projectGrowth, workspace, "project third");
  await writeGoal(projectGrowth, workspace, "project third goal");
  await disposePlugin(projectGrowth);

  const legacyConflict = await bootPlugin({ workspace, projectID: ID, stateRootMode: "legacy" });
  await writeRecord(legacyConflict, workspace, "legacy third");
  await writeGoal(legacyConflict, workspace, "legacy third goal");
  await disposePlugin(legacyConflict);
  const conflictLegacyDigest = digest(legacyFile);
  const conflictLegacyGoalsDigest = digest(legacyGoals);

  const journalBefore = readFileSync(journalFile, "utf8").trim().split("\n").length;
  const conflicted = await bootPlugin({ workspace, projectID: ID });
  const conflictedTitles = recordTitles(conflicted);
  const conflictedGoals = await readGoals(conflicted, workspace);
  assert(conflictedTitles.includes("project third"), "the project copy wins a two-sided change");
  assert(!conflictedTitles.includes("legacy third"), "the losing legacy write never enters the project ledger");
  assert(conflictedGoals.includes("project third goal"), "the project goal ledger wins a two-sided change");
  assert(!conflictedGoals.includes("legacy third goal"), "the losing legacy goal never enters the project ledger");
  await disposePlugin(conflicted);
  assert(digest(projectFile) !== conflictLegacyDigest, "a conflict never rewrites the project ledger");
  assert(digest(projectGoals) !== conflictLegacyGoalsDigest, "a goal conflict never rewrites the project ledger");
  const conflictCopy = newest(listFiles(join(root, "backup", "conflicts"), "tawassul-state.json"));
  assert(conflictCopy !== undefined, "the conflict preserves the losing legacy copy");
  assert(digest(conflictCopy as string) === conflictLegacyDigest, "the conflict copy keeps the legacy bytes");
  const conflictJournal = readFileSync(journalFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { action: string; path?: string; winner?: string });
  assert(
    conflictJournal.some(
      (line) => line.action === "conflict" && line.path === "tawassul-state.json" && line.winner === "project",
    ),
    "the journal records the conflict",
  );
  const goalConflictCopy = newest(listFiles(join(root, "backup", "conflicts"), "goals.jsonl"));
  assert(goalConflictCopy !== undefined, "the goal conflict preserves the legacy copy");
  assert((goalConflictCopy ?? "").includes("/state/goals/"), "the goal conflict keeps the state layout");
  assert(digest(goalConflictCopy as string) === conflictLegacyGoalsDigest, "the goal conflict copy keeps the legacy bytes");
  assert(
    conflictJournal.some(
      (line) => line.action === "conflict" && line.path === "state:goals/goals.jsonl" && line.winner === "project",
    ),
    "the journal records the goal conflict with the project as winner",
  );
  assert(conflictJournal.length > journalBefore, "the conflict boot appends a journal line");
  const journalAfterConflict = conflictJournal.length;

  const transientBackup = join(workspace, "timeline", "timeline-meta.json.bak.1794018472517.da5ca9d7610f");
  const transientTemp = join(workspace, "timeline", "timeline-meta.json.4242-0011223344ff.tmp");
  const transientOrphan = join(workspace, "timeline", "timeline-meta.json.bak.orphan-1794018472517");
  mkdirSync(join(workspace, "timeline"), { recursive: true });
  writeFileSync(transientBackup, "{\"transient\":true}\n");
  writeFileSync(transientTemp, "transient\n");
  writeFileSync(transientOrphan, "transient\n");

  const settled = await bootPlugin({ workspace, projectID: ID });
  const settledTitles = recordTitles(settled);
  const settledGoals = await readGoals(settled, workspace);
  assert(settledTitles.includes("legacy origin"), "a settled boot keeps the project ledger history");
  assert(settledTitles.includes("project third"), "a settled boot keeps the post-migration record");
  assert(!settledTitles.includes("legacy third"), "a settled boot never resurrects the archived legacy write");
  assert(settledGoals.includes("project third goal"), "a settled boot keeps the project goal");
  assert(!settledGoals.includes("legacy third goal"), "a settled boot never resurrects the archived legacy goal");
  await disposePlugin(settled);
  const settledJournalLength = readFileSync(journalFile, "utf8").trim().split("\n").length;
  assert(settledJournalLength === journalAfterConflict, "a settled conflict appends nothing on the next boot");
  assert(existsSync(transientBackup), "the settled boot leaves the atomic backup in place");
  assert(existsSync(transientTemp), "the settled boot leaves the atomic temp file in place");
  assert(existsSync(transientOrphan), "the settled boot leaves the orphan backup in place");
  assert(
    !existsSync(join(root, "timeline", "timeline-meta.json.bak.1794018472517.da5ca9d7610f")),
    "a transient backup is never migrated",
  );
  assert(
    !existsSync(join(root, "timeline", "timeline-meta.json.4242-0011223344ff.tmp")),
    "a transient temp file is never migrated",
  );
  assert(
    !existsSync(join(root, "timeline", "timeline-meta.json.bak.orphan-1794018472517")),
    "an orphan backup is never migrated",
  );

  const schemaDir = join(work, "schema-roundtrip");
  mkdirSync(schemaDir, { recursive: true });
  const schemaPath = join(schemaDir, "tawassul-state.json");
  const schemaManager = new StateManager(schemaDir, () => schemaPath);
  const schemaStamp = new Date().toISOString();
  const a0Fields = {
    implementer: { providerID: "opencode", modelID: "big-pickle" },
    reviewer: { providerID: "google", modelID: "gemini-flash-lite-latest" },
    sessionId: "ses-schema-roundtrip",
    turn: 41,
    acceptanceCriteria: ["first criterion", "second criterion"],
    acknowledgedBy: "@tester",
    acknowledgedAt: schemaStamp,
    senderErrorCleared: true,
    sourceDiscussionId: "D-900",
    reroutedModel: "opencode/big-pickle",
    credentialScope: "isolated",
  };
  const handoffSeed = {
    id: "H-900",
    from: "@dev",
    to: "@tester",
    task: "schema round trip",
    context: "round trip context",
    files: ["src/validation.ts"],
    timestamp: schemaStamp,
    status: "pending",
    ...a0Fields,
  };
  const recordSeed = {
    id: "R-900",
    type: "decision",
    timestamp: schemaStamp,
    agent: "@dev",
    title: "schema round trip",
    detail: "keep every field",
    provenance: "tool_observed",
    decision_kind: "decision",
  };
  const firstPass = schemaManager.validateStateData({ version: 1, records: [recordSeed], handoffs: [handoffSeed] });
  if (!firstPass.valid) fail(`the seeded state was rejected: ${firstPass.errors.join("; ")}`);
  assert(firstPass.valid, "the seeded state passes validation");
  const firstHandoff = (firstPass.sanitized.handoffs as Record<string, unknown>[])[0] ?? {};
  const firstRecord = (firstPass.sanitized.records as Record<string, unknown>[])[0] ?? {};
  for (const [field, value] of Object.entries(a0Fields)) {
    assert(
      JSON.stringify(firstHandoff[field]) === JSON.stringify(value),
      `A0 keeps ${field} through validation`,
    );
  }
  assert(firstRecord.provenance === "tool_observed", "A0b keeps provenance through validation");
  assert(firstRecord.decision_kind === "decision", "A0b keeps decision_kind through validation");
  await hmacWriteFile(schemaPath, firstPass.sanitized);
  const reloaded = await schemaManager.tryLoadFile(schemaPath);
  if (!reloaded) fail("the signed round-trip file did not load");
  assert(reloaded !== null, "the signed round-trip file loads");
  const reloadedHandoff = (reloaded.handoffs as Record<string, unknown>[])[0] ?? {};
  const reloadedRecord = (reloaded.records as Record<string, unknown>[])[0] ?? {};
  for (const [field, value] of Object.entries(a0Fields)) {
    assert(
      JSON.stringify(reloadedHandoff[field]) === JSON.stringify(value),
      `A0 keeps ${field} after write and reload`,
    );
  }
  assert(reloadedRecord.provenance === "tool_observed", "A0b keeps provenance after write and reload");
  assert(reloadedRecord.decision_kind === "decision", "A0b keeps decision_kind after write and reload");
  const secondPass = schemaManager.validateStateData(reloaded);
  if (!secondPass.valid) fail(`the reloaded state was rejected: ${secondPass.errors.join("; ")}`);
  assert(secondPass.valid, "the reloaded state re-validates");
  const secondHandoff = (secondPass.sanitized.handoffs as Record<string, unknown>[])[0] ?? {};
  assert(JSON.stringify(secondHandoff) === JSON.stringify(reloadedHandoff), "the reloaded handoff is a field fixpoint");

  const hostileHandoff = {
    id: "H-901",
    from: "@dev",
    to: "@tester",
    task: "hostile fixture",
    context: "hostile context",
    files: [],
    timestamp: schemaStamp,
    status: "pending",
    implementer: 42,
    reviewer: null,
    sessionId: null,
    turn: "3",
    acceptanceCriteria: [null],
    acknowledgedBy: 42,
    acknowledgedAt: null,
    senderErrorCleared: "yes",
    sourceDiscussionId: null,
    reroutedModel: 42,
    credentialScope: "bogus",
  };
  const hostileRecord = {
    id: "R-901",
    type: "decision",
    timestamp: schemaStamp,
    agent: "@dev",
    title: "hostile record",
    detail: "hostile detail",
    provenance: 42,
    decision_kind: null,
  };
  const hostile = schemaManager.validateStateData({ version: 1, records: [hostileRecord], handoffs: [hostileHandoff] });
  if (!hostile.valid) fail(`the hostile fixture was rejected: ${hostile.errors.join("; ")}`);
  assert(hostile.valid, "the hostile fixture still parses as a handoff");
  const hostileParsed = (hostile.sanitized.handoffs as Record<string, unknown>[])[0] ?? {};
  const hostileRecordParsed = (hostile.sanitized.records as Record<string, unknown>[])[0] ?? {};
  for (const field of [
    "implementer",
    "reviewer",
    "sessionId",
    "turn",
    "acceptanceCriteria",
    "acknowledgedBy",
    "acknowledgedAt",
    "senderErrorCleared",
    "sourceDiscussionId",
    "reroutedModel",
  ]) {
    assert(hostileParsed[field] === undefined, `hostile ${field} falls back to undefined`);
  }
  assert(hostileParsed.credentialScope === "bogus", "hostile credentialScope survives as a string");
  assert(hostileRecordParsed.provenance === undefined, "hostile provenance falls back to undefined");
  assert(hostileRecordParsed.decision_kind === undefined, "hostile decision_kind falls back to undefined");
  assert(hostileParsed.id === "H-901", "the hostile fixture keeps the required handoff fields");

  console.log(`INFO  project root ${root}, backup ${manifestFile}`);
  console.log(`PROOF PASS: the migration keeps signatures, backs up first, refreshes untouched artifacts, archives conflicts and rolls back cleanly (${passed} assertions)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
