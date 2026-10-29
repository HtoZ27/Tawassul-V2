import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { safeHomedir } from "../utils/path-resolver.ts";
import { STATE_DIR_NAME } from "../utils/state-paths.ts";

export const CONSENT_TOKENS_ENV = "TAWASSUL_CONSENT_TOKENS";
export const CONSENT_TOKENS_FILE = "consent-tokens.json";

type TokenCache = {
  path: string;
  mtimeMs: number;
  accept: Set<string>;
  deny: Set<string>;
};

let cache: TokenCache | undefined;

const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;
const ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/g;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const ALEF = String.fromCodePoint(0x0627);
const YAA = String.fromCodePoint(0x064A);
const HAA = String.fromCodePoint(0x0647);

function configHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return resolve(xdg);
  return resolve(safeHomedir(), ".config");
}

export function consentTokensPath(): string {
  const override = process.env[CONSENT_TOKENS_ENV]?.trim();
  if (override) return resolve(override);
  return resolve(configHome(), STATE_DIR_NAME, CONSENT_TOKENS_FILE);
}

export function normalizeToken(value: string): string {
  return value
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(ALEF_VARIANTS, ALEF)
    .replace(/\u0649/g, YAA)
    .replace(/\u0629/g, HAA)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(EDGE_PUNCTUATION, "")
    .trim();
}

function tokenList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const token = normalizeToken(item);
    if (token && !out.includes(token)) out.push(token);
  }
  return out;
}

function readTokenFile(path: string, mtimeMs: number): TokenCache {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { accept?: unknown; deny?: unknown };
    return { path, mtimeMs, accept: new Set(tokenList(raw.accept)), deny: new Set(tokenList(raw.deny)) };
  } catch {
    return { path, mtimeMs, accept: new Set(), deny: new Set() };
  }
}

function tokens(): TokenCache {
  const path = consentTokensPath();
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return { path, mtimeMs: -1, accept: new Set(), deny: new Set() };
  }
  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache;
  cache = readTokenFile(path, mtimeMs);
  return cache;
}

export function isCustomAcceptToken(value: string): boolean {
  const token = normalizeToken(value);
  return token !== "" && tokens().accept.has(token);
}

export function isCustomDenyToken(value: string): boolean {
  const token = normalizeToken(value);
  return token !== "" && tokens().deny.has(token);
}

export function customTokenCount(): number {
  const current = tokens();
  return current.accept.size + current.deny.size;
}
