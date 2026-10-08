import { parseYAML } from "confbox";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BASH_READ_ONLY } from "../permissions.ts";
import { TAWASSUL_TOOL_NAMES } from "../tool-names.ts";
import { BLOCKED_TOOLS, TAWA_AGENT, DELETED_AGENTS, getAllowedToolsForRole } from "../security-policy.ts";
import { ALL_AGENTS, ROLE_NAMES } from "../core/agent-data.ts";
import { MODEL_SUFFIX_MAP, isGeneratedVariant, RETIRED_MODEL_IDS, LEGACY_UNIFIED_HEAD } from "../core/variant-names.ts";
import { resolveModelAlias, MODEL_ALIASES } from "../services/proxy-models.ts";
import { defaultAgentModelForRole } from "../services/proxy-fallback-chains.ts";
import { logger } from "../utils/logger.ts";
import { atomicWriteFile } from "../utils/atomic.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { resolveRole } from "../utils/agent.ts";
import {
  spliceAgentSection,
  readTawassulRoster,
  readJsoncObject,
  writeTawassulRoster,
  type TawassulRoster,
} from "../utils/opencode-config.ts";
import {
  globalConfigDir,
  isInsideGlobalConfigDir,
  isTawassulGlobalSpace,
  resolveAgentsDir,
  resolveTawassulConfigPath,
} from "../utils/path-resolver.ts";
import { releaseFSLock } from "../infra/file-lock.ts";
import { acquireOpencodeConfigLock } from "../utils/opencode-config.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface GenPaths {
  configPath: string;
  agentsDir: string;
  deletedPath: string;
  pinsPath?: string;
}

export function inferProjectRoot(): string {
  const env = process.env.TAWASSUL_PROJECT_DIR?.trim();
  if (env) return resolve(env);
  const local = resolve(__dirname, "../../../../");
  if (existsSync(resolve(local, "opencode.json"))) return local;
  return process.cwd();
}

export function resolveGenPaths(projectRoot?: string): GenPaths {
  const root = resolve(projectRoot ?? inferProjectRoot());
  return {
    configPath: resolve(root, "opencode.json"),
    agentsDir: resolve(root, ".opencode", "agents"),
    deletedPath: resolve(root, ".opencode", "deleted-agents.json"),
  };
}

function getDefaultPaths(): GenPaths {
  return resolveGenPaths();
}

export function refuseProjectTarget(configPath: string): string | null {
  if (isInsideGlobalConfigDir(configPath)) {
    return (
      `refusing to write opencode.json inside a user-level install location ` +
      `(global config dir ${globalConfigDir()} / OPENCODE_CONFIG_DIR / ~/.opencode / npm package cache) ` +
      `— a global install must pass --project <real-project-dir> (or TAWASSUL_PROJECT_DIR)`
    );
  }
  const marker = resolve(dirname(configPath), ".opencode", "agents", "tawa.md");
  if (!existsSync(marker)) {
    return (
      `${dirname(configPath)} is not a tawassul project — missing the project marker ${marker} ` +
      `(run from the project root or pass --project <dir>)`
    );
  }
  return null;
}

function globalGenPaths(): GenPaths {
  const rosterPath = resolveTawassulConfigPath(process.cwd(), "global");
  return {
    configPath: rosterPath,
    agentsDir: resolveAgentsDir(process.cwd(), "global"),
    deletedPath: rosterPath,
    pinsPath: resolve(dirname(rosterPath), "tawassul-pins.json"),
  };
}

export function refuseGlobalTarget(rosterPath: string): string | null {
  if (isTawassulGlobalSpace(rosterPath)) return null;
  const g = globalConfigDir();
  return (
    `${g} is not a tawassul global space — missing the native agent marker ` +
    `${resolve(g, "agent", "tawa.md")} and no existing roster at ${rosterPath}; refusing to guess (a wrong ` +
    `write could damage the OS user's config)`
  );
}

function loadPinnedAgents(deletedPath: string, pinsPath?: string): Set<string> {
  const p = pinsPath ?? resolve(dirname(deletedPath), "tawassul-pins.json");
  try {
    const obj = JSON.parse(readFileSync(p, "utf-8")) as { pinned?: unknown };
    if (!obj || !Array.isArray(obj.pinned)) return new Set();
    return new Set((obj.pinned as unknown[]).map((s) => normalizeName(String(s))));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn(
        `[gen-opencode-config] tawassul-pins.json at ${p} is unreadable/malformed — ` +
          `explicit pins are IGNORED this regen (${e instanceof Error ? e.message : String(e)})`,
      );
    }
    return new Set();
  }
}

export function buildGlobalRoster(): TawassulRoster {
  const paths = globalGenPaths();
  const { roster } = readTawassulRoster(paths.configPath);
  const deleted = [...new Set(roster.deleted)];
  validateDeletedList(deleted);
  const pinned = loadPinnedAgents(paths.configPath, paths.pinsPath);
  const agents = buildAgents(deleted, { agentsDir: paths.agentsDir, deletedPath: paths.configPath });
  const deletedSet = new Set(deleted.map((s) => normalizeName(String(s))));
  const merged: Record<string, unknown> = { ...agents };
  for (const [name, cfg] of Object.entries(roster.agents)) {
    if (name in agents) {
      const existingCfg = cfg as { model?: unknown } | null;
      const generatedCfg = agents[name];
      const existingModel = existingCfg && typeof existingCfg === "object" ? existingCfg.model : undefined;
      const retiredOverride = typeof existingModel === "string" ? RETIRED_MODEL_IDS.has(existingModel) : false;
      const legacyHeadOnBase =
        typeof existingModel === "string" &&
        !pinned.has(normalizeName(name)) &&
        (BASE_ORDER as readonly string[]).includes(name) &&
        existingModel === LEGACY_UNIFIED_HEAD &&
        typeof generatedCfg?.model === "string" &&
        generatedCfg.model !== LEGACY_UNIFIED_HEAD;
      const addagentStale =
        name === "addagent" &&
        !pinned.has(normalizeName(name)) &&
        typeof existingModel === "string" &&
        existingModel === "opencode/mimo-v2.5-free" &&
        typeof generatedCfg?.model === "string" &&
        generatedCfg.model === "opencode/big-pickle";
      if (
        existingCfg &&
        !retiredOverride &&
        !legacyHeadOnBase &&
        !addagentStale &&
        typeof existingCfg === "object" &&
        typeof existingModel === "string" &&
        generatedCfg &&
        typeof generatedCfg.model === "string" &&
        existingModel !== generatedCfg.model
      ) {
        merged[name] = existingCfg;
      }
      continue;
    }
    if (deletedSet.has(normalizeName(name)) && isGeneratedVariant(name, EXTEND_AGENTS)) continue;
    merged[name] = cfg;
  }
  return { agents: merged, deleted };
}

export function checkGlobalRoster(): { ok: boolean; diff?: string } {
  const paths = globalGenPaths();
  const expected = buildGlobalRoster();
  const { roster } = readTawassulRoster(paths.configPath);
  const shape = (agents: Record<string, unknown>) => {
    const sorted: Record<string, unknown> = {};
    for (const name of Object.keys(agents).sort()) sorted[name] = agents[name];
    return JSON.stringify(sorted);
  };
  const globalDeletedSet = new Set(expected.deleted.map((s) => normalizeName(String(s))));
  const resurrected = Object.keys(roster.agents).filter(
    (name) => globalDeletedSet.has(normalizeName(name)) && isGeneratedVariant(name, EXTEND_AGENTS),
  );
  const expectedDeleted = JSON.stringify([...expected.deleted].sort());
  const actualDeleted = JSON.stringify([...roster.deleted].sort());
  if (
    resurrected.length === 0 &&
    shape(expected.agents) === shape(roster.agents) &&
    expectedDeleted === actualDeleted
  ) {
    return { ok: true };
  }
  if (resurrected.length > 0) {
    return {
      ok: false,
      diff: `global roster (${paths.configPath}): resurrected deleted variants: ${resurrected.join(", ")}`,
    };
  }
  return { ok: false, diff: `global roster (${paths.configPath}) is out of sync with the generators` };
}

interface PermissionBlock {
  [key: string]: string | Record<string, string> | undefined;
}

interface AgentConfig {
  description: string;
  model: string;
  mode: string;
  permission: PermissionBlock;
}

export const OFFICIAL_PERMISSION_KEYS: readonly string[] = [
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "external_directory",
  "todowrite",
  "webfetch",
  "websearch",
  "lsp",
  "skill",
  "question",
  "doom_loop",
];

export const REGISTERED_PERMISSION_KEYS: readonly string[] = [...TAWASSUL_TOOL_NAMES];

const ROLE_ORDER: readonly string[] = ["analyst", "architect", "dev", "reviewer", "tester", "designer", "doc"];

const BASE_ORDER = ALL_AGENTS.map((a) => a.name);

const EXTEND_AGENTS: string[] = [
  ...ROLE_ORDER.filter((name) => ALL_AGENTS.some((a) => a.name === name)),
  ...ALL_AGENTS.filter((a) => a.name !== "tawa" && !ROLE_ORDER.includes(a.name)).map((a) => a.name),
];

export { isGeneratedVariant } from "../core/variant-names.ts";
export { MODEL_SUFFIX_MAP } from "../core/variant-names.ts";

export interface GenOptions {
  projectRoot?: string;
  configPath?: string;
  agentsDir?: string;
  deletedPath?: string;
  pinsPath?: string;
  deleted?: readonly string[];
}

export function readDeletedAgents(path?: string): string[] {
  const p = path ?? getDefaultPaths().deletedPath;
  if (!existsSync(p)) {
    logger.warn(`[gen-opencode-config] deleted-agents.json not found at ${p} — treating as empty (no deletions)`);
    return [];
  }
  const raw = readFileSync(p, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`gen-opencode-config: malformed deleted-agents.json at ${p}: ${(e as Error).message}`, {
      cause: e,
    });
  }
  const deleted = (parsed as { deleted?: unknown } | null)?.deleted;
  if (!Array.isArray(deleted) || deleted.some((d) => typeof d !== "string")) {
    throw new Error(`gen-opencode-config: deleted-agents.json at ${p} must be { "deleted": string[] }`);
  }
  return deleted as string[];
}

export function validateDeletedList(deleted: readonly string[], extend: readonly string[] = EXTEND_AGENTS): void {
  const bad = deleted.filter((name) => !isGeneratedVariant(name, extend));
  if (bad.length > 0) {
    logger.warn(
      `[gen-opencode-config] deleted-agents.json contains non-variant name(s) — ignoring ${bad.join(", ")} ` +
        `(only generated variants "role-suffix" reduce the emission set; freeform names are advisory only)`,
    );
  }
}

export function unionDeletedVariants(base: readonly string[]): string[] {
  return [...new Set([...base, ...[...DELETED_AGENTS].filter((n) => isGeneratedVariant(n, EXTEND_AGENTS))])];
}

export function derivedExpectedCount(deleted: readonly string[]): number {
  return EXPECTED_AGENT_COUNT - new Set(deleted.filter((n) => isGeneratedVariant(n, EXTEND_AGENTS))).size;
}

const ADDAGENT_MODEL = "opencode/big-pickle";

function readFrontmatter(name: string, agentsDir: string): Record<string, unknown> {
  const filePath = resolve(agentsDir, `${name}.md`);
  const raw = readFileSync(filePath, "utf-8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error(`gen-opencode-config: missing frontmatter in ${filePath}`);
  }
  const parsed = parseYAML(match[1]!) as Record<string, unknown>;
  if (!parsed || typeof parsed.description !== "string" || typeof parsed.mode !== "string") {
    throw new Error(`gen-opencode-config: invalid frontmatter in ${filePath} (description/mode required)`);
  }
  return parsed;
}

export function buildPermission(fm: Record<string, unknown>): PermissionBlock {
  const mdPerm = (fm.permission ?? {}) as Record<string, unknown>;
  const permission: PermissionBlock = {
    edit: mdPerm.edit as string | Record<string, string> | undefined,
    bash: (mdPerm.bash as string | Record<string, string> | undefined) ?? BASH_READ_ONLY,
    external_directory: mdPerm.external_directory as string | undefined,
    webfetch: mdPerm.webfetch as string | undefined,
    websearch: mdPerm.websearch as string | undefined,
    task: mdPerm.task as string | Record<string, string> | undefined,
    handoff: (mdPerm.handoff as string | Record<string, string> | undefined) ?? {
      "*": "deny",
      explore: "allow",
      general: "allow",
    },
  };
  const allowedKeys = new Set<string>([...OFFICIAL_PERMISSION_KEYS, ...REGISTERED_PERMISSION_KEYS]);
  for (const [key, value] of Object.entries(mdPerm)) {
    if (key in permission) continue;
    if (allowedKeys.has(key)) {
      permission[key] = value as string | Record<string, string>;
      continue;
    }
    throw new Error(
      `gen-opencode-config: agent frontmatter declares unknown permission key "${key}" ` +
        `(must be an official key or a registered tool name)`,
    );
  }
  return permission;
}

export { buildCapabilitySummary } from "../core/capability-summary.ts";
import { buildCapabilitySummary } from "../core/capability-summary.ts";

function buildVariant(base: AgentConfig, baseName: string, _suffix: string, model: string): AgentConfig {
  const capSummary = buildCapabilitySummary(base.permission);
  return {
    description: `${ROLE_NAMES[baseName] ?? baseName} — ${model}${capSummary}`,
    model,
    mode: base.mode,
    permission: structuredClone(base.permission),
  };
}

function grantTawaPluginTools(agents: Record<string, AgentConfig>): void {
  const tawa = agents.tawa;
  if (!tawa) return;
  const blocked = new Set(BLOCKED_TOOLS);
  for (const name of TAWASSUL_TOOL_NAMES) {
    if (blocked.has(name)) continue;
    tawa.permission[name] = "allow";
  }
}

function grantRolePluginTools(agents: Record<string, AgentConfig>): void {
  for (const [name, agent] of Object.entries(agents)) {
    if (name === TAWA_AGENT || name === "addagent") continue;
    if (!agent || !agent.permission) continue;
    let role = resolveRole(name);
    if (!role) {
      const idx = name.indexOf("-");
      if (idx > 0) {
        const base = name.slice(0, idx);
        if (BASE_ORDER.includes(base)) role = base;
      }
    }
    if (!role) continue;
    for (const tool of getAllowedToolsForRole(role)) {
      if (tool === "handoff" || tool === "task") continue;
      if (!(tool in agent.permission)) agent.permission[tool] = "allow";
    }
  }
}

export function isKnownDynamicAgent(name: string): boolean {
  const idx = name.indexOf("-");
  if (idx < 1 || idx >= name.length - 1) return false;
  const base = name.slice(0, idx);
  const suffix = name.slice(idx + 1);
  if (!EXTEND_AGENTS.includes(base)) return false;
  if (resolveModelAlias(suffix) !== null || suffix in MODEL_ALIASES) return true;
  return /^[a-z0-9][a-z0-9.-]*$/i.test(suffix);
}

export function collectBaseRegistry(
  dir?: string,
  deleted: readonly string[] = [],
): {
  onDisk: string[];
  missing: string[];
  orphans: string[];
} {
  const d = dir ?? getDefaultPaths().agentsDir;
  const onDisk = readdirSync(d)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3));
  const registered = new Set(BASE_ORDER);
  const deletedSet = new Set(deleted);
  const missing = BASE_ORDER.filter((name) => !onDisk.includes(name));
  const orphans = onDisk.filter(
    (name) => name !== "addagent" && !registered.has(name) && !isKnownDynamicAgent(name) && !deletedSet.has(name),
  );
  return { onDisk, missing, orphans };
}

export function assertBaseRegistrySync(dir?: string, deleted: readonly string[] = []): void {
  const { missing, orphans } = collectBaseRegistry(dir, deleted);
  if (missing.length > 0) {
    throw new Error(
      `gen-opencode-config: registered base agent(s) have no .md on disk — ${missing.join(", ")} ` +
        `(register the template in core/agent-data.ts AND ensure .opencode/agents/<name>.md exists)`,
    );
  }
  if (orphans.length > 0) {
    throw new Error(
      `gen-opencode-config: orphan .md file(s) not registered in core ALL_AGENTS — ${orphans.join(", ")} ` +
        `(register them in core/agent-data.ts or remove the file)`,
    );
  }
}

export function wildcardToRegExp(pattern: string): RegExp {
  let escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  escaped = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  if (escaped.endsWith(" .*")) {
    escaped = escaped.slice(0, -3) + "( .*)?";
  }
  return new RegExp(`^${escaped}$`, "s");
}

function evaluateBashMap(ruleMap: Record<string, string>, command: string): string {
  const entries = Object.entries(ruleMap);
  for (let i = entries.length - 1; i >= 0; i--) {
    const [pattern, effect] = entries[i]!;
    if (wildcardToRegExp(pattern).test(command)) return effect;
  }
  return "ask";
}

export function validateAgents(agents: Record<string, AgentConfig>): void {
  const validKeys = new Set<string>([...OFFICIAL_PERMISSION_KEYS, ...REGISTERED_PERMISSION_KEYS]);
  for (const [name, agent] of Object.entries(agents)) {
    for (const key of Object.keys(agent.permission)) {
      if (!validKeys.has(key)) {
        throw new Error(
          `gen-opencode-config: agent "${name}" exports unknown permission key "${key}" ` +
            `(must be an official key or a registered tool name)`,
        );
      }
    }
    if (typeof agent.permission.bash === "object" && agent.permission.bash !== null) {
      const fallback = evaluateBashMap(agent.permission.bash, "(unmatched-sentinel-#42)");
      if (fallback !== "deny") {
        throw new Error(
          `gen-opencode-config: agent "${name}" bash map has no effective "*" catch-all ` +
            `(unmatched command resolves to "${fallback}" instead of "deny")`,
        );
      }
    }
    if (name !== TAWA_AGENT) {
      for (const tool of ["task", "handoff"] as const) {
        const perm = agent.permission[tool];
        if (perm === "allow") {
          throw new Error(
            `gen-opencode-config: agent "${name}" ${tool} is "allow" — only @tawa may dispatch ` +
              `(execution agents are locked to the explore/general whitelist)`,
          );
        }
        if (perm !== undefined && perm !== "deny" && typeof perm === "object") {
          const fallback = evaluateRulesMap(perm, "(unmatched-sentinel-#42)");
          if (fallback !== "deny") {
            throw new Error(
              `gen-opencode-config: agent "${name}" ${tool} map has no effective "*" catch-all ` +
                `(unmatched target resolves to "${fallback}" instead of "deny")`,
            );
          }
        }
      }
    }
  }
}

function evaluateRulesMap(rules: Record<string, string>, probe: string, last: string = "deny"): string {
  if (rules[probe] !== undefined) return rules[probe];
  for (const [pattern, verdict] of Object.entries(rules)) {
    if (pattern === "*") last = verdict;
    else if (new RegExp(`^${escapeRegex(pattern)}$`, "s").test(probe)) last = verdict;
  }
  return last;
}

function escapeRegex(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildAgents(deleted?: readonly string[], opts?: GenOptions): Record<string, AgentConfig> {
  const paths = opts?.projectRoot ? resolveGenPaths(opts.projectRoot) : getDefaultPaths();
  const agentsDir = opts?.agentsDir ?? paths.agentsDir;
  const deletedList = deleted ?? unionDeletedVariants(readDeletedAgents(opts?.deletedPath ?? paths.deletedPath));
  validateDeletedList(deletedList);
  assertBaseRegistrySync(agentsDir, deletedList);

  const deletedSet = new Set(deletedList);
  const agents: Record<string, AgentConfig> = {};

  for (const name of BASE_ORDER) {
    const fm = readFrontmatter(name, agentsDir);
    agents[name] = {
      description: fm.description as string,
      model: defaultAgentModelForRole(name),
      mode: fm.mode as string,
      permission: buildPermission(fm),
    };
    if ((name === TAWA_AGENT || name === "addagent") && typeof agents[name].permission?.bash === "string") {
      agents[name].permission.bash = JSON.parse(JSON.stringify(BASH_READ_ONLY)) as Record<string, string>;
    }
  }

  grantRolePluginTools(agents);

  for (const baseName of EXTEND_AGENTS) {
    const base = agents[baseName];
    if (!base) continue;
    for (const [suffix, model] of Object.entries(MODEL_SUFFIX_MAP)) {
      const variantName = `${baseName}-${suffix}`;
      if (deletedSet.has(variantName)) continue;
      agents[variantName] = buildVariant(base, baseName, suffix, model);
    }
  }

  agents.addagent = {
    description:
      "Add new agents at runtime — dispatcher only. Call the `addagent` tool directly with the user's request as `name` (e.g. `analyst with model ling-3.0-flash-fin-free from opencode-zen`). The tool writes `.opencode/agents/*.md` and `opencode.json` programmatically (no edit/bash needed, no delegation to dev). If the role exists (analyst) it patches the model in-place; otherwise it creates a new `<base>-<suffix>.md` variant. Base roles: analyst, dev, tester, reviewer, architect, designer, doc. Tawa is singular and preserves mode:all; `tawa-*` is blocked.",
    model: ADDAGENT_MODEL,
    mode: "subagent",
    permission: {
      edit: "deny",
      bash: BASH_READ_ONLY,
      external_directory: "allow",
      webfetch: "allow",
      websearch: "allow",
      task: "deny",
      handoff: "deny",
      addagent: "allow",
      kick: "allow",
    },
  };

  grantTawaPluginTools(agents);
  validateAgents(agents);

  return agents;
}

export const EXPECTED_AGENT_COUNT = BASE_ORDER.length + EXTEND_AGENTS.length * Object.keys(MODEL_SUFFIX_MAP).length + 1;

export function buildMergedAgents(maybeRaw?: string, opts?: GenOptions): Record<string, AgentConfig> {
  const paths = opts?.projectRoot ? resolveGenPaths(opts.projectRoot) : getDefaultPaths();
  const configPath = opts?.configPath ?? paths.configPath;
  let raw: string;
  if (maybeRaw !== undefined) {
    raw = maybeRaw;
  } else {
    raw = readFileSync(configPath, "utf-8");
  }
  const agents = buildAgents(opts?.deleted, opts) as Record<string, unknown>;
  const existing = (() => {
    try {
      return readJsoncObject(raw).agent;
    } catch {
      return null;
    }
  })();
  const pinned = loadPinnedAgents(opts?.deletedPath ?? paths.deletedPath, opts?.pinsPath);
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    for (const [name, cfg] of Object.entries(existing as Record<string, unknown>)) {
      if (name in agents) {
        const existingCfg = cfg as { model?: string };
        const generatedCfg = agents[name] as { model?: string } | undefined;
        const retiredOverride =
          existingCfg && typeof existingCfg.model === "string" && RETIRED_MODEL_IDS.has(existingCfg.model);
        const legacyHeadOnBase =
          existingCfg &&
          typeof existingCfg.model === "string" &&
          !pinned.has(normalizeName(name)) &&
          (BASE_ORDER as readonly string[]).includes(name) &&
          existingCfg.model === LEGACY_UNIFIED_HEAD &&
          generatedCfg?.model !== undefined &&
          generatedCfg.model !== LEGACY_UNIFIED_HEAD;
        const addagentStale =
          name === "addagent" &&
          !pinned.has(normalizeName(name)) &&
          typeof existingCfg.model === "string" &&
          existingCfg.model === "opencode/mimo-v2.5-free" &&
          generatedCfg?.model === "opencode/big-pickle";
        if (
          existingCfg &&
          !retiredOverride &&
          !legacyHeadOnBase &&
          !addagentStale &&
          typeof existingCfg === "object" &&
          typeof existingCfg.model === "string" &&
          generatedCfg &&
          typeof generatedCfg.model === "string" &&
          existingCfg.model !== generatedCfg.model
        ) {
          agents[name] = cfg;
        }
        const merged = agents[name] as { permission?: { bash?: unknown } } | undefined;
        if (
          merged &&
          merged.permission &&
          typeof merged.permission.bash === "object" &&
          merged.permission.bash !== null &&
          !Array.isArray(merged.permission.bash)
        ) {
          const live = JSON.parse(JSON.stringify(BASH_READ_ONLY)) as Record<string, string>;
          if (JSON.stringify(merged.permission.bash) !== JSON.stringify(live)) {
            merged.permission.bash = live;
          }
        }
        if (
          (name === TAWA_AGENT || name === "addagent") &&
          merged &&
          merged.permission &&
          (typeof merged.permission.bash === "string" || merged.permission.bash === undefined)
        ) {
          merged.permission.bash = JSON.parse(JSON.stringify(BASH_READ_ONLY)) as Record<string, string>;
        }
        continue;
      }
      if (isGeneratedVariant(name, EXTEND_AGENTS)) continue;
      const dyn = cfg as { permission?: { bash?: unknown } };
      if (
        dyn &&
        dyn.permission &&
        typeof dyn.permission.bash === "object" &&
        dyn.permission.bash !== null &&
        !Array.isArray(dyn.permission.bash)
      ) {
        const live = JSON.parse(JSON.stringify(BASH_READ_ONLY)) as Record<string, string>;
        if (JSON.stringify(dyn.permission.bash) !== JSON.stringify(live)) {
          dyn.permission.bash = live;
        }
      }
      agents[name] = cfg;
    }
  }
  const addagentAgent = agents.addagent as { permission?: Record<string, unknown> } | undefined;
  if (addagentAgent && addagentAgent.permission && typeof addagentAgent.permission === "object") {
    addagentAgent.permission.addagent = "allow";
    addagentAgent.permission.kick = "allow";
  }
  const merged = agents as Record<string, AgentConfig>;
  grantTawaPluginTools(merged);
  grantRolePluginTools(merged);
  return merged;
}

export function buildExpectedConfig(maybeRaw?: string, opts?: GenOptions): string {
  const paths = opts?.projectRoot ? resolveGenPaths(opts.projectRoot) : getDefaultPaths();
  const configPath = opts?.configPath ?? paths.configPath;
  let raw: string;
  if (maybeRaw !== undefined) {
    raw = maybeRaw;
  } else {
    raw = readFileSync(configPath, "utf-8");
  }
  const agents = buildMergedAgents(raw, opts);
  return spliceAgentSection(raw, agents);
}

export function checkGeneratedConfig(raw?: string, opts?: GenOptions): { ok: boolean; diff?: string } {
  const paths = opts?.projectRoot ? resolveGenPaths(opts.projectRoot) : getDefaultPaths();
  const actualRaw = raw ?? readFileSync(paths.configPath, "utf-8");
  let actualObj: Record<string, unknown>;
  try {
    actualObj = readJsoncObject(actualRaw);
  } catch (e) {
    return { ok: false, diff: `failed to parse opencode.json: ${(e as Error).message}` };
  }
  const agentValue = (actualObj as Record<string, unknown>).agent;
  if (!agentValue || typeof agentValue !== "object" || Array.isArray(agentValue)) {
    const expectedAgents = buildMergedAgents(actualRaw, opts);
    const missing = Object.keys(expectedAgents);
    return { ok: false, diff: `missing agents: ${missing.join(", ")}` };
  }
  const actualAgents = agentValue as Record<string, unknown>;
  const expectedAgents = buildMergedAgents(actualRaw, opts);
  const pureAgents = buildAgents([], opts);
  const pinned = loadPinnedAgents(opts?.deletedPath ?? paths.deletedPath, opts?.pinsPath);
  const missing: string[] = [];
  const mismatched: string[] = [];
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = canon((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  for (const [name, expected] of Object.entries(expectedAgents)) {
    const actual = actualAgents[name] as { model?: string; mode?: string; permission?: unknown } | undefined;
    if (!actual || typeof actual !== "object") {
      missing.push(name);
      continue;
    }
    const pureModel = (pureAgents[name] as { model?: string } | undefined)?.model;
    if (actual.model !== pureModel && !pinned.has(normalizeName(name))) {
      mismatched.push(
        `${name}: model "${String(actual.model ?? "undefined")}" matches neither template ("${String(pureModel ?? "undefined")}") nor pins sidecar`,
      );
      continue;
    }
    if (actual.mode !== undefined && actual.mode !== expected.mode) {
      mismatched.push(`${name}: expected mode "${expected.mode}" vs actual "${String(actual.mode)}"`);
    }
    const expPerm = JSON.stringify(canon(expected.permission));
    const actPerm = JSON.stringify(canon(actual.permission));
    if (expPerm !== actPerm) {
      mismatched.push(`${name}: permission drift vs generated template`);
    }
  }
  let deletedList: readonly string[] = opts?.deleted ?? [];
  if (!opts?.deleted) {
    try {
      deletedList = readDeletedAgents(opts?.deletedPath ?? paths.deletedPath);
    } catch {
      deletedList = [];
    }
  }
  const deletedSet = new Set(deletedList.map((s) => normalizeName(String(s))));
  const resurrected = Object.keys(actualAgents).filter(
    (name) => deletedSet.has(normalizeName(name)) && isGeneratedVariant(name, EXTEND_AGENTS),
  );
  if (missing.length === 0 && mismatched.length === 0 && resurrected.length === 0) return { ok: true };
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing agents: ${missing.join(", ")}`);
  if (mismatched.length > 0) parts.push(`model mismatches: ${mismatched.join("; ")}`);
  if (resurrected.length > 0)
    parts.push(
      `resurrected deleted variants: ${resurrected.join(", ")} (present in deleted-agents.json but found in opencode.json)`,
    );
  return { ok: false, diff: parts.join("\n") };
}

function cliProjectRoot(): string | undefined {
  const idx = process.argv.indexOf("--project");
  if (idx !== -1 && process.argv[idx + 1] !== undefined) return resolve(process.argv[idx + 1]!);
  return undefined;
}

function cliOpts(): GenOptions {
  const root = cliProjectRoot();
  return root ? { projectRoot: root } : {};
}

function cliScope(): "global" | "project" {
  const idx = process.argv.indexOf("--scope");
  if (idx !== -1 && process.argv[idx + 1] === "global") return "global";
  return "project";
}

async function withCliConfigLock(anchor: string, fn: () => Promise<void>): Promise<boolean> {
  const { acquired, lockName, owner } = await acquireOpencodeConfigLock(anchor);
  if (!acquired) {
    logger.error(
      `[gen-opencode-config] REFUSED: config write lock busy for ${anchor} — ` +
        `an opencode session may be writing; close sessions or retry`,
    );
    return false;
  }
  try {
    await fn();
    return true;
  } finally {
    try {
      await releaseFSLock(lockName, owner);
    } catch {
      void 0;
    }
  }
}

async function main(): Promise<void> {
  const opts = cliOpts();
  if (cliScope() === "global") {
    const paths = globalGenPaths();
    const rejection = refuseGlobalTarget(paths.configPath);
    if (rejection) {
      logger.error(`[gen-opencode-config] REFUSED: ${rejection}`);
      process.exitCode = 1;
      return;
    }
    const locked = await withCliConfigLock(resolveTawassulConfigPath(process.cwd(), "global"), async () => {
      const rosterIn = buildGlobalRoster();
      const expectedIn = derivedExpectedCount(rosterIn.deleted);
      if (Object.keys(rosterIn.agents).length < expectedIn) {
        throw new Error(
          `[gen-opencode-config] FATAL (in-lock): global roster agent count ${Object.keys(rosterIn.agents).length} ` +
            `< derived expectation ${expectedIn}`,
        );
      }
      await writeTawassulRoster(paths.configPath, rosterIn);
      const verify = checkGlobalRoster();
      if (!verify.ok) {
        throw new Error(`[gen-opencode-config] post-write global verify FAILED — ${verify.diff ?? ""}`);
      }
      logger.warn(
        `[gen-opencode-config] global roster regenerated at ${paths.configPath} with ` +
          `${Object.keys(rosterIn.agents).length} agents (${rosterIn.deleted.length} deleted variant(s) skipped)`,
      );
    });
    if (!locked) {
      process.exitCode = 1;
      return;
    }
    return;
  }
  const paths = opts.projectRoot ? resolveGenPaths(opts.projectRoot) : getDefaultPaths();

  const rejection = refuseProjectTarget(paths.configPath);
  if (rejection) {
    logger.error(`[gen-opencode-config] REFUSED: ${rejection}`);
    process.exitCode = 1;
    return;
  }

  const deleted = unionDeletedVariants(readDeletedAgents(paths.deletedPath));
  const agents = buildAgents(deleted, opts);
  const count = Object.keys(agents).length;
  const expected = derivedExpectedCount(deleted);
  if (count !== expected) {
    logger.error(
      `[gen-opencode-config] FATAL: agent count ${count} != derived expectation ${expected} ` +
        `(BASE_ORDER=${BASE_ORDER.length}, EXTEND_AGENTS=${EXTEND_AGENTS.length}, ` +
        `suffixes=${Object.keys(MODEL_SUFFIX_MAP).length}, deleted=${deleted.length})`,
    );
    process.exitCode = 1;
    return;
  }

  const locked = await withCliConfigLock(dirname(paths.configPath), async () => {
    const deletedIn = unionDeletedVariants(readDeletedAgents(paths.deletedPath));
    const agentsIn = buildAgents(deletedIn, opts);
    const countIn = Object.keys(agentsIn).length;
    const expectedIn = derivedExpectedCount(deletedIn);
    if (countIn !== expectedIn) {
      throw new Error(
        `[gen-opencode-config] FATAL (in-lock): agent count ${countIn} != derived expectation ${expectedIn}`,
      );
    }
    const expectedTextIn = buildExpectedConfig(undefined, opts);
    await atomicWriteFile(paths.configPath, expectedTextIn);
    const verify = checkGeneratedConfig(undefined, opts);
    if (!verify.ok) {
      throw new Error(`[gen-opencode-config] post-write verify FAILED — ${verify.diff ?? ""}`);
    }
    logger.warn(
      `[gen-opencode-config] opencode.json regenerated with ${countIn} agents ` +
        `(${deletedIn.length} deleted variant(s) skipped)`,
    );
  });
  if (!locked) {
    process.exitCode = 1;
    return;
  }
}

function runCheck(): void {
  const opts = cliOpts();
  if (cliScope() === "global") {
    const result = checkGlobalRoster();
    if (result.ok) {
      logger.warn("[gen-opencode-config] --check: global roster is up to date ✔");
      process.exitCode = 0;
      return;
    }
    logger.error(`[gen-opencode-config] --check FAILED — ${result.diff ?? ""}`);
    process.exitCode = 1;
    return;
  }
  const result = checkGeneratedConfig(undefined, opts);
  if (result.ok) {
    logger.warn("[gen-opencode-config] --check: opencode.json is up to date ✔");
    process.exitCode = 0;
    return;
  }
  logger.error(
    `[gen-opencode-config] --check FAILED — opencode.json is out of sync with the generators:\n${result.diff ?? ""}`,
  );
  process.exitCode = 1;
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  if (process.argv.includes("--check")) {
    runCheck();
  } else {
    void main().catch((e) => {
      logger.error(`[gen-opencode-config] failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    });
  }
}
