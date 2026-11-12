import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { resolveSafePath } from "../utils/path.ts";
import { logger } from "../utils/logger.ts";
import { releaseFSLock } from "../infra/file-lock.ts";
import {
  stripJsoncComments,
  spliceAgentSection,
  readTawassulRoster,
  writeTawassulRoster,
  readJsoncObject,
  opencodeConfigLockName,
  acquireOpencodeConfigLock,
} from "../utils/opencode-config.ts";
import { detectInstallScope } from "../core/install-scope.ts";
import { levenshtein } from "../core/nlp.ts";
import {
  globalConfigDir,
  isInsideGlobalConfigDir,
  isTawassulGlobalSpace,
  resolveTawassulConfigPath,
  resolveActiveConfigPath,
  resolveAgentsDir,
  resolvePinsPath,
  type InstallScope,
} from "../utils/path-resolver.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { resolveRole } from "../utils/agent.ts";
import { atomicWriteFile } from "../utils/atomic.ts";
import type { TawassulContext } from "../context.ts";
import type { ToolDefinition, ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { ASK_UNAVAILABLE } from "../services/ask-channel.ts";
import { ALL_AGENTS } from "../agent-templates.ts";
import { defaultAgentModelForRole, getDynamicFallbackChainForRole } from "../services/proxy-fallback-chains.ts";
import { isGeneratedVariant, RETIRED_MODEL_IDS, generatedVariantNames } from "../core/variant-names.ts";
import { setDynamicDeletedAgents, pruneUserPreservedAgents } from "../security-policy.ts";
import { resolveModelAlias, MODEL_ALIASES } from "../services/proxy-models.ts";
import { MODEL_ID_TO_SUFFIX, shouldWarnUnverifiedModel, modelAvailability } from "../core/model-registry.ts";
import { MAX_DYNAMIC_AGENTS_DEFAULT } from "../context/constants.ts";
import { t } from "../translations.ts";
import {
  BASE_ROLE_NAMES,
  SPECIALIZATIONS,
  examplesText,
  isVariantName,
  parseCompoundSpec,
  agentConfigFor,
  parseAddInput,
  validateAddInput,
} from "./agent-add-helpers.ts";
import {
  parseKickInput,
  isProtected,
  classifyRemove,
  kickExamplesText,
  kickHelpText,
  type KickResult,
} from "./agent-kick-helpers.ts";
import { dropAgentState, removeAgentMd, removeAgentsFromConfig, formatKickResult } from "./agent-kick-runtime.ts";
import { BASH_READ_ONLY } from "../permissions.ts";

export function tawaFallbackPermission(): Record<string, unknown> {
  return {
    task: { "*": "allow", "*tawa*": "deny" },
    handoff: { "*": "allow", "*tawa*": "deny" },
    bash: JSON.parse(JSON.stringify(BASH_READ_ONLY)) as Record<string, string>,
  };
}

export function configLockName(ctx: TawassulContext): string {
  const anchor = SCOPE === "global" ? resolveTawassulConfigPath(ctx.stateDir, "global") : resolve(ctx.stateDir);
  return opencodeConfigLockName(anchor);
}

const configWriteChains = new Map<string, Promise<unknown>>();
function withConfigWriteLock<T>(
  ctx: TawassulContext,
  fn: () => Promise<T>,
  opts?: { failClosed?: boolean },
): Promise<T> {
  const executeWithFsLock = async (): Promise<T> => {
    if (SCOPE === "project" && isInsideGlobalConfigDir(resolve(ctx.stateDir))) {
      throw new Error("refusing to write a project config inside the global config dir");
    }
    const anchor = SCOPE === "global" ? resolveTawassulConfigPath(ctx.stateDir, "global") : resolve(ctx.stateDir);
    const { acquired, lockName, owner } = await acquireOpencodeConfigLock(anchor);
    if (!acquired) {
      const msg = `configWriteLock: FS lock not acquired for ${lockName} after retries`;
      if (opts?.failClosed) {
        throw new Error(`${msg} — refusing unlocked write (a concurrent writer may be active)`);
      }
      logger.warn(`${msg}, proceeding with in-process chain only`);
    }
    try {
      return await fn();
    } finally {
      if (acquired) {
        try {
          await releaseFSLock(lockName, owner);
        } catch (e) {
          logger.warn(`configWriteLock: failed to release FS lock ${lockName}:`, e);
        }
      }
    }
  };
  const key = resolve(ctx.stateDir);
  const chain = configWriteChains.get(key) ?? Promise.resolve();
  const run = chain.then(executeWithFsLock, executeWithFsLock);
  configWriteChains.set(
    key,
    run.catch((e) => {
      logger.error(`[tawassul] config write failed for ${key} (chain continues):`, e);
      return undefined;
    }),
  );
  return run;
}

function warnScopeMismatch(ctx: TawassulContext): void {
  const injected = (ctx as unknown as { scope?: InstallScope }).scope;
  if (injected && injected !== SCOPE) {
    logger.warn(
      `agent-management: ctx.scope "${injected}" differs from module SCOPE "${SCOPE}" — module-scope paths take precedence`,
    );
  }
}

export const SCOPE: InstallScope = detectInstallScope(import.meta.url);

const mdBackupBeforeAdd = new Map<string, { existed: boolean; content: string | null }>();

function mdBackupKey(stateDir: string, tag: string): string {
  return `${resolve(stateDir)}::${tag}`;
}

const tawaModelBackup = new Map<string, string | undefined>();

async function readDeletedAgentNames(ctx: TawassulContext): Promise<Set<string>> {
  if (SCOPE === "global") {
    const rosterPath = resolveTawassulConfigPath(ctx.stateDir, "global");
    try {
      const { roster } = readTawassulRoster(rosterPath);
      return new Set(roster.deleted.map((s) => normalizeName(String(s))));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Set();
      throw new Error(`deleted-agents: failed to read roster at ${rosterPath}: ${(e as Error).message}`, { cause: e });
    }
  }
  const configPath = resolveActiveConfigPath(ctx.stateDir, "project");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw e;
  }
  const parsed = readJsoncObject(raw);
  const agents = parsed.agent;
  if (agents === undefined || agents === null) return new Set();
  if (typeof agents !== "object" || Array.isArray(agents)) return new Set();
  const keys = Object.keys(agents as Record<string, unknown>);
  if (keys.length === 0) return new Set();
  const present = new Set(keys.map((s) => normalizeName(String(s))));
  return new Set(
    generatedVariantNames(SPECIALIZATIONS).filter((name) => !present.has(normalizeName(name))),
  );
}

async function writeDeletedAgentNames(ctx: TawassulContext, names: Set<string>): Promise<void> {
  if (SCOPE === "global") {
    const rosterPath = resolveTawassulConfigPath(ctx.stateDir, "global");
    const { roster } = readTawassulRoster(rosterPath);
    const list = [...names].sort();
    await writeTawassulRoster(rosterPath, { agents: roster.agents, deleted: list });
    setDynamicDeletedAgents(list.map((s) => normalizeName(String(s))));
    pruneUserPreservedAgents(list.map((s) => normalizeName(String(s))));
    return;
  }
  const list = [...names].sort();
  setDynamicDeletedAgents(list.map((s) => normalizeName(String(s))));
  pruneUserPreservedAgents(list.map((s) => normalizeName(String(s))));
}

async function persistDeletedAgents(ctx: TawassulContext, specs: readonly string[]): Promise<void> {
  const names = await readDeletedAgentNames(ctx);
  for (const spec of specs) names.add(normalizeName(spec));
  await writeDeletedAgentNames(ctx, names);
}

async function unpersistDeletedAgents(ctx: TawassulContext, specs: readonly string[]): Promise<void> {
  const names = await readDeletedAgentNames(ctx);
  let changed = false;
  for (const spec of specs) {
    if (names.delete(normalizeName(spec))) changed = true;
  }
  if (changed || SCOPE === "project") await writeDeletedAgentNames(ctx, names);
}

function pinsPath(ctx: TawassulContext): string {
  return resolvePinsPath(ctx.stateDir, SCOPE);
}

async function loadPinnedAgents(ctx: TawassulContext): Promise<Set<string>> {
  const path = pinsPath(ctx);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw new Error(`tawassul-pins: failed to read ${path}: ${(e as Error).message}`, { cause: e });
  }
  try {
    const obj = JSON.parse(raw) as { pinned?: unknown };
    if (!obj || !Array.isArray(obj.pinned)) return new Set();
    return new Set((obj.pinned as unknown[]).map((s) => normalizeName(String(s))));
  } catch (e) {
    throw new Error(`tawassul-pins: ${path} is malformed: ${(e as Error).message}`, { cause: e });
  }
}

export function computePinEntries(
  specs: readonly string[],
  errorTags: ReadonlySet<string>,
  fullModel: string,
): Array<{ name: string; pinned: boolean }> {
  return specs
    .map((s) => normalizeName(s))
    .filter((n) => !errorTags.has(`@${n}`))
    .filter((n) => BASE_ROLE_NAMES.has(n) || parseCompoundSpec(n) !== null)
    .map((n) => ({
      name: n,
      pinned: parseCompoundSpec(n) !== null ? true : fullModel !== defaultAgentModelForRole(n),
    }));
}

async function writeBaseRolePins(
  ctx: TawassulContext,
  entries: ReadonlyArray<{ name: string; pinned: boolean }>,
): Promise<void> {
  const pins = await loadPinnedAgents(ctx);
  let changed = false;
  for (const { name, pinned } of entries) {
    const key = normalizeName(name);
    if (pinned && !pins.has(key)) {
      pins.add(key);
      changed = true;
    } else if (!pinned && pins.has(key)) {
      pins.delete(key);
      changed = true;
    }
  }
  if (!changed) return;

  const path = pinsPath(ctx);
  if (SCOPE !== "global") {
    try {
      mkdirSync(resolve(ctx.stateDir, ".opencode"), { recursive: true });
    } catch (e) {
      logger.warn("agent-management: failed to ensure .opencode dir for pins:", e);
    }
  }
  await atomicWriteFile(path, JSON.stringify({ pinned: [...pins].sort() }, null, 2) + "\n");
}

async function removeBaseRolePins(ctx: TawassulContext, names: readonly string[]): Promise<void> {
  const candidates = names
    .map((n) => normalizeName(n))
    .filter((n) => BASE_ROLE_NAMES.has(n) || parseCompoundSpec(n) !== null);
  if (candidates.length === 0) return;
  const path = pinsPath(ctx);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    logger.warn("kick: failed to read pins sidecar — leaving it untouched:", e);
    return;
  }
  try {
    const obj = JSON.parse(raw) as { pinned?: unknown };
    if (!obj || !Array.isArray(obj.pinned)) return;
    const keep = (obj.pinned as unknown[]).filter((s) => !candidates.includes(normalizeName(String(s))));
    if (keep.length === obj.pinned.length) return;
    await atomicWriteFile(path, JSON.stringify({ pinned: keep.map(String).sort() }, null, 2) + "\n");
  } catch (e) {
    logger.warn(`kick: tawassul-pins.json malformed — not modified (${(e as Error).message})`);
  }
}

function getMaxDynamicAgents(ctx: TawassulContext): number {
  return ctx.config.maxDynamicAgents ?? MAX_DYNAMIC_AGENTS_DEFAULT;
}

type AddResult = {
  added: string[];
  skipped: string[];
  errors: string[];
  quiet?: string[];
  updated?: { tag: string; prev: string; curr: string }[];
  warnings?: string[];
};

async function addSingleAgent(ctx: TawassulContext, spec: string, fullModel: string): Promise<string | null> {
  const tag = normalizeName(spec);
  if (tag === "tawa") {
    const backupKey = mdBackupKey(ctx.stateDir, tag);
    if (!tawaModelBackup.has(backupKey)) {
      tawaModelBackup.set(backupKey, ctx.agentModelMap[tag] as string | undefined);
      while (tawaModelBackup.size > 256) {
        const k = tawaModelBackup.keys().next().value;
        if (!k) break;
        tawaModelBackup.delete(k);
      }
    }
    ctx.agentModelMap[tag] = fullModel;
    return null;
  }
  if (ctx.dynamicAgents.length >= getMaxDynamicAgents(ctx)) {
    return "limit";
  }
  if ((BASE_ROLE_NAMES as ReadonlySet<string>).has(tag)) {
    logger.warn(`addSingleAgent: bare base "${tag}" reached the write path without derivation — refusing`);
    return "error";
  }
  const already = ctx.dynamicAgents.includes(tag);
  if (already && ctx.agentModelMap[normalizeName(tag)] === fullModel) {
    return "skip-quiet";
  }
  const compound = parseCompoundSpec(spec);
  const templateName = compound ? compound.base : spec;
  const template = ALL_AGENTS.find((a) => a.name === templateName && a.name !== "tawa");
  if (!template) return "error";
  const permissions = template.permissions;
  const mdPath = resolve(resolveAgentsDir(ctx.stateDir, SCOPE), `${tag}.md`);
  const backupKey = mdBackupKey(ctx.stateDir, tag);
  try {
    if (!mdBackupBeforeAdd.has(backupKey)) {
      if (existsSync(mdPath)) {
        let content: string | null = null;
        try {
          content = readFileSync(mdPath, "utf-8");
        } catch {
          void 0;
        }
        mdBackupBeforeAdd.set(backupKey, { existed: true, content });
      } else {
        mdBackupBeforeAdd.set(backupKey, { existed: false, content: null });
      }
    }
    while (mdBackupBeforeAdd.size > 256) {
      const oldest = mdBackupBeforeAdd.keys().next().value;
      if (oldest === undefined) break;
      mdBackupBeforeAdd.delete(oldest);
    }
  } catch {
    void 0;
  }
  const skipVariantMd = SCOPE !== "global" && isGeneratedVariant(tag, SPECIALIZATIONS);
  try {
    if (!skipVariantMd) {
      await ctx.agentManager.writeAgentMd(
        tag,
        template.role,
        template.responsibilities,
        template.capability,
        template.description,
        permissions,
        fullModel,
      );
    } else {
      logger.debug(`addSingleAgent: skipping .md for generated variant ${tag} (config-only surface)`);
    }
  } catch (e) {
    logger.warn(`addSingleAgent: writeAgentMd failed for ${tag}:`, e);
    mdBackupBeforeAdd.delete(backupKey);
    return "error";
  }
  if (!(BASE_ROLE_NAMES as ReadonlySet<string>).has(tag) && !ctx.dynamicAgents.includes(tag)) {
    ctx.dynamicAgents.push(tag);
  }
  ctx.agentModelMap[normalizeName(tag)] = fullModel;
  return already ? "updated" : null;
}

function rollbackAdd(ctx: TawassulContext, specs: string[]): void {
  for (const spec of specs) {
    const tag = normalizeName(spec);
    if (tag === "tawa") {
      const backupKey = mdBackupKey(ctx.stateDir, tag);
      const prev = tawaModelBackup.get(backupKey);
      if (prev === undefined) {
        delete ctx.agentModelMap[tag];
      } else {
        ctx.agentModelMap[tag] = prev;
      }
      tawaModelBackup.delete(backupKey);
      continue;
    }
    const idx = ctx.dynamicAgents.indexOf(tag);
    if (idx >= 0) ctx.dynamicAgents.splice(idx, 1);
    delete ctx.agentModelMap[normalizeName(tag)];
    const mdPath = resolve(resolveAgentsDir(ctx.stateDir, SCOPE), `${tag}.md`);
    const backupKey = mdBackupKey(ctx.stateDir, tag);
    const backup = mdBackupBeforeAdd.get(backupKey);
    try {
      if (backup) {
        if (backup.existed) {
          if (backup.content !== null) {
            try {
              writeFileSync(mdPath, backup.content, "utf-8");
            } catch (e) {
              logger.warn(`addagent: failed to restore .md for ${spec}:`, e);
            }
          } else {
            logger.warn(`addagent: pre-existing .md for ${spec} had unreadable content — keeping new file`);
          }
        } else {
          if (existsSync(mdPath)) unlinkSync(mdPath);
        }
      } else {
        if (existsSync(mdPath)) unlinkSync(mdPath);
      }
    } catch (e) {
      logger.warn(`addagent: failed to roll back orphan .md for ${spec}:`, e);
    } finally {
      mdBackupBeforeAdd.delete(backupKey);
    }
  }
}

function clearMdBackup(ctx: TawassulContext, specs: string[]): void {
  for (const spec of specs) {
    mdBackupBeforeAdd.delete(mdBackupKey(ctx.stateDir, normalizeName(spec)));
    tawaModelBackup.delete(mdBackupKey(ctx.stateDir, normalizeName(spec)));
  }
}

export function globalSpaceGuard(ctx: TawassulContext): string | null {
  if (SCOPE !== "global") return null;
  const rosterPath = resolveTawassulConfigPath(ctx.stateDir, "global");
  if (isTawassulGlobalSpace(rosterPath)) return null;
  return (
    `${globalConfigDir()} is not a tawassul global space — missing the native agent marker ` +
    `${resolve(globalConfigDir(), "agent", "tawa.md")} and no existing roster at ${rosterPath}; ` +
    `refusing to write (a wrong write could damage the OS user's config)`
  );
}

async function executeAddAll(ctx: TawassulContext, specs: string[], fullModel: string): Promise<AddResult> {
  const result: AddResult = { added: [], skipped: [], errors: [], quiet: [], updated: [] };
  for (const spec of specs) {
    const tag = `@${spec}`;
    const prev = ctx.agentModelMap[normalizeName(spec)];
    const err = await addSingleAgent(ctx, spec, fullModel);
    if (err === "skip-quiet") {
      result.skipped.push(tag);
      result.quiet!.push(tag);
    } else if (err === "updated") {
      result.updated!.push({ tag, prev: prev ?? "?", curr: fullModel });
    } else if (err === "limit") {
      result.errors.push(t("addagentLimitReached", { limit: String(getMaxDynamicAgents(ctx)) }));
      break;
    } else if (err === "error") {
      result.errors.push(tag);
    } else {
      result.added.push(tag);
    }
  }
  return result;
}

export function formatAddResult(result: AddResult): string {
  const lines: string[] = [];
  if (result.added.length > 0) {
    lines.push(t("addagentAdded", { count: String(result.added.length) }));
    for (const tag of result.added) {
      lines.push(`   ${tag}`);
    }
    lines.push(t("addagentAvailabilityHint"));
    logger.warn(
      `addagent: ${result.added.join(", ")} pendingRegistration until config reload — ` +
        `no plugin API to refresh opencode's subagent registry mid-session; routing is live now`,
    );
  }
  for (const w of result.warnings ?? []) {
    lines.push(`⚠️ ${w}`);
  }
  if (result.errors.length > 0) {
    lines.push(t("addagentErrors", { list: result.errors.join(", ") }));
  }
  if ((result.updated ?? []).length > 0) {
    lines.push(t("addagentVariantUpdated", { count: String(result.updated!.length) }));
    for (const u of result.updated!) {
      lines.push(`   ${u.tag}: ${u.prev} → ${u.curr}`);
    }
  }
  if (
    result.added.length === 0 &&
    result.skipped.length > 0 &&
    result.errors.length === 0 &&
    (result.updated ?? []).length === 0
  ) {
    const warnLines = (result.warnings ?? []).map((w) => `⚠️ ${w}`);
    return [t("addagentAllSkipped", { list: result.skipped.join(", ") }), ...warnLines].join("\n");
  }
  if (result.skipped.length > 0) {
    lines.push(t("addagentSkipped", { list: result.skipped.join(", ") }));
  }
  return lines.join("\n");
}

export function buildAddAgentTool(ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Add one or more specialist agents.",
      "Format: add spec1 spec2 ... with model model from provider",
      "Shorthand: add all / all / * with model model from provider — adds all seven agents at once",
      "Model: alias (gemini, mimo, big-pickle, minimax, ox, ling) or provider/model (fail-open with warning if not in catalog)",
      "Behavior: writes .opencode/agents/<tag>.md and opencode.json/roster programmatically (no edit/bash, no delegation to dev).",
      "Bare base + model (e.g. analyst with model M): the base is never touched — a variant <base>-<suffix> is derived automatically (short catalog suffix for known models, full model slug for provider-offered customs; unoffered suffixes are rejected fail-closed) and created; an explicit suffix (e.g. analyst-ling) creates <base>-<suffix>.md + new entry; identical re-add = zero writes; a different model on the same suffix = announced update",
      "tawa: singular only (tawa with model X from Y) preserves mode:all; tawa-* is blocked",
      examplesText(),
    ].join("\n"),
    args: {
      name: tool.schema.string().describe("Specializations + model + provider"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      const a = cctx.agent ? normalizeName(cctx.agent) : "";
      const isDispatcher = a === "addagent" || a === "kick";
      const callerIsMainSession =
        isDispatcher || !cctx.agent || a === "undefined" || (resolveRole(a) === null && !a.startsWith("agent:"));
      if (!callerIsMainSession) {
        logger.warn(
          `Agent ${cctx.agent} attempted to use addagent — user-only tool. Input: ${String(args.name || "").slice(0, 80)}`,
        );
        const hint = (() => {
          try {
            const raw = String(args.name || "").trim();
            const m = raw.match(
              /^([@\w\s*/\-]+?)\s+with\s+model\s+(.+?)\s+from\s+([\w\s.-]+)$/i,
            );
            if (!m) return "";
            const spec = m[1]!.trim().split(/\s+/)[0] ?? "";
            const model = m[2]!.trim().replace(/\s+/g, "-").toLowerCase();
            const provider = m[3]!.trim().replace(/\s+/g, "-").toLowerCase();
            if (!spec) return "";
            return `\nℹ️ Run as main user: @addagent ${spec} with model ${model} from ${provider}  — or @tawa ${spec} with model ${model} from ${provider}`;
          } catch {
            return "";
          }
        })();
        return { output: t("addagentAgentOnly") + hint + "\n\n" + examplesText() + "\n" + kickHelpText() };
      }
      const input = String(args.name || "").trim();
      if (!input) {
        return { output: t("addagentEmpty") + "\n\n" + examplesText() };
      }

      const normalizedForCheck = normalizeName(input);
      const isAddAgentTypo =
        levenshtein(normalizedForCheck, "addagent", 2) <= 2 &&
        normalizedForCheck !== "addagent" &&
        !parseAddInput(input);

      if (isAddAgentTypo) {
        return { output: t("addagentDidYouMean") + "\n\n" + examplesText() };
      }

      const parsed = parseAddInput(input);
      if (!parsed) {
        return { output: t("addagentBadFormat") + "\n\n" + examplesText() };
      }
      const validationErr = validateAddInput(parsed.specs, parsed.model);
      if (validationErr) return { output: validationErr };
      const fullModel = resolveModelAlias(parsed.model)!;
      const usedAlias = Boolean(MODEL_ALIASES[parsed.model.toLowerCase()]);
      let modelAdvisory: string | undefined;
      if (shouldWarnUnverifiedModel(fullModel, usedAlias)) {
        modelAdvisory = t("addagentUnverifiedModel", { model: fullModel });
      }
      warnScopeMismatch(ctx);
      const scopeGuard = globalSpaceGuard(ctx);
      if (scopeGuard) return { output: `❌ ${scopeGuard}\n\n${examplesText()}` };
      const result = await executeAddAll(ctx, parsed.specs, fullModel);
      const quietSet = new Set(result.quiet ?? []);
      const touchedTags = new Set([
        ...result.added,
        ...(result.updated ?? []).map((u) => u.tag),
        ...result.skipped.filter((s) => !quietSet.has(s)),
      ]);
      if (modelAdvisory && result.added.length > 0) {
        (result.warnings ??= []).push(modelAdvisory);
      }
      if (touchedTags.size > 0) {
        if (SCOPE === "global") {
          try {
            await withConfigWriteLock(
              ctx,
              async () => {
                try {
                  const rosterPath = resolveTawassulConfigPath(ctx.stateDir, "global");
                  const { roster } = readTawassulRoster(rosterPath);
                  let changed = false;
                  for (const spec of parsed.specs) {
                    const tag = `@${spec}`;
                    if (!touchedTags.has(tag)) continue;
                    const normalized = normalizeName(spec);
                    if (normalized === "tawa") {
                      const existing = roster.agents[spec] as { model?: unknown } | undefined;
                      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                        (existing as { model?: unknown }).model = fullModel;
                      } else {
                        const tawaTemplate = ALL_AGENTS.find((a) => a.name === "tawa");
                        if (tawaTemplate) {
                          roster.agents[spec] = {
                            description: tawaTemplate.description,
                            model: fullModel,
                            mode: tawaTemplate.mode,
                            permission: tawaFallbackPermission(),
                          } as unknown as (typeof roster.agents)[string];
                        } else if (roster.agents[spec] && typeof roster.agents[spec] === "object") {
                          (roster.agents[spec] as { model?: unknown }).model = fullModel;
                        } else {
                          roster.agents[spec] = {
                            description: "Experts' intermediary — routing only on explicit @tawa invocation",
                            model: fullModel,
                            mode: "all",
                            permission: tawaFallbackPermission(),
                          } as unknown as (typeof roster.agents)[string];
                        }
                      }
                      changed = true;
                      continue;
                    }
                    if ((BASE_ROLE_NAMES as ReadonlySet<string>).has(normalizeName(spec))) {
                      const bareMsg = t("addagentBareBaseRefused", { spec });
                      logger.warn(bareMsg);
                      result.errors.push(bareMsg);
                      continue;
                    }
                    const cfg = agentConfigFor(spec, fullModel);
                    if (!cfg) continue;
                    const existing = roster.agents[spec];
                    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                      const prevModel = (existing as { model?: unknown }).model as string | undefined;
                      const ex = existing as { model?: unknown };
                      ex.model = cfg.model;
                      if (
                        (BASE_ROLE_NAMES as ReadonlySet<string>).has(normalizeName(spec)) &&
                        prevModel !== undefined &&
                        prevModel !== cfg.model
                      ) {
                        const hintSuffix =
                          MODEL_ID_TO_SUFFIX[fullModel] ?? fullModel.split("/").pop()?.split("-")[0] ?? "custom";
                        (result.warnings ??= []).push(
                          t("addagentBasePatched", {
                            spec,
                            prev: String(prevModel),
                            curr: String(cfg.model),
                            hint: hintSuffix,
                          }),
                        );
                      }
                    } else {
                      roster.agents[spec] = cfg;
                    }
                    changed = true;
                  }
                  if (changed) {
                    await writeTawassulRoster(rosterPath, roster);
                    ctx.agentManager.clearReadCache();
                  }
                } catch (e) {
                  const msg = `addagent: failed to write global roster: ${e instanceof Error ? e.message : String(e)}`;
                  logger.error(msg);
                  result.errors.push(msg);
                  rollbackAdd(
                    ctx,
                    result.added.map((tag) => normalizeName(tag)),
                  );
                  result.added = [];
                }
              },
              { failClosed: true },
            );
          } catch (e) {
            const msg = `addagent: config write lock unavailable — add aborted: ${e instanceof Error ? e.message : String(e)}`;
            logger.error(msg);
            result.errors.push(msg);
            rollbackAdd(
              ctx,
              result.added.map((tag) => normalizeName(tag)),
            );
            result.added = [];
          }
          if (result.added.length > 0) {
            clearMdBackup(
              ctx,
              result.added.map((tag) => normalizeName(tag)),
            );
          }
        } else {
          const cfgPath = resolveActiveConfigPath(ctx.stateDir);
          const cfgName = basename(cfgPath);
          let configWriteFailed = false;
          try {
            await withConfigWriteLock(
              ctx,
              async () => {
                try {
                  const opencodePath = cfgPath;
                  const safeOpencodePath = await resolveSafePath(opencodePath, ctx.stateDir);
                  if (!safeOpencodePath) {
                    const msg = "addagent: opencode path escapes stateDir — aborting config write";
                    logger.warn(msg);
                    result.errors.push(msg);
                    configWriteFailed = true;
                  } else {
                    let raw: string | null = null;
                    try {
                      raw = await readFile(opencodePath, "utf-8");
                    } catch (e) {
                      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
                        throw new Error("addagent: project opencode.json is missing — refusing to write");
                      }
                      throw e;
                    }
                    if (raw !== null) {
                      const conf = JSON.parse(cfgName.endsWith(".jsonc") ? stripJsoncComments(raw) : raw);
                      if (!conf.agent || typeof conf.agent !== "object" || Array.isArray(conf.agent)) {
                        const msg = `addagent: ${cfgName} has no usable "agent" object — refusing to write (config may be corrupted)`;
                        logger.error(msg);
                        result.errors.push(msg);
                        configWriteFailed = true;
                      } else {
                        let changed = false;
                        for (const spec of parsed.specs) {
                          const tag = `@${spec}`;
                          if (touchedTags.has(tag)) {
                            const normalized = normalizeName(spec);
                            if (normalized === "tawa") {
                              const existing = conf.agent[spec] as { model?: unknown } | undefined;
                              if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                                (existing as { model?: unknown }).model = fullModel;
                              } else {
                                const tawaTemplate = ALL_AGENTS.find((a) => a.name === "tawa");
                                if (tawaTemplate) {
                                  conf.agent[spec] = {
                                    description: tawaTemplate.description,
                                    model: fullModel,
                                    mode: tawaTemplate.mode,
                                    permission: tawaFallbackPermission(),
                                  } as unknown as (typeof conf.agent)[string];
                                } else if (conf.agent[spec] && typeof conf.agent[spec] === "object") {
                                  (conf.agent[spec] as { model?: unknown }).model = fullModel;
                                } else {
                                  conf.agent[spec] = {
                                    description: "Experts' intermediary — routing only on explicit @tawa invocation",
                                    model: fullModel,
                                    mode: "all",
                                    permission: tawaFallbackPermission(),
                                  } as unknown as (typeof conf.agent)[string];
                                }
                              }
                              changed = true;
                              continue;
                            }
                            if ((BASE_ROLE_NAMES as ReadonlySet<string>).has(normalizeName(spec))) {
                              const bareMsg = t("addagentBareBaseRefused", { spec });
                              logger.warn(bareMsg);
                              result.errors.push(bareMsg);
                              configWriteFailed = true;
                              continue;
                            }
                            const cfg = agentConfigFor(spec, fullModel);
                            if (!cfg) {
                              logger.warn(`addagent: no template for "${spec}" — skipping config write`);
                              continue;
                            }
                            const existing = conf.agent[spec];
                            if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                              const prevModel = (existing as { model?: unknown }).model as string | undefined;
                              existing.model = cfg.model;
                              if (
                                (BASE_ROLE_NAMES as ReadonlySet<string>).has(normalizeName(spec)) &&
                                prevModel !== undefined &&
                                prevModel !== cfg.model
                              ) {
                                const hintSuffix =
                                  MODEL_ID_TO_SUFFIX[fullModel] ??
                                  fullModel.split("/").pop()?.split("-")[0] ??
                                  "custom";
                                (result.warnings ??= []).push(
                                  t("addagentBasePatched", {
                                    spec,
                                    prev: String(prevModel),
                                    curr: String(cfg.model),
                                    hint: hintSuffix,
                                  }),
                                );
                              }
                            } else {
                              conf.agent[spec] = cfg;
                            }
                            changed = true;
                          }
                        }
                        if (changed) {
                          await atomicWriteFile(opencodePath, spliceAgentSection(raw, conf.agent));
                          ctx.agentManager.clearReadCache();
                        }
                      }
                    }
                  }
                } catch (e) {
                  const msg = `Failed to update ${cfgName}: ${e instanceof Error ? e.message : String(e)}`;
                  logger.warn(msg);
                  result.errors.push(msg);
                  configWriteFailed = true;
                }
              },
              { failClosed: true },
            );
          } catch (e) {
            const msg = `addagent: config write lock unavailable — add aborted: ${e instanceof Error ? e.message : String(e)}`;
            logger.warn(msg);
            result.errors.push(msg);
            configWriteFailed = true;
          }
          if (configWriteFailed) {
            rollbackAdd(
              ctx,
              result.added.map((tag) => normalizeName(tag)),
            );
            result.added = [];
          } else {
            clearMdBackup(
              ctx,
              result.added.map((tag) => normalizeName(tag)),
            );
          }
        }
        const variantUndo = result.added.map((tag) => normalizeName(tag)).filter(isVariantName);
        if (variantUndo.length > 0) {
          try {
            await withConfigWriteLock(ctx, async () => {
              await unpersistDeletedAgents(ctx, variantUndo);
            }, { failClosed: true });
          } catch (e) {
            const msg = `addagent: failed to undo deletion list entry (${variantUndo.join(", ")}) — the variant is absent from the project config and regen will skip it; re-run the same addagent line to repair: ${(e as Error).message}`;
            logger.warn(msg, e);
            (result.warnings ??= []).push(msg);
          }
        }
        const pinEntries = computePinEntries(
          parsed.specs.filter((s) => !quietSet.has(`@${s}`)),
          new Set(result.errors),
          fullModel,
        );
        if (pinEntries.length > 0) {
          try {
            await withConfigWriteLock(ctx, async () => {
              await writeBaseRolePins(ctx, pinEntries);
            }, { failClosed: true });
          } catch (e) {
            const msg = `addagent: failed to record pins (${pinEntries.map((p) => p.name).join(", ")}) — re-run the same addagent line to repair: ${(e as Error).message}`;
            logger.warn(msg, e);
            (result.warnings ??= []).push(msg);
          }
        }
      }
      ctx.saveState();
      const addedTags = new Set(result.added);
      const derivedLines = Object.entries(parsed.derived ?? {})
        .filter(([to]) => addedTags.has(`@${to}`))
        .map(([to, from]) => t("addagentDerived", { from: `@${from}`, to: `@${to}`, model: fullModel }));
      return {
        title: t("addagentTitle", { count: String(result.added.length) }),
        output: [...derivedLines, formatAddResult(result)].filter(Boolean).join("\n"),
      };
    },
  });
}

export function buildKickTool(ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Remove one or more specialist agents — the only tool alongside addagent inside withConfigWriteLock (no edit/bash needed).",
      "Format: remove spec1 spec2 ... with model model from provider",
      "Shorthand: remove all / all / * with model model from provider — removes all seven agents at once (tawa excluded); bulk removal of unprotected variants shows a confirmation card in the main session (fail-closed without it).",
      "Note: the agent saying 'I don't have kick' is RBAC for the main user only — run as @addagent or @tawa in the main session (see kickNotAnalystHint).",
      kickExamplesText(),
    ].join("\n"),
    args: {
      agent: tool.schema.string().describe("Specializations + model + provider"),
      reason: tool.schema.string().optional().describe("Reason for removal (optional)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      const input = String(args.agent || "").trim();
      const reason = String(args.reason || "").trim();
      if (!input) {
        return { output: t("kickMissingAgent") + "\n\n" + kickHelpText() };
      }
      const hintFromInput = (() => {
        try {
          const m = input.match(
            /^([@\w\s*/\-]+?)\s+with\s+model\s+(.+?)\s+from\s+([\w\s.-]+)$/i,
          );
          if (!m) return null;
          const specsPart = m[1]!
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((s) => normalizeName(s))
            .join(" ");
          const modelPart = m[2]!.trim().replace(/\s+/g, "-").toLowerCase();
          const providerPart = m[3]!.trim().replace(/\s+/g, "-").toLowerCase();
          if (!specsPart || !modelPart || !providerPart) return null;
          return {
            spec: specsPart.split(/\s+/)[0] ?? specsPart,
            model: modelPart,
            provider: providerPart,
            fullSpecs: specsPart,
          };
        } catch {
          return null;
        }
      })();
      const a = cctx.agent ? normalizeName(cctx.agent) : "";
      const isDispatcher = a === "addagent" || a === "kick";
      const callerIsMainSession =
        isDispatcher || !cctx.agent || a === "undefined" || (resolveRole(a) === null && !a.startsWith("agent:"));
      if (!callerIsMainSession) {
        logger.warn(`Unauthorized kick attempt by ${cctx.agent} — input: ${input.slice(0, 80)}`);
        const role = (() => {
          try {
            return resolveRole(normalizeName(cctx.agent ?? "")) ?? String(cctx.agent ?? "unknown");
          } catch {
            return String(cctx.agent ?? "unknown");
          }
        })();
        return {
          output: t("kickNotAnalystHint", {
            agent: String(cctx.agent ?? "unknown").replace(/^@+/, ""),
            role,
            spec: hintFromInput?.spec ?? hintFromInput?.fullSpecs ?? "analyst-ling",
            model: hintFromInput?.model ?? "ling-3.0-flash-fin-free",
            provider: hintFromInput?.provider ?? "opencode-zen",
          }),
        };
      }
      if (reason) logger.debug(`Kick reason: ${reason}`);
      warnScopeMismatch(ctx);
      const scopeGuard = globalSpaceGuard(ctx);
      if (scopeGuard) return { output: `❌ ${scopeGuard}` };
      const specs = parseKickInput(input);
      if (!specs) {
        return { output: t("kickInvalidFormat") + "\n\n" + kickHelpText() };
      }

      if (specs.length >= 2) {
        const removable = specs.filter((s) => !isProtected(ctx, `@${s}`));
        const display = removable.length > 0 ? removable.join(", ") : specs.join(", ");
        const title = `Confirm removal of ${removable.length || specs.length} agents: ${display} — are you sure?`;
        const channel = ctx.askChannelInstance;
        if (channel) {
          const answerSession = channel.currentSessionOverride || cctx.sessionID;
          if (!callerIsMainSession && !channel.currentSessionOverride) {
            logger.warn(
              "[kick] no-root-binding: bulk confirm from sub without a known root — question cannot reach the user",
              { specs: specs.join(",") },
            );
            return { output: t("kickBulkConfirmRequired") };
          }
          if (channel.hasPending(answerSession)) {
            return { output: t("kickBulkPending") };
          }
          try {
            const reply = await channel.askForRoot(title, { type: "confirm", default: false }, cctx.sessionID);
            if (reply === ASK_UNAVAILABLE) {
              logger.warn("[kick] bulk confirm could not reach the user — failing closed");
              return { output: t("kickBulkConfirmRequired") };
            }
            if (reply !== true) {
              return { output: t("kickCancelled") };
            }
          } catch {
            return { output: t("kickCancelled") };
          }
        } else if (callerIsMainSession && cctx.ask) {
          try {
            const confirmed = await cctx.ask(title, {
              type: "confirm",
              default: false,
            });
            if (confirmed === ASK_UNAVAILABLE) {
              logger.warn("[kick] bulk confirm could not reach the user — failing closed");
              return { output: t("kickBulkConfirmRequired") };
            }
            if (confirmed !== true) {
              return { output: t("kickCancelled") };
            }
          } catch {
            return { output: t("kickCancelled") };
          }
        } else {
          return { output: t("kickBulkConfirmRequired") };
        }
      }

      let deleted: Set<string>;
      try {
        deleted = await readDeletedAgentNames(ctx);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const isFsError = detail.includes("EISDIR") || detail.includes("EACCES") || detail.includes("ENOENT");
        logger.error(`kick: reading deleted list failed: ${detail}`);
        return { output: `❌ Failed to read deletion list${isFsError ? " (file error)" : ""}: ${detail}` };
      }
      const result: KickResult = { removed: [], alreadyDeleted: [], protected_: [], notFound: [] };
      const variantsToPersist: string[] = [];

      for (const spec of specs) {
        const tag = `@${spec}`;
        const name = normalizeName(spec);
        if (deleted.has(name)) {
          result.alreadyDeleted.push(tag);
          continue;
        }
        if (isGeneratedVariant(name, SPECIALIZATIONS)) {
          if (isProtected(ctx, tag)) {
            result.protected_.push(tag);
            continue;
          }
          variantsToPersist.push(name);
          result.removed.push(tag);
          continue;
        }
        const status = classifyRemove(ctx, name);
        if (status === "removed") {
          result.removed.push(tag);
        } else if (status === "protected") {
          result.protected_.push(tag);
        } else {
          result.notFound.push(tag);
        }
      }

      if (result.removed.length > 0 || variantsToPersist.length > 0) {
        try {
          await withConfigWriteLock(
            ctx,
            async () => {
              if (result.removed.length > 0) {
                await removeAgentsFromConfig(
                  ctx,
                  result.removed.map((tag) => normalizeName(tag)),
                );
              }
              if (variantsToPersist.length > 0) {
                await persistDeletedAgents(ctx, variantsToPersist);
              }
              if (result.removed.length > 0) {
                await removeBaseRolePins(
                  ctx,
                  result.removed.map((tag) => normalizeName(tag)),
                );
              }
              {
                const removedSet = new Set(result.removed.map((tag) => normalizeName(tag)));
                const toReassign: Array<{ name: string; oldModel: string; newModel: string }> = [];
                for (const [name, model] of Object.entries(ctx.agentModelMap)) {
                  const normalized = normalizeName(name);
                  if (removedSet.has(normalized)) continue;
                  if (typeof model === "string" && modelAvailability(model) === "absent") {
                    const role = resolveRole(name) ?? name;
                    const chain = getDynamicFallbackChainForRole(role, ctx);
                    const healthy =
                      chain.find((m) => !RETIRED_MODEL_IDS.has(m) && modelAvailability(m) !== "absent") ??
                      "opencode/big-pickle";
                    if (healthy && healthy !== model) {
                      toReassign.push({ name: normalized, oldModel: model as string, newModel: healthy });
                      ctx.agentModelMap[normalized] = healthy;
                      try {
                        ctx.modelManager.markModelFailed(normalized, model as string, "retired sweep");
                      } catch {
                        void 0;
                      }
                    }
                  }
                }
                const extraReassigned: string[] = [];
                if (SCOPE === "global") {
                  const rosterPath = resolveTawassulConfigPath(ctx.stateDir, "global");
                  try {
                    const { roster } = readTawassulRoster(rosterPath);
                    let changed = false;
                    for (const { name, newModel } of toReassign) {
                      const entry = roster.agents[name] as { model?: unknown } | undefined;
                      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
                        (entry as { model?: unknown }).model = newModel;
                        changed = true;
                      }
                    }
                    for (const [agentName, cfg] of Object.entries(roster.agents)) {
                      const normalized = normalizeName(agentName);
                      if (removedSet.has(normalized)) continue;
                      if (toReassign.some((r) => r.name === normalized)) continue;
                      const entry = cfg as { model?: unknown } | undefined;
                      const m = entry && typeof entry === "object" ? (entry.model as string | undefined) : undefined;
                      if (m && modelAvailability(m) === "absent") {
                        const role = resolveRole(agentName) ?? agentName;
                        const chain = getDynamicFallbackChainForRole(role, ctx);
                        const healthy =
                          chain.find((mm) => !RETIRED_MODEL_IDS.has(mm) && modelAvailability(mm) !== "absent") ??
                          "opencode/big-pickle";
                        if (healthy && healthy !== m) {
                          (entry as { model?: unknown }).model = healthy;
                          ctx.agentModelMap[normalized] = healthy;
                          extraReassigned.push(normalized);
                          try {
                            ctx.modelManager.markModelFailed(normalized, m, "retired sweep (roster)");
                          } catch {
                            void 0;
                          }
                          changed = true;
                        }
                      }
                    }
                    if (changed) await writeTawassulRoster(rosterPath, roster);
                  } catch (e) {
                    logger.warn(`kick sweep: failed to update global roster: ${(e as Error).message}`);
                  }
                } else {
                  const cfgPath = resolveActiveConfigPath(ctx.stateDir);
                  let raw: string | null;
                  try {
                    raw = await readFile(cfgPath, "utf-8");
                  } catch {
                    raw = null;
                  }
                  if (raw !== null) {
                    try {
                      const conf = JSON.parse(cfgPath.endsWith(".jsonc") ? stripJsoncComments(raw) : raw) as {
                        agent?: Record<string, { model?: unknown }>;
                      };
                      if (conf.agent && typeof conf.agent === "object" && !Array.isArray(conf.agent)) {
                        let changed = false;
                        for (const { name, newModel } of toReassign) {
                          const entry = conf.agent[name] as { model?: unknown } | undefined;
                          if (entry && typeof entry === "object" && !Array.isArray(entry)) {
                            (entry as { model?: unknown }).model = newModel;
                            changed = true;
                          }
                        }
                        for (const [agentName, entry] of Object.entries(conf.agent)) {
                          const normalized = normalizeName(agentName);
                          if (removedSet.has(normalized)) continue;
                          if (toReassign.some((r) => r.name === normalized)) continue;
                          const m = (entry as { model?: unknown } | undefined)?.model as string | undefined;
                          if (m && modelAvailability(m) === "absent") {
                            const role = resolveRole(agentName) ?? agentName;
                            const chain = getDynamicFallbackChainForRole(role, ctx);
                            const healthy =
                              chain.find((mm) => !RETIRED_MODEL_IDS.has(mm) && modelAvailability(mm) !== "absent") ??
                              "opencode/big-pickle";
                            if (healthy && healthy !== m) {
                              (entry as { model?: unknown }).model = healthy;
                              ctx.agentModelMap[normalized] = healthy;
                              extraReassigned.push(normalized);
                              try {
                                ctx.modelManager.markModelFailed(normalized, m, "retired sweep (config)");
                              } catch {
                                void 0;
                              }
                              changed = true;
                            }
                          }
                        }
                        if (changed) await atomicWriteFile(cfgPath, spliceAgentSection(raw, conf.agent));
                      }
                    } catch (e) {
                      logger.warn(`kick sweep: failed to update project config: ${(e as Error).message}`);
                    }
                  }
                }
                const allReassigned = [...toReassign.map((r) => r.name), ...extraReassigned];
                if (allReassigned.length > 0) {
                  try {
                    await removeBaseRolePins(
                      ctx,
                      allReassigned.filter((n) => (BASE_ROLE_NAMES as ReadonlySet<string>).has(n)),
                    );
                  } catch {
                    void 0;
                  }
                }
              }
              if (result.removed.length > 0) ctx.agentManager.clearReadCache();
              for (const tag of result.removed) {
                removeAgentMd(ctx, normalizeName(tag));
              }
            },
            { failClosed: true },
          );
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          logger.error(`kick: config/deleted write failed — aborting before any destructive step: ${detail}`);
          return { output: `❌ ${t("kickConfigWriteFailed")}: ${detail}` };
        }
      }

      for (const tag of result.removed) {
        dropAgentState(ctx, tag);
      }

      if (result.removed.length > 0) ctx.agentManager.clearReadCache();
      ctx.saveState();
      return {
        title: t("kickRemovedTitle", { count: String(result.removed.length) }),
        output: formatKickResult(result),
      };
    },
  });
}
