

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { atomicWriteFile } from "./atomic.ts";
import { acquireFSLock, releaseFSLock } from "../infra/file-lock.ts";
import { resolveRole } from "./agent.ts";
import {
  globalConfigDir,
  TAWASSUL_ROSTER_FILE,
  TAWASSUL_ROSTER_FILE_LEGACY,
  type InstallScope,
} from "./path-resolver.ts";
import { ALL_AGENTS } from "../agent-templates.ts";
import {
  defaultAgentModelForRole,
  DYNAMIC_MODEL_SENTINEL,
  getFallbackChain,
} from "../services/proxy-fallback-chains.ts";
import { RETIRED_MODEL_IDS } from "../core/variant-names.ts";
import { logger } from "./logger.ts";


export function stripJsoncComments(text: string): string {
  let result = "";
  let i = 0;
  
  
  
  const scopes: Array<{ lastComma: number }> = [];
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      result += quote;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\") {
          result += text[i];
          i++;
          if (i < text.length) {
            result += text[i];
            i++;
          }
          continue;
        }
        result += text[i];
        i++;
      }
      if (i < text.length) {
        result += text[i];
        i++;
      }
      
      
      const top = scopes[scopes.length - 1];
      if (top) top.lastComma = -1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      if (ch === "{" || ch === "[") {
        scopes.push({ lastComma: -1 });
      } else if (ch === "}" || ch === "]") {
        const top = scopes.pop();
        if (top && top.lastComma >= 0) {
          
          result = result.slice(0, top.lastComma) + result.slice(top.lastComma + 1);
        }
        
        
        const parent = scopes[scopes.length - 1];
        if (parent) parent.lastComma = -1;
      } else if (ch === ",") {
        const top = scopes[scopes.length - 1];
        if (top) top.lastComma = result.length;
      } else if (!/\s/.test(ch)) {
        
        const top = scopes[scopes.length - 1];
        if (top) top.lastComma = -1;
      }
      result += ch;
      i++;
    }
  }
  return result;
}


export function readJsoncObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(stripJsoncComments(text)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("opencode-config: config must contain a JSON object at the top level");
  }
  return parsed as Record<string, unknown>;
}


export function readJsoncFile(path: string): Record<string, unknown> {
  return readJsoncObject(readFileSync(path, "utf-8"));
}


export function findMatchingBrace(text: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  let inString: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}


export function renderAgentSection(agent: Record<string, unknown>): string {
  const lines = JSON.stringify(agent, null, 2).split("\n");
  const rendered = [lines[0]!, ...lines.slice(1).map((line) => (line ? "  " + line : line))];
  return '"agent": ' + rendered.join("\n");
}


export function spliceAgentSection(raw: string, agent: Record<string, unknown>): string {
  const markerIdx = raw.indexOf('\n  "agent":');
  if (markerIdx === -1) {
    
    
    
    const stripped = stripJsoncComments(raw);
    if (stripped === raw) {
      const fallback = JSON.parse(raw) as Record<string, unknown>;
      fallback.agent = agent;
      return JSON.stringify(fallback, null, 2) + "\n";
    }
    throw new Error('opencode-config: cannot splice "agent" into a jsonc file without an existing "agent" section');
  }
  const colonIdx = raw.indexOf(":", markerIdx);
  const openBraceIdx = raw.indexOf("{", colonIdx);
  if (openBraceIdx === -1) throw new Error('opencode-config: malformed "agent" section (no opening brace)');
  const closeIdx = findMatchingBrace(raw, openBraceIdx);
  if (closeIdx === -1) throw new Error('opencode-config: unbalanced braces — refusing to splice "agent" section');
  const rendered = renderAgentSection(agent);
  return raw.slice(0, markerIdx) + "\n  " + rendered + raw.slice(closeIdx + 1);
}







export function rewriteDynamicAgentModels(raw: string): string {
  const markerIdx = raw.indexOf('\n  "agent":');
  if (markerIdx === -1) return raw;
  const colonIdx = raw.indexOf(":", markerIdx);
  const openBraceIdx = raw.indexOf("{", colonIdx);
  if (openBraceIdx === -1) return raw;
  const closeIdx = findMatchingBrace(raw, openBraceIdx);
  if (closeIdx === -1) return raw;
  const section = raw.slice(openBraceIdx, closeIdx + 1);
  const agentRe = /"([A-Za-z0-9_@.-]+)"\s*:\s*\{/g;
  const chunks: string[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = agentRe.exec(section)) !== null) {
    const name = m[1] ?? "";
    const blockStart = m.index + m[0].length - 1;
    const blockEnd = findMatchingBrace(section, blockStart);
    if (blockEnd === -1) continue;
    const block = section.slice(blockStart, blockEnd + 1);
    const modelMatch = block.match(/"model"\s*:\s*"([^"]+)"/);
    const modelId = modelMatch ? (modelMatch[1] ?? null) : null;
    const isDynamic = block.includes(`"model": "${DYNAMIC_MODEL_SENTINEL}"`);
    const isRetired = modelId !== null && RETIRED_MODEL_IDS.has(modelId as string);
    if (isDynamic || isRetired) {
      const role = resolveRole(name) ?? name;
      let concrete: string;
      if (isRetired) {
        const chain = getFallbackChain(role);
        concrete = chain.find((m) => !RETIRED_MODEL_IDS.has(m)) ?? defaultAgentModelForRole(role);
      } else {
        concrete = defaultAgentModelForRole(role);
      }
      chunks.push(section.slice(cursor, blockStart));
      chunks.push(block.replace(/"model"\s*:\s*"[^"]+"/, `"model": "${concrete}"`));
      cursor = blockEnd + 1;
    }
    agentRe.lastIndex = blockEnd + 1;
  }
  if (chunks.length === 0) return raw;
  const nextSection = chunks.join("") + section.slice(cursor);
  if (nextSection === section) return raw;
  return raw.slice(0, openBraceIdx) + nextSection + raw.slice(closeIdx + 1);
}










export function opencodeConfigLockName(anchor: string): string {
  return `tawassul-opencode-lock-${createHash("sha1").update(resolve(anchor)).digest("hex").slice(0, 16)}`;
}


export function lockRetryDelayMs(attempt: number): number {
  return Math.round(30 * (attempt + 1) * (0.5 + Math.random() * 0.5));
}


export async function acquireOpencodeConfigLock(
  anchor: string,
  ttlMs = 30000,
): Promise<{ acquired: boolean; lockName: string; owner: string }> {
  const lockName = opencodeConfigLockName(anchor);
  const owner = `${Date.now()}::pid-${process.pid}`;
  let acquired = false;
  for (let attempt = 0; attempt < 8 && !acquired; attempt++) {
    acquired = await acquireFSLock(lockName, owner, ttlMs);
    if (!acquired) await new Promise((r) => setTimeout(r, lockRetryDelayMs(attempt)));
  }
  return { acquired, lockName, owner };
}


export async function withOpencodeConfigLock<T>(anchor: string, fn: () => Promise<T>): Promise<T> {
  const { acquired, lockName, owner } = await acquireOpencodeConfigLock(anchor);
  if (!acquired) throw new Error(`config write lock busy for ${anchor} (${lockName})`);
  try {
    return await fn();
  } finally {
    try {
      await releaseFSLock(lockName, owner);
    } catch {
      void 0;
    }
  }
}

export interface EnsureAgentModelsResult {
  configPath: string | null;
  changed: boolean;
  backupPath: string | null;
}


export async function ensureAgentModels(projectDir: string): Promise<EnsureAgentModelsResult> {
  try {
    let configPath: string | null = null;
    for (const name of ["opencode.jsonc", "opencode.json"]) {
      const p = resolve(projectDir, name);
      if (existsSync(p)) {
        configPath = p;
        break;
      }
    }
    if (!configPath) return { configPath: null, changed: false, backupPath: null };
    const raw0 = readFileSync(configPath, "utf-8");
    if (rewriteDynamicAgentModels(raw0) === raw0) return { configPath, changed: false, backupPath: null };

    const { acquired, lockName, owner } = await acquireOpencodeConfigLock(resolve(projectDir));
    if (!acquired) {
      logger.warn(
        `[tawassul] ensureAgentModels: config write lock busy for ${configPath} — skipping dynamic-model rewrite this boot`,
      );
      return { configPath, changed: false, backupPath: null };
    }
    try {
      
      
      const raw = readFileSync(configPath, "utf-8");
      const next = rewriteDynamicAgentModels(raw);
      if (next === raw) return { configPath, changed: false, backupPath: null };
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = configPath + ".bak." + ts;
      writeFileSync(backupPath, raw);
      await atomicWriteFile(configPath, next);
      logger.info(`[tawassul] ✎ replaced retired/dynamic model in ${configPath} (backup: ${backupPath})`);
      return { configPath, changed: true, backupPath };
    } finally {
      try {
        await releaseFSLock(lockName, owner);
      } catch {
        void 0;
      }
    }
  } catch {
    return { configPath: null, changed: false, backupPath: null };
  }
}
















export interface RepairProjectConfigResult {
  configPath: string | null;
  changed: boolean;
  backupPath: string | null;
  fixes: string[];
}


export async function sleepBootJitter(maxMs = 150): Promise<void> {
  const ms = 20 + Math.floor(Math.random() * Math.max(1, maxMs - 20));
  await new Promise((r) => setTimeout(r, ms));
}


export function fixSubagentDepth(raw: string): string {
  const valueMatch = raw.match(/"subagent_depth"\s*:\s*(\d+(?:\.\d+)?)/);
  if (valueMatch && Number(valueMatch[1]) >= 3) return raw;
  if (valueMatch) {
    return raw.replace(/"subagent_depth"\s*:\s*\d+(?:\.\d+)?/, `"subagent_depth": 3`);
  }
  const brace = raw.indexOf("{");
  if (brace === -1) return raw;
  return raw.slice(0, brace + 1) + `\n  "subagent_depth": 3,` + raw.slice(brace + 1);
}


export function applyBootRepairs(raw: string): { next: string; fixes: string[] } {
  const fixes: string[] = [];
  let next = raw;
  const models = rewriteDynamicAgentModels(next);
  if (models !== next) {
    next = models;
    fixes.push("dynamic-models");
  }
  const depth = fixSubagentDepth(next);
  if (depth !== next) {
    next = depth;
    fixes.push("subagent_depth");
  }
  return { next, fixes };
}


export async function repairProjectConfigBoot(projectDir: string): Promise<RepairProjectConfigResult> {
  try {
    let configPath: string | null = null;
    for (const name of ["opencode.jsonc", "opencode.json"]) {
      const p = resolve(projectDir, name);
      if (existsSync(p)) {
        configPath = p;
        break;
      }
    }
    if (!configPath) {
      logger.warn(`[tawassul] boot repair: no opencode.json/jsonc found in ${projectDir} — skipping both fixes`);
      return { configPath: null, changed: false, backupPath: null, fixes: [] };
    }

    
    const raw0 = readFileSync(configPath, "utf-8");
    const pre = applyBootRepairs(raw0);
    if (pre.fixes.length === 0) return { configPath, changed: false, backupPath: null, fixes: [] };

    
    
    await sleepBootJitter();

    const { acquired, lockName, owner } = await acquireOpencodeConfigLock(resolve(projectDir));
    if (!acquired) {
      logger.warn(
        `[tawassul] boot repair: config write lock busy for ${configPath} — skipping [${pre.fixes.join(", ")}] this boot`,
      );
      return { configPath, changed: false, backupPath: null, fixes: pre.fixes };
    }
    try {
      
      const raw = readFileSync(configPath, "utf-8");
      const applied = applyBootRepairs(raw);
      if (applied.fixes.length === 0) return { configPath, changed: false, backupPath: null, fixes: [] };
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = configPath + ".bak." + ts;
      writeFileSync(backupPath, raw);
      await atomicWriteFile(configPath, applied.next);
      logger.info(
        `[tawassul] boot repair: ${applied.fixes.join(" + ")} rewritten in ${configPath} (backup: ${backupPath})`,
      );
      return { configPath, changed: true, backupPath, fixes: applied.fixes };
    } finally {
      try {
        await releaseFSLock(lockName, owner);
      } catch {
        void 0;
      }
    }
  } catch {
    return { configPath: null, changed: false, backupPath: null, fixes: [] };
  }
}

export interface MinimalContractResult {
  created: boolean;
  configPath: string | null;
  reason: "exists" | "opted-out" | "non-project-scope" | "lock-busy" | null;
}

export async function ensureMinimalProjectContract(
  projectDir: string,
  scope: InstallScope,
): Promise<MinimalContractResult> {
  if (scope !== "project") return { created: false, configPath: null, reason: "non-project-scope" };
  if (process.env.TAWASSUL_NO_AUTOCONFIG === "1") {
    logger.debug("[tawassul] boot: minimal-contract generation opted out (TAWASSUL_NO_AUTOCONFIG=1)");
    return { created: false, configPath: null, reason: "opted-out" };
  }
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const p = resolve(projectDir, name);
    if (existsSync(p)) return { created: false, configPath: p, reason: "exists" };
  }
  await sleepBootJitter();
  const { acquired, lockName, owner } = await acquireOpencodeConfigLock(resolve(projectDir));
  if (!acquired) {
    logger.warn("[tawassul] boot: config write lock busy — skipping minimal-contract generation this boot");
    return { created: false, configPath: null, reason: "lock-busy" };
  }
  try {
    for (const name of ["opencode.jsonc", "opencode.json"]) {
      const p = resolve(projectDir, name);
      if (existsSync(p)) return { created: false, configPath: p, reason: "exists" };
    }
    const doc: Record<string, unknown> = {
      $schema: "https://opencode.ai/config.json",
      subagent_depth: 3,
      agent: {},
    };
    if (existsSync(resolve(projectDir, ".opencode", "mcp", "tawassul.mjs"))) {
      doc.mcp = {
        tawassul: { type: "local", command: ["node", ".opencode/mcp/tawassul.mjs"], enabled: true },
      };
    }
    const configPath = resolve(projectDir, "opencode.json");
    await atomicWriteFile(configPath, JSON.stringify(doc, null, 2) + "\n");
    logger.warn(`[tawassul] boot: no opencode.json found — generated minimal contract at ${configPath}`);
    return { created: true, configPath, reason: null };
  } finally {
    try {
      await releaseFSLock(lockName, owner);
    } catch {
      void 0;
    }
  }
}

export interface GlobalRosterSeedResult {
  created: boolean;
  path: string | null;
}

export async function ensureGlobalRosterSeed(): Promise<GlobalRosterSeedResult> {
  if (process.env.TAWASSUL_NO_AUTOCONFIG === "1") {
    logger.debug("[tawassul] boot: global-roster seeding opted out (TAWASSUL_NO_AUTOCONFIG=1)");
    return { created: false, path: null };
  }
  const dir = globalConfigDir();
  const canonical = resolve(dir, TAWASSUL_ROSTER_FILE);
  const legacy = resolve(dir, TAWASSUL_ROSTER_FILE_LEGACY);
  if (existsSync(canonical)) return { created: false, path: canonical };
  if (existsSync(legacy)) return { created: false, path: legacy };
  const agents: Record<string, unknown> = {};
  for (const a of ALL_AGENTS) {
    agents[a.name] = { description: a.description, model: defaultAgentModelForRole(a.name) };
  }
  await mkdir(dir, { recursive: true });
  if (existsSync(canonical)) return { created: false, path: canonical };
  if (existsSync(legacy)) return { created: false, path: legacy };
  await atomicWriteFile(legacy, JSON.stringify({ agents, deleted: [] }, null, 2) + "\n");
  logger.warn(`[tawassul] boot: no global roster — seeded minimal ${legacy}`);
  return { created: true, path: legacy };
}



export interface TawassulRoster {
  agents: Record<string, unknown>;
  deleted: string[];
}


export function readTawassulRoster(path: string): { roster: TawassulRoster; config: Record<string, unknown> } {
  if (!existsSync(path)) return { roster: { agents: {}, deleted: [] }, config: {} };
  let parsed: Record<string, unknown>;
  try {
    parsed = readJsoncFile(path);
  } catch (e) {
    throw new Error(`opencode-config: malformed roster file at ${path}: ${(e as Error).message}`, { cause: e });
  }
  const agents = (parsed.agents ?? {}) as Record<string, unknown>;
  const deletedRaw = parsed.deleted;
  const deleted = Array.isArray(deletedRaw) ? (deletedRaw.filter((d) => typeof d === "string") as string[]) : [];
  const config: Record<string, unknown> = { ...parsed };
  delete config.agents;
  delete config.deleted;
  return { roster: { agents, deleted }, config };
}


export async function writeTawassulRoster(
  path: string,
  data: TawassulRoster,
  opts: { backup?: boolean } = {},
): Promise<void> {
  const existing = readTawassulRoster(path).config;
  const payload = {
    ...existing,
    agents: data.agents ?? {},
    deleted: [...new Set(data.deleted ?? [])].sort(),
  };
  
  
  
  let rawHasComments = false;
  try {
    const raw = readFileSync(path, "utf-8");
    rawHasComments = raw.trim() !== stripJsoncComments(raw).trim();
  } catch {

  }
  if (rawHasComments) {
    console.warn(
      `writeTawassulRoster: ${path} is jsonc (contains comments) — re-serialization will drop them; consider a plain-JSON roster`,
    );
  }
  await atomicWriteFile(path, JSON.stringify(payload, null, 2) + "\n", opts);
}


export function detectDeletedProtectedAgents(
  newContent: string,
  currentPath: string,
  protectedNames: string[],
): string[] {
  try {
    const newParsed = readJsoncObject(newContent);
    const newAgents = (newParsed.agent ?? newParsed.agents ?? {}) as Record<string, unknown>;
    const newKeys = new Set(Object.keys(newAgents));
    let oldKeys = new Set<string>();
    try {
      const oldRaw = readFileSync(currentPath, "utf-8");
      const oldParsed = readJsoncObject(oldRaw);
      const oldAgents = (oldParsed.agent ?? oldParsed.agents ?? {}) as Record<string, unknown>;
      oldKeys = new Set(Object.keys(oldAgents));
    } catch (e) {
      throw new Error(
        `[tawassul] cannot-verify protected-agent deletions (current config unreadable: ${(e as Error)?.message ?? e})`,
        { cause: e },
      );
    }
    const protectedSet = new Set(protectedNames.map((n) => n.toLowerCase()));
    const deleted: string[] = [];
    for (const k of oldKeys) {
      if (protectedSet.has(k.toLowerCase()) && !newKeys.has(k)) deleted.push(k);
    }
    return deleted;
  } catch (e) {
    throw new Error(
      `[tawassul] cannot-verify protected-agent deletions (new content unparsable: ${(e as Error)?.message ?? e})`,
      { cause: e },
    );
  }
}
