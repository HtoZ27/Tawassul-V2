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
import {
  SecurityPolicy,
  setDynamicDeletedAgents,
  setUserPreservedAgents,
  pruneUserPreservedAgents,
} from "../../security-policy.ts";
import type { RosterPrewarmResult } from "../../plugin-types.ts";

const BASE_ROLE_NAMES: readonly string[] = ALL_AGENTS.filter((agent) => agent.name !== "tawa").map((agent) => agent.name);
const BASE_ROLE_SET: ReadonlySet<string> = new Set(BASE_ROLE_NAMES.map((name) => normalizeName(name)));

type RosterTrustEntry = {
  completeKeys: Set<string> | null;
  lastDeleted: Set<string> | null;
};

const rosterTrustByPath = new Map<string, RosterTrustEntry>();
const rosterWarnings = new Map<string, Set<string>>();

function warnRosterOnce(path: string, reason: string, message: string): void {
  const reasons = rosterWarnings.get(path) ?? new Set<string>();
  if (reasons.has(reason)) return;
  reasons.add(reason);
  rosterWarnings.set(path, reasons);
  logger.warn(message);
}

function clearRosterWarnings(path: string): void {
  rosterWarnings.delete(path);
}

export class AgentManager {
  dynamicAgents: string[] = [];
  config: TawassulConfig = {};
  private stateDir: string;
  private timers: TimerManagerLike | null = null;
  private scope: InstallScope;

  private _opencodeAgentsCache: { result: string[]; ts: number } | null = null;
  private _opencodeAgentsLastGood: string[] | null = null;
  private _opencodeAgentModels = new Map<string, string>();
  private _lastRosterEvaluation: { complete: boolean; empty: boolean; truncated: boolean; path: string } | null = null;
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

  private _opencodeWarmPromise: Promise<void> | null = null;
  private _opencodeWarmGeneration = -1;
  private _opencodeCommitGeneration = -1;
  private _opencodeCommitSequence = -1;
  private _rosterGeneration = 0;
  private _rosterReadSequence = 0;

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

  private _startOpencodeWarm(): Promise<void> {
    const generation = this._rosterGeneration;
    const sequence = ++this._rosterReadSequence;
    const warm = this._refreshOpencodeJsonAgents(generation, sequence).finally(() => {
      if (this._opencodeWarmPromise === warm) this._opencodeWarmPromise = null;
    });
    this._opencodeWarmPromise = warm;
    this._opencodeWarmGeneration = generation;
    return warm;
  }

  private _kickOpencodeWarm(): Promise<void> {
    const pending = this._opencodeWarmPromise;
    if (pending && this._opencodeWarmGeneration >= this._rosterGeneration) return pending;
    return this._startOpencodeWarm();
  }

  private async _refreshCache(): Promise<void> {
    if (this._refreshInProgress) return;
    this._refreshInProgress = true;
    try {
      const t0 = performance.now();
      await this._refreshOpencodeJsonAgents(this._rosterGeneration, ++this._rosterReadSequence);
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

  private _canCommit(generation: number, sequence: number): boolean {
    return generation >= this._rosterGeneration && sequence >= this._opencodeCommitSequence;
  }

  private _modelsFromEntries(entries: Iterable<[string, unknown]>): Map<string, string> {
    const models = new Map<string, string>();
    for (const [name, cfg] of entries) {
      if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
        const model = (cfg as { model?: unknown }).model;
        if (typeof model === "string" && model.length > 0) models.set(normalizeName(name), model);
      }
    }
    return models;
  }

  private _commitRoster(
    result: string[],
    models: Map<string, string>,
    generation: number,
    sequence: number,
    complete: boolean,
    empty: boolean,
    path: string,
  ): void {
    this._opencodeAgentsCache = { result, ts: Date.now() };
    this._opencodeAgentsLastGood = result;
    this._opencodeAgentModels = models;
    this._opencodeCommitGeneration = generation;
    this._opencodeCommitSequence = sequence;
    this._lastRosterEvaluation = { complete, empty, truncated: false, path };
  }

  private async _refreshOpencodeJsonAgents(generation: number, sequence: number): Promise<void> {
    if (this.scope === "global") {
      const rosterPath = resolveTawassulConfigPath(this.stateDir, "global");
      try {
        if (!existsSync(rosterPath)) {
          logger.debug(`[AgentManager] global roster missing at ${rosterPath}; keeping the last known list`);
          return;
        }
        const { roster } = readTawassulRoster(rosterPath);
        const result = Object.keys(roster.agents)
          .filter((name) => name !== "tawa" && name !== "addagent")
          .map((name) => `@${name}`);
        const models = this._modelsFromEntries(Object.entries(roster.agents));
        if (!this._canCommit(generation, sequence)) return;
        this._opencodeAgentsCache = { result, ts: Date.now() };
        this._opencodeAgentsLastGood = result;
        this._opencodeAgentModels = models;
        this._opencodeCommitGeneration = generation;
        this._opencodeCommitSequence = sequence;
        this._lastRosterEvaluation = {
          complete: result.length > 0,
          empty: result.length === 0,
          truncated: false,
          path: rosterPath,
        };
        setUserPreservedAgents(Object.keys(roster.agents));
        clearRosterWarnings(rosterPath);
      } catch (e) {
        warnRosterOnce(
          rosterPath,
          "unreadable",
          `[AgentManager] failed to read the global roster at ${rosterPath}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      return;
    }
    const opencodePath = resolveActiveConfigPath(this.stateDir);
    let content: string;
    try {
      content = await readFile(opencodePath, "utf-8");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        logger.debug(`[AgentManager] roster missing at ${opencodePath}; keeping the last known list`);
      } else {
        logger.warn(
          `[AgentManager] failed to read the roster at ${opencodePath}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (!this._canCommit(generation, sequence)) return;
      if (!this._opencodeAgentsCache) {
        this._opencodeAgentsCache = { result: this._opencodeAgentsLastGood ?? [], ts: Date.now() };
        this._opencodeCommitGeneration = generation;
        this._opencodeCommitSequence = sequence;
      }
      this._lastRosterEvaluation = {
        complete: false,
        empty: (this._opencodeAgentsCache?.result.length ?? 0) === 0,
        truncated: false,
        path: opencodePath,
      };
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stripJsoncComments(content)) as Record<string, unknown>;
    } catch (e) {
      warnRosterOnce(
        opencodePath,
        "unreadable",
        `[AgentManager] malformed roster at ${opencodePath}; keeping the last known list: ${e instanceof Error ? e.message : String(e)}`,
      );
      if (!this._canCommit(generation, sequence)) return;
      if (!this._opencodeAgentsCache) {
        this._opencodeAgentsCache = { result: this._opencodeAgentsLastGood ?? [], ts: Date.now() };
        this._opencodeCommitGeneration = generation;
        this._opencodeCommitSequence = sequence;
      }
      this._lastRosterEvaluation = {
        complete: false,
        empty: (this._opencodeAgentsCache?.result.length ?? 0) === 0,
        truncated: false,
        path: opencodePath,
      };
      return;
    }
    if (!this._canCommit(generation, sequence)) return;
    const agent = parsed.agent;
    if (agent === undefined || agent === null || typeof agent !== "object" || Array.isArray(agent)) {
      this._commitRoster([], new Map(), generation, sequence, false, true, opencodePath);
      return;
    }
    const entries = Object.entries(agent as Record<string, unknown>);
    const keys = entries.map(([name]) => name);
    const evaluation = this._evaluateRosterTrust(opencodePath, keys);
    if (evaluation.truncated) {
      this._lastRosterEvaluation = { complete: false, empty: false, truncated: true, path: opencodePath };
      warnRosterOnce(
        opencodePath,
        "truncated",
        `[AgentManager] roster at ${opencodePath} looks truncated (${keys.length} keys, ${evaluation.previousCount} previously); keeping the last known list`,
      );
      if (this._opencodeAgentsLastGood) {
        this._opencodeAgentsCache = { result: this._opencodeAgentsLastGood, ts: Date.now() };
      }
      return;
    }
    const result = keys.filter((name) => name !== "tawa" && name !== "addagent").map((name) => `@${name}`);
    const models = this._modelsFromEntries(entries);
    const empty = keys.length === 0;
    this._commitRoster(result, models, generation, sequence, evaluation.complete, empty, opencodePath);
    if (evaluation.complete) {
      clearRosterWarnings(opencodePath);
    } else if (!empty) {
      warnRosterOnce(
        opencodePath,
        "incomplete",
        `[AgentManager] roster at ${opencodePath} is incomplete (missing ${evaluation.missingBases.join(", ")}); routing keeps the last trusted set`,
      );
    } else {
      logger.debug(`[AgentManager] roster at ${opencodePath} is the intentional empty container; expansion is pending`);
    }
    if (empty || evaluation.complete) setUserPreservedAgents(keys);
  }

  private _evaluateRosterTrust(
    configPath: string,
    keys: string[],
  ): { complete: boolean; truncated: boolean; missingBases: string[]; previousCount: number } {
    const present = new Set(keys.map((name) => normalizeName(name)));
    const missingBases = [...BASE_ROLE_SET].filter((name) => !present.has(name));
    const entry = rosterTrustByPath.get(configPath) ?? { completeKeys: null, lastDeleted: null };
    const previousCount = entry.completeKeys?.size ?? 0;
    const empty = keys.length === 0;
    let truncated = false;
    if (!empty && entry.completeKeys) {
      const expectedDeleted = [...entry.completeKeys].filter(
        (name) => !present.has(name) && SecurityPolicy.checkDeletedAgent(name),
      ).length;
      if (keys.length < entry.completeKeys.size - expectedDeleted) truncated = true;
    }
    if (truncated) {
      rosterTrustByPath.set(configPath, entry);
      return { complete: false, truncated: true, missingBases, previousCount };
    }
    if (missingBases.length === 0) {
      entry.completeKeys = present;
      rosterTrustByPath.set(configPath, entry);
      return { complete: true, truncated: false, missingBases, previousCount };
    }
    rosterTrustByPath.set(configPath, entry);
    return { complete: false, truncated: false, missingBases, previousCount };
  }

  private _activeConfigPath(): string {
    return this.scope === "global"
      ? resolveTawassulConfigPath(this.stateDir, "global")
      : resolveActiveConfigPath(this.stateDir, "project");
  }

  private _rosterResult(startedAt: number, timedOut: boolean): RosterPrewarmResult {
    const evaluation = this._lastRosterEvaluation;
    const count = this._opencodeAgentsCache?.result.length ?? 0;
    const populated = count > 0;
    const complete = evaluation?.complete === true;
    const configPath = evaluation?.path ?? this._activeConfigPath();
    const specificWarning = rosterWarnings.get(configPath);
    const explained = specificWarning?.has("truncated") === true || specificWarning?.has("incomplete") === true;
    if (!timedOut && !complete && evaluation?.empty !== true && !explained) {
      warnRosterOnce(
        configPath,
        "prewarm",
        `[AgentManager] roster prewarm incomplete at ${configPath} (populated=${populated}); routing continues with whatever is available`,
      );
    }
    return {
      populated,
      complete,
      count,
      elapsedMs: Math.round(performance.now() - startedAt),
      configPath,
      timedOut,
    };
  }

  async prewarmRoster(boundMs = 2000): Promise<RosterPrewarmResult> {
    const startedAt = performance.now();
    const bound = Math.max(1, Math.floor(boundMs));
    const generation = this._rosterGeneration;
    const pending = this._opencodeWarmPromise;
    if (!pending && this._opencodeAgentsCache && this._opencodeCommitGeneration >= generation) {
      return this._rosterResult(startedAt, false);
    }
    const warm = pending ?? this._startOpencodeWarm();
    let timedOut = false;
    await Promise.race([
      warm,
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          timedOut = true;
          resolve();
        }, bound);
        if (timer.unref) timer.unref();
      }),
    ]);
    if (timedOut) {
      const configPath = this._activeConfigPath();
      warnRosterOnce(
        configPath,
        "slow",
        `[AgentManager] roster prewarm exceeded the ${bound}ms bound at ${configPath}; the read continues in the background`,
      );
      void warm.then(() => {
        const evaluation = this._lastRosterEvaluation;
        logger.warn(
          `[AgentManager] roster prewarm landed late after ${Math.round(performance.now() - startedAt)}ms at ` +
            `${evaluation?.path ?? configPath} (populated=${(this._opencodeAgentsCache?.result.length ?? 0) > 0}, complete=${evaluation?.complete === true})`,
        );
      });
    }
    return this._rosterResult(startedAt, timedOut);
  }

  rosterReadCount(): number {
    return this._rosterReadSequence;
  }

  getConfiguredAgentNames(): string[] {
    return this.readOpencodeJsonAgents().map((tag) => normalizeName(tag));
  }

  getRosterModel(tag: string): string | undefined {
    return this._opencodeAgentModels.get(normalizeName(tag));
  }

  getRosterTrustReport(): Array<{ path: string; complete: boolean; lastTrusted: number }> {
    const active = this._activeConfigPath();
    const entry = rosterTrustByPath.get(active);
    if (!entry) return [];
    return [{ path: active, complete: entry.completeKeys !== null, lastTrusted: entry.lastDeleted?.size ?? 0 }];
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
    if (this.scope === "global") {
      const rosterPath = resolveTawassulConfigPath(this.stateDir, "global");
      if (!existsSync(rosterPath)) return this._opencodeAgentsLastGood ?? [];
      try {
        const { roster } = readTawassulRoster(rosterPath);
        const result = Object.keys(roster.agents)
          .filter((name) => name !== "tawa" && name !== "addagent")
          .map((name) => `@${name}`);
        this._opencodeAgentsCache = { result, ts: now };
        this._opencodeAgentsLastGood = result;
        this._opencodeAgentModels = this._modelsFromEntries(Object.entries(roster.agents));
        setUserPreservedAgents(Object.keys(roster.agents));
        clearRosterWarnings(rosterPath);
        return result;
      } catch (e) {
        warnRosterOnce(
          rosterPath,
          "unreadable",
          `[AgentManager] malformed global roster at ${rosterPath}; keeping the last known list: ${e instanceof Error ? e.message : String(e)}`,
        );
        if (!this._opencodeAgentsCache) {
          this._opencodeAgentsCache = { result: this._opencodeAgentsLastGood ?? [], ts: now };
        }
        return this._opencodeAgentsLastGood ?? [];
      }
    }
    this._kickOpencodeWarm();
    return this._opencodeAgentsLastGood ?? [];
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
    const mayResetProcessSet = (): boolean =>
      (rosterTrustByPath.get(srcPath)?.completeKeys ?? null) === null;
    const record = (deleted: Set<string>, resetProcessSet: boolean): Set<string> => {
      this._deletedRosterCache = deleted;
      this._deletedRosterCacheAt = now;
      this._deletedRosterCacheMtime = mtime;
      this._deletedRosterCachePath = srcPath;
      this._deletedRosterCacheSize = size;
      if (resetProcessSet) {
        setDynamicDeletedAgents([]);
        pruneUserPreservedAgents([]);
      }
      return deleted;
    };
    try {
      let deleted: Set<string>;
      if (this.scope === "global") {
        if (!existsSync(srcPath)) return record(new Set(), true);
        const raw = readTawassulRoster(srcPath).roster.deleted;
        deleted = new Set(raw.map((s) => normalizeName(String(s))));
      } else {
        if (!existsSync(srcPath)) return record(new Set(), mayResetProcessSet());
        const rawContent = readFileSync(srcPath, "utf-8");
        let parsed: Record<string, unknown>;
        try {
          parsed = readJsoncObject(rawContent);
        } catch {
          return record(new Set(), false);
        }
        const agent = parsed.agent;
        if (agent === undefined || agent === null || typeof agent !== "object" || Array.isArray(agent)) {
          return record(new Set(), mayResetProcessSet());
        }
        const keys = Object.keys(agent as Record<string, unknown>);
        if (keys.length === 0) return record(new Set(), mayResetProcessSet());
        const evaluation = this._evaluateRosterTrust(srcPath, keys);
        if (!evaluation.complete) {
          this._lastRosterEvaluation = {
            complete: false,
            empty: false,
            truncated: evaluation.truncated,
            path: srcPath,
          };
          if (evaluation.truncated) {
            warnRosterOnce(
              srcPath,
              "truncated",
              `[AgentManager] roster at ${srcPath} looks truncated (${keys.length} keys, ${evaluation.previousCount} previously); keeping the last trusted deletion set`,
            );
          } else {
            warnRosterOnce(
              srcPath,
              "incomplete",
              `[AgentManager] roster at ${srcPath} is incomplete (missing ${evaluation.missingBases.join(", ")}); keeping the last trusted deletion set`,
            );
          }
          const lastTrusted = rosterTrustByPath.get(srcPath)?.lastDeleted ?? new Set<string>();
          return record(lastTrusted, false);
        }
        const present = new Set(keys.map((s) => normalizeName(String(s))));
        deleted = new Set(
          generatedVariantNames(BASE_ROLE_NAMES).filter((name) => !present.has(normalizeName(name))),
        );
        const trust = rosterTrustByPath.get(srcPath);
        if (trust) trust.lastDeleted = deleted;
        this._lastRosterEvaluation = { complete: true, empty: false, truncated: false, path: srcPath };
      }
      setDynamicDeletedAgents([...deleted]);
      pruneUserPreservedAgents([...deleted]);
      return record(deleted, false);
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

  clearReadCache(options?: { configChanged?: boolean }): void {
    this._opencodeAgentsCache = null;
    this._agentMdCache.clear();
    this._deletedRosterCache = null;
    this._deletedRosterCacheAt = 0;
    this._deletedRosterCacheMtime = -1;
    this._deletedRosterCachePath = "";
    this._deletedRosterCacheSize = -1;
    if (options?.configChanged !== false) this._rosterGeneration += 1;
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
      if (changed) this.clearReadCache({ configChanged: false });
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
      this.clearReadCache({ configChanged: false });
    } catch (e) {
      logger.warn(`writeAgentMd failed for ${tag}:`, e);
      throw e;
    }
  }
}
