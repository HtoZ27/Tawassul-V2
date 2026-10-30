import type { Checkpoint } from "../../context/types.ts";

export const PACK_VERSION = 1;
export const PACK_MAX_BYTES = 64000;
export const PACK_ENVELOPE_BYTES = 2048;
export const PACK_TEXT_BYTES = PACK_MAX_BYTES - PACK_ENVELOPE_BYTES;
export const PACK_TTL_DAYS = 14;
export const PACK_MAX_COUNT = 200;
export const PACK_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const LEDGER_MAX_LINES = 5000;
export const LEDGER_KEEP_LINES = 2500;
export const LOCK_STALE_MS = 30000;
export const MIN_BUDGET_BYTES = 1024;
export const MIN_TRUSTED_WINDOW = 128000;

export type HostUserMessage = {
  role: "user";
  content: Array<{ type: "text"; text: string }>;
};

export type PackMessage = {
  role?: unknown;
  content?: unknown;
  parts?: unknown;
  text?: unknown;
  id?: unknown;
  [key: string]: unknown;
};

export type PackSelection = {
  text: string;
  bytes: number;
  messageCount: number;
  dropped: number;
  overflow: boolean;
};

export type PackSource = {
  task?: string;
  context?: string;
  checkpoint?: Checkpoint;
  files?: string[];
  from?: string;
  to?: string;
  reason?: string;
};

export type PackClaimFields = {
  digest: string;
  sessionID: string;
  agent: string;
  handoffId: string;
  parentID: string;
  worktree: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
};

export type PackRecord = PackClaimFields & {
  version: number;
  id: string;
  payload: string;
  text: string;
  bytes: number;
  message: HostUserMessage;
  claim: string;
  transferredTo: string[];
};

export type PackIndexEntry = {
  digest: string;
  sessionID: string;
  agent?: string;
  handoffId?: string;
  parentID?: string;
  activatedAt: string;
  transferredTo?: string[];
  warmed?: boolean;
  revoked?: boolean;
};

export type PackIndex = Record<string, PackIndexEntry>;

export type LedgerEntry = {
  type: "write" | "activate" | "transfer" | "revoke" | "tombstone" | "gc" | "failure" | "compaction";
  digest?: string;
  sessionID?: string;
  handoffId?: string;
  at: string;
  reason?: string;
  detail?: string;
};

export type PackStatus = {
  digest: string;
  id: string;
  sessionID: string;
  handoffId?: string;
  bytes: number;
  issuedAt: string;
  expiresAt: string;
  transferredTo: string[];
  revoked: boolean;
  expired: boolean;
};

export type PackBuildInput = {
  worktree: string;
  sessionID: string;
  agent: string;
  handoffId?: string;
  parentID?: string;
  selection?: string;
  source?: PackSource;
  transferredTo?: string[];
  now?: Date;
};

export type PackFailureInput = {
  worktree: string;
  sessionID: string;
  agent?: string;
  messages?: unknown[];
  error?: unknown;
  retryAfterMs?: number;
  now?: Date;
};

export type TransportFile = {
  uri: string;
  name: string;
};

export type TerminalFailure = {
  terminal: boolean;
  reason: string;
  retryAfterMs?: number;
};
