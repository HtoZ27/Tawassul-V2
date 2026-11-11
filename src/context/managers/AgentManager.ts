import { constants, existsSync, readFileSync, statSync } from "node:fs";
import { access, readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { atomicWriteFile } from "../../utils/atomic.ts";
import type { TawassulConfig, EvaluationConfig } from "../types.ts";
import {
  AGENTS_DEFAULT,
  SUGGESTED_HANDOFFS_DEFAULT,
  MAX_RECORDS_DEFAULT,
  MAX_HANDOFFS_DEFAULT,
  MAX_COMPACT_ITEMS_DEFAULT,
  EVALUATION_DEFAULTS,
  AGENTS_MD_DEFAULT,
} from "../constants.ts";
import { generateAgentMd, ALL_AGENTS } from "../../agent-templates.ts";
import { normalizeName } from "../../utils/name-utils.ts";
import type { AgentTemplate } from "../../agent-templates.ts";
import type { BashPerm } from "../../permissions.ts";
import { logger } from "../../utils/logger.ts";
import type { TimerManagerLike } from "../../types/timer-types.ts";
import { detectInstallScope } from "../../core/install-scope.ts";
import {
  resolveAgentsDir,
  resolveActiveConfigPath,
  resolveTawassulConfigPath,
  type InstallScope,
} from "../../utils/path-resolver.ts";
import { readTawassulRoster, stripJsoncComments, readJsoncObject } from "../../utils/opencode-config.ts";
import { generatedVariantNames } from "../../core/variant-names.ts";
import { setDynamicDeletedAgents, setUserPreservedAgents, pruneUserPreservedAgents } from "../../security-policy.ts";

export class AgentManager {
  dynamicAgents: string[] = [];
  config: TawassulConfig = {};
  private stateDir: string;
  private timers: TimerManagerLike | null = null;
  private scope: InstallScope;

  private _opencodeAgentsCache: { result: string[]; ts: number } | null = null;
  private _agentMdCache = new Map<
    string,
    { result: { name?: string; role?: string; capability?: string; responsibilities?: string[] } | null; ts: number }
  >();
  private static CACHE_TTL_MS = 30_000;

  private _deletedRosterCache: Set<string> | null = null;
  private _deletedRosterCacheAt = 0;
  private _deletedRosterCacheMtime = -1;
  private _deletedRosterCachePath = "";
  private _deletedRosterCacheSize = -1;
  private static DELETED_ROSTER_TTL_MS = 15_000;

  private _refreshTimer: ReturnType<typeof setInterval> | null = null;
  private static REFRESH_INTERVAL_MS = 25_000;
  private _refreshCounter = 0;
  private _refreshInProgress = false;

  private _opencodeWarmInFlight = false;

  constructor(stateDir: string, timers?: TimerManagerLike, scope?: InstallScope) {
    this.stateDir = stateDir;
    this.timers = timers ?? null;
    this.scope = scope ?? detectInstallScope(import.meta.url);
    this.deletedRoster();
    this._kickOpencodeWarm();
    const fn = () => this._refreshCache();
    this._refreshTimer = this.timers
      ? this.timers.setInterval(fn, AgentManager.REFRESH_INTERVAL_MS)
      : (() => {
          const t = setInterval(fn, AgentManager.REFRESH_INTERVAL_MS);
          if (t?.unref) t.unref();
          return t;
        })();
  }

  private _kickOpencodeWarm(): void {
    if (this._opencodeWarmInFlight) return;
    this._opencodeWarmInFlight = true;
    void this._refreshOpencodeJsonAgents().finally(() => {
      this._opencodeWarmInFlight = false;
    });
  }

  private async _refreshCache(): Promise<void> {
    if (this._refreshInProgress) return;
    this._refreshInProgress = true;
    try {
      const t0 = performance.now();
      await this._refreshOpencodeJsonAgents();
      const agents = this._opencodeAgentsCache?.result ?? [];
      const chunk = 5;
      for (let i = 0; i < agents.length; i += chunk) {
        await Promise.allSettled(agents.slice(i, i + chunk).map((tag) => this._refreshAgentMd(tag)));
      }
      const ms = (performance.now() - t0).toFixed(1);
      if (this._refreshCounter++ % 6 === 0) {
        logger.debug(`[AgentManager] cache refreshed in ${ms}ms (${agents.length} agents)`);
      }
    } catch (e) {
      logger.debug("Background cache refresh failed:", e);
    } finally {
      this._refreshInProgress = false;
    }
  }

  private async _refreshOpencodeJsonAgents(): Promise<void> {
    try {
      if (this.scope === "global") {
        const rosterPath = resolveTawassulConfigPath(this.stateDir, "global");
        if (!existsSync(rosterPath)) return;
        const { roster } = readTawassulRoster(rosterPath);
        const result = Object.keys(roster.agents)
          .filter((name) => name !== "tawa" && name !== "addagent")
          .map((name) => `@${name}`);
        this._opencodeAgentsCache = { result, ts: Date.now() };
        setUserPreservedAgents(Object.keys(roster.agents));
        return;
      }
      const opencodePath = resolveActiveConfigPath(this.stateDir);
      const content = await readFile(opencodePath, "utf-8");
      const parsed = JSON.parse(stripJsoncComments(content));
      if (parsed.agent && typeof parsed.agent === "object") {
        const result = Object.keys(parsed.agent)
          .filter((name) => name !== "tawa" && name !== "addagent")
          .map((name) => `@${name}`);
        this._opencodeAgentsCache = { result, ts: Date.now() };
        setUserPreservedAgents(Object.keys(parsed.agent));
      }
    } catch {
    }
  }

  private async _refreshAgentMd(tag: string): Promise<void> {
    const name = normalizeName(tag);
    const finalName = this.sanitizeAgentName(name);
    if (finalName === null) return;
    const mdPath = resolve(this.agentsDir(), `${finalName}.md`);
    try {
      const content = await readFile(mdPath, "utf-8");
      const result = this.parseAgentMdFrontmatter(content);
      this._agentMdCache.set(tag, { result, ts: Date.now() });
    } catch {
    }
  }

  stopRefresh(): void {
    if (this._refreshTimer) {
      if (this.timers) this.timers.clear(this._refreshTimer);
      else clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  getAgents(): string[] {
    const allSources = [
      ...AGENTS_DEFAULT,
      ...(this.config.team ?? []),
      ...this.dynamicAgents,
      ...this.readOpencodeJsonAgents(),
    ];

    const unique = [...new Set(allSources)];

    const opencodeAgents = new Set(this.readOpencodeJsonAgents());
    const deleted = this.deletedRoster();
    const verified = unique.filter((tag) => {
      if (deleted.has(normalizeName(tag))) return false;
      if (opencodeAgents.has(tag)) return true;
      if (this.dynamicAgents.includes(tag)) return true;
      if ((this.config.team ?? []).includes(tag)) return true;
      const mdExists = this.readAgentMd(tag) !== null;
      return mdExists;
    });

    return verified;
  }

  private readOpencodeJsonAgents(): string[] {
    const now = Date.now();
    const cached = this._opencodeAgentsCache;
    if (cached) {
      return cached.result;
    }
    try {
      if (this.scope === "global") {
        const rosterPath = resolveTawassulConfigPath(this.stateDir, "global");
        if (!existsSync(rosterPath)) return [];
        const { roster } = readTawassulRoster(rosterPath);
        const result = Object.keys(roster.agents)
          .filter((name) => name !== "tawa" && name !== "addagent")
          .map((name) => `@${name}`);
        this._opencodeAgentsCache = { result, ts: now };
        setUserPreservedAgents(Object.keys(roster.agents));
        return result;
      }
      this._kickOpencodeWarm();
      return this._opencodeAgentsCache?.result ?? [];
    } catch {
    }
    return [];
  }

  getMaxRecords(): number {
    return this.config.maxRecords ?? MAX_RECORDS_DEFAULT;
  }

  hasConfigAgent(name: string): boolean {
    const normalized = normalizeName(name);
    return this.readOpencodeJsonAgents().some((tag) => normalizeName(tag) === normalized);
  }

  getMaxHandoffs(): number {
    return this.config.maxHandoffs ?? MAX_HANDOFFS_DEFAULT;
  }

  getMaxCompactItems(): number {
    return this.config.maxCompactItems ?? MAX_COMPACT_ITEMS_DEFAULT;
  }

  getSuggestedHandoffs(): Record<string, string[]> {
    return this.config.suggestedHandoffs ?? SUGGESTED_HANDOFFS_DEFAULT;
  }

  getEvalConfig(): EvaluationConfig {
    const ec = this.config.agentEvaluation;
    if (!ec) return { ...EVALUATION_DEFAULTS };
    return { ...EVALUATION_DEFAULTS, ...ec };
  }

  parseAgentMdFrontmatter(md: string): {
    name?: string;
    role?: string;
    capability?: string;
    responsibilities?: string[];
  } {
    const m = md.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const result: Record<string, string> = {};
    const responsibilities: string[] = [];
    let inResponsibilities = false;

    let inPermissionBlock = false;

    for (const rawLine of m[1]!.split("\n")) {
      const line = rawLine.trimEnd();

      if (line === "") continue;

      if (inPermissionBlock) {
        if (/^\w+:/.test(line)) {
          inPermissionBlock = false;
        } else {
          continue;
        }
      }

      if (inResponsibilities) {
        const listItem = line.match(/^\s+-\s+(.*)$/);
        if (listItem) {
          responsibilities.push(
            listItem[1]!
              .trim()
              .replace(/^"(.*)"$/, "$1")
              .replace(/^'(.*)'$/, "$1"),
          );
          continue;
        }
        inResponsibilities = false;
      }

      if (/^permission:/.test(line)) {
        inPermissionBlock = true;
        continue;
      }

      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) {
        result[kv[1]!] = kv[2]!
          .trim()
          .replace(/^"(.*)"$/, "$1")
          .replace(/^'(.*)'$/, "$1");
        if (kv[1] === "responsibilities") inResponsibilities = true;
      }
    }
    return {
      name: result.name,
      role: result.role,
      capability: result.capability,
      responsibilities: responsibilities.length > 0 ? responsibilities : undefined,
    };
  }

  private sanitizeAgentName(raw: string): string | null {
    let name: string;
    try {
      name = decodeURIComponent(raw);
    } catch {
      name = raw;
    }
    const SAFE_PATTERN = /^[a-zA-Z0-9_\-.@]+$/;
    if (!SAFE_PATTERN.test(name)) return null;
    const normalized = name.replace(/\\/g, "/");
    if (normalized.includes("..") || normalized.includes("/") || normalized.includes("\0")) return null;
    return name;
  }

  private agentsDir(): string {
    return resolveAgentsDir(this.stateDir, this.scope);
  }

  private deletedRoster(): Set<string> {
    const now = Date.now();
    const srcPath =
      this.scope === "global"
        ? resolveTawassulConfigPath(this.stateDir, "global")
        : resolveActiveConfigPath(this.stateDir, "project");
    let mtime = -1;
    let size = -1;
    try {
      const st = statSync(srcPath);
      mtime = st.mtimeMs;
      size = st.size;
    } catch {
      mtime = -1;
      size = -1;
    }
    if (
      this._deletedRosterCache &&
      now - this._deletedRosterCacheAt < AgentManager.DELETED_ROSTER_TTL_MS &&
      this._deletedRosterCacheMtime === mtime &&
      this._deletedRosterCachePath === srcPath &&
      this._deletedRosterCacheSize === size
    ) {
      return this._deletedRosterCache;
    }
    const recordEmpty = (resetProcessSet: boolean): Set<string> => {
      const empty = new Set<string>();
      this._deletedRosterCache = empty;
      this._deletedRosterCacheAt = now;
      this._deletedRosterCacheMtime = mtime;
      this._deletedRosterCachePath = srcPath;
      this._deletedRosterCacheSize = size;
      if (resetProcessSet) {
        setDynamicDeletedAgents([]);
        pruneUserPreservedAgents([]);
      }
      return empty;
    };
    try {
      let deleted: Set<string>;
      if (this.scope === "global") {
        if (!existsSync(srcPath)) return recordEmpty(true);
        const raw = readTawassulRoster(srcPath).roster.deleted;
        deleted = new Set(raw.map((s) => normalizeName(String(s))));
      } else {
        if (!existsSync(srcPath)) return recordEmpty(true);
        const rawContent = readFileSync(srcPath, "utf-8");
        let parsed: Record<string, unknown>;
        try {
          parsed = readJsoncObject(rawContent);
        } catch {
          return recordEmpty(false);
        }
        const agent = parsed.agent;
        if (agent === undefined || agent === null) return recordEmpty(true);
        if (typeof agent !== "object" || Array.isArray(agent)) return recordEmpty(true);
        const keys = Object.keys(agent as Record<string, unknown>);
        if (keys.length === 0) return recordEmpty(true);
        const present = new Set(keys.map((s) => normalizeName(String(s))));
        const bases = ALL_AGENTS.filter((a) => a.name !== "tawa").map((a) => a.name);
        deleted = new Set(
          generatedVariantNames(bases).filter((name) => !present.has(normalizeName(name))),
        );
      }
      setDynamicDeletedAgents([...deleted]);
      pruneUserPreservedAgents([...deleted]);
      this._deletedRosterCache = deleted;
      this._deletedRosterCacheAt = now;
      this._deletedRosterCacheMtime = mtime;
      this._deletedRosterCachePath = srcPath;
      this._deletedRosterCacheSize = size;
      return deleted;
    } catch {
      return new Set();
    }
  }

  readAgentMd(tag: string): { name?: string; role?: string; capability?: string; responsibilities?: string[] } | null {
    const now = Date.now();
    const cached = this._agentMdCache.get(tag);
    if (cached && now - cached.ts < AgentManager.CACHE_TTL_MS) {
      return cached.result;
    }
    const name = normalizeName(tag);
    const finalName = this.sanitizeAgentName(name);
    if (finalName === null) return null;
    const mdPath = resolve(this.agentsDir(), `${finalName}.md`);
    if (!existsSync(mdPath)) return null;
    try {
      const t0 = performance.now();
      const content = readFileSync(mdPath, "utf-8");
      const result = this.parseAgentMdFrontmatter(content);
      const ms = (performance.now() - t0).toFixed(1);
      logger.debug(`[AgentManager] read ${finalName}.md in ${ms}ms (cache miss)`);
      this._agentMdCache.set(tag, { result, ts: now });
      return result;
    } catch {
      return null;
    }
  }

  async ensureAgentsDir(): Promise<string> {
    const dir = this.agentsDir();
    try {
      await access(dir, constants.F_OK);
    } catch {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    }
    return dir;
  }

  clearReadCache(): void {
    this._opencodeAgentsCache = null;
    this._agentMdCache.clear();
    this._deletedRosterCache = null;
    this._deletedRosterCacheAt = 0;
    this._deletedRosterCacheMtime = -1;
    this._deletedRosterCachePath = "";
    this._deletedRosterCacheSize = -1;
    this._kickOpencodeWarm();
  }

  private async atomicWriteFile(filePath: string, content: string): Promise<void> {
    await atomicWriteFile(filePath, content, { backup: true });
  }

  async ensureDefaultAgentMds(): Promise<void> {
    try {
      const dir = await this.ensureAgentsDir();
      let changed = false;
      for (const [tag, content] of Object.entries(AGENTS_MD_DEFAULT)) {
        const name = normalizeName(tag);
        const mdPath = resolve(dir, `${name}.md`);
        try {
          await access(mdPath, constants.F_OK);
        } catch {
          try {
            await this.atomicWriteFile(mdPath, content);
            changed = true;
          } catch (e) {
            logger.warn(`Failed to write agent md ${name}:`, e);
          }
          continue;
        }
        try {
          const existing = await readFile(mdPath, "utf-8");
          if (!existing.includes("### Responsibilities") || !existing.includes("\nresponsibilities:")) {
            await this.atomicWriteFile(mdPath, content);
            changed = true;
            logger.debug(`Updated ${name}.md with responsibilities section`);
          }
        } catch (e) {
          logger.warn(`Failed to check/update agent md ${name}:`, e);
        }
      }
      if (changed) this.clearReadCache();
    } catch (e) {
      logger.warn("ensureDefaultAgentMds failed:", e);
    }
  }

  async writeAgentMd(
    tag: string,
    role?: string,
    responsibilities?: string[],
    capability?: string,
    description?: string,
    permissions?: {
      edit: string | Record<string, string>;
      bash: BashPerm;
      external_directory?: string;
      task?: string | Record<string, string>;
    },
    model?: string,
  ): Promise<void> {
    try {
      const rawName = normalizeName(tag);
      const finalName = this.sanitizeAgentName(rawName);
      if (finalName === null) {
        logger.warn(`Rejected malicious agent name: ${tag}`);
        throw new Error(`Rejected malicious agent name: ${tag}`);
      }
      const dir = await this.ensureAgentsDir();

      const synthTemplate: AgentTemplate = {
        name: finalName,
        role: role ?? "",
        capability: capability ?? "",
        description: description ?? `${tag} agent`,
        mode: "subagent",
        permissions: permissions ?? { edit: "ask", bash: "ask" },
        responsibilities: responsibilities ?? [],
        instructions: [
          `You are **${tag}**, an automated agent in the Tawassul team.`,
          role ? `Your role: ${role}` : "",
          capability ? `Your capabilities: ${capability}` : "",
          "",
          "### Mode Awareness",
          "- **Plan mode**: Record decisions, do not modify files",
          "- **Build mode**: Execute changes",
          "",
          "### ⚠️ Return your result — do NOT delegate the task",
          "- Your task/handoff tools are restricted to explore/general (read/reports) only — any distribution of execution work is rejected.",
          "- Execute the task with your available tools. Do not hand off to an analyst or another agent as delegation.",
          "- If you need reconnaissance, call task() only for @explore or @general where your role allows it.",
          "- When the model fails or is unable to:",
          '  1. Save a note via record(type: "note") with what was completed and what remains',
          "  2. Return the result or the incomplete item to your caller — do not delegate to any other agent",
          "  3. State what was accomplished and what remains",
          "- If the configured model is unavailable:",
          "  - Continue with the current model but note any limitations",
          "  - If the task requires capabilities beyond your current model, return it to your caller as a documented note",
        ]
          .filter(Boolean)
          .join("\n"),
      };

      const md = generateAgentMd(synthTemplate, model);
      await this.atomicWriteFile(resolve(dir, `${finalName}.md`), md);
      this.clearReadCache();
    } catch (e) {
      logger.warn(`writeAgentMd failed for ${tag}:`, e);
      throw e;
    }
  }
}
