import type { ValidationStage } from "../tool-execute-types.ts";
import { requiresConsent } from "./shared.ts";
import { isRootLikeAgent } from "./shared.ts";
import { logger } from "../../utils/logger.ts";
import { t } from "../../translations.ts";
import { ASK_PENDING } from "../../services/ask-channel.ts";

export let consentGateEnabled = true;

export const setConsentGateEnabled = (enabled: boolean): void => {
  consentGateEnabled = enabled;
};

export const isConsentGateEnabled = (): boolean => consentGateEnabled;

function isApprovalWord(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const norm = value.toLowerCase().trim();
  return (
    norm === "true" || norm === "yes" || norm === "ok" || norm === "نعم" || norm === "once"
  );
}

function buildDryRunPreview(tool: string, args: Record<string, unknown>): string {
  if (tool === "bash") {
    const cmd = typeof args.command === "string" ? args.command : "";
    return `DRY-RUN ▶ bash\n  command: ${cmd}`;
  }
  if (tool === "delete") {
    const file = typeof args.file === "string" ? args.file : "?";
    return `DRY-RUN ▶ delete\n  file: ${file}`;
  }
  if (tool === "edit") {
    const path = typeof args.filePath === "string" ? args.filePath : typeof args.path === "string" ? args.path : "?";
    const added = typeof args.newContent === "string" ? args.newContent.split("\n").length : 0;
    return `DRY-RUN ▶ edit\n  file: ${path}\n  newContentLines: ${added}`;
  }
  return `DRY-RUN ▶ ${tool}`;
}

export class ConsentBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsentBlockedError";
  }
}

export const CONSENT_APPROVAL_TTL_MS = 600_000;

export const CONSENT_DENIAL_TTL_MS = 60_000;

export const HOST_ASK_TIMEOUT_MS = 25_000;

interface ConsentApproval {
  at: number;
  approved: boolean;
}

const approvalCache = new Map<string, ConsentApproval>();
const MAX_APPROVAL_CACHE = 200;

const expiredUnseen = new Map<string, number>();
const MAX_EXPIRED_UNSEEN = 200;

function pruneExpiredUnseen(now: number): void {
  for (const [k, at] of expiredUnseen) {
    if (now - at > CONSENT_APPROVAL_TTL_MS) expiredUnseen.delete(k);
  }
  while (expiredUnseen.size > MAX_EXPIRED_UNSEEN) {
    const oldest = expiredUnseen.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    expiredUnseen.delete(oldest);
  }
}

export function resetExpiredUnseen(): void {
  expiredUnseen.clear();
}

function evictApprovalIfNeeded(): void {
  if (approvalCache.size < MAX_APPROVAL_CACHE) return;
  const oldest = approvalCache.keys().next().value as string | undefined;
  if (oldest) approvalCache.delete(oldest);
}

function pruneExpiredApprovals(): void {
  const now = Date.now();
  for (const [k, v] of approvalCache) {
    const ttl = v.approved ? CONSENT_APPROVAL_TTL_MS : CONSENT_DENIAL_TTL_MS;
    if (now - v.at > ttl) approvalCache.delete(k);
  }
}

export function resetConsentApprovals(): void {
  approvalCache.clear();
  expiredUnseen.clear();
}

export function stripBashComment(command: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let i = 0;
  const n = command.length;
  const matchHeredocOp = (at: number): number => {
    if (command[at] !== "<" || command[at + 1] !== "<") return -1;
    let j = at + 2;
    if (command[j] === "-") j++;
    if (command[j] === "<") {
      const nl = command.indexOf("\n", j);
      return nl === -1 ? n : nl;
    }
    while (j < n && (command[j] === " " || command[j] === "\t")) j++;
    const q = command[j];
    let delim = "";
    if (q === "'" || q === '"') {
      j++;
      while (j < n && command[j] !== q) {
        delim += command[j];
        j++;
      }
      if (command[j] === q) j++;
    } else {
      while (j < n && command[j] !== " " && command[j] !== "\t" && command[j] !== "\n" && command[j] !== ";") {
        delim += command[j];
        j++;
      }
    }
    if (!delim) return -1;
    let k = j;
    while (k < n && command[k] !== "\n") k++;
    let lineStart = k + 1;
    while (lineStart <= n) {
      let lineEnd = command.indexOf("\n", lineStart);
      if (lineEnd === -1) lineEnd = n;
      const trimmed = command.slice(lineStart, lineEnd).trim();
      if (trimmed === delim || trimmed.startsWith(`${delim} `) || trimmed.startsWith(`${delim}\t`)) {
        return lineStart + command.slice(lineStart, lineEnd).indexOf(delim) + delim.length;
      }
      lineStart = lineEnd + 1;
    }
    return n;
  };
  let out = "";
  while (i < n) {
    const ch = command[i];
    if (escaped) {
      escaped = false;
      out += ch;
      i++;
      continue;
    }
    if (ch === "\\" && !inSingle) {
      escaped = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      out += ch;
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      out += ch;
      i++;
      continue;
    }
    if (!inSingle && !inDouble && ch === "<") {
      const resume = matchHeredocOp(i);
      if (resume !== -1) {
        out += command.slice(i, resume);
        i = resume;
        continue;
      }
    }
    if (ch === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(command[i - 1] ?? ""))) {
      return out;
    }
    out += ch;
    i++;
  }
  return out;
}

export function consentKey(tool: string, args: Record<string, unknown>, sessionID?: string): string {
  const scope = sessionID ? `@${sessionID}` : "@global";
  if (tool === "delete") {
    const file = typeof args?.file === "string" ? args.file : "";
    return `delete:${file}${scope}`;
  }
  if (tool === "kick") {
    const target = typeof args?.agent === "string" ? args.agent : "";
    return `kick:${target}${scope}`;
  }
  if (tool === "bash") {
    const raw = typeof args?.command === "string" ? args.command : "";
    const command = stripBashComment(raw).trim().replace(/\s+/g, " ");
    return `bash:${command}${scope}`;
  }
  return `${tool}:${scope}`;
}

export const consentGateGuard: ValidationStage = {
  name: "consent-gate",
  async check(ctx, input, output) {
    if (!consentGateEnabled) return true;
    if (!requiresConsent(input.tool, output.args ?? {})) return true;
    const args = output.args ?? {};
    const detail = input.tool === "bash" && typeof args.command === "string" ? `: ${args.command.slice(0, 120)}` : "";

    const p = { tool: input.tool, detail: detail ? ` (${detail})` : "" };
    const askChannel = ctx.askChannelInstance;

    const answerSession = askChannel?.currentSessionOverride || input.sessionID;
    const key = consentKey(input.tool, args, answerSession);

    const cached = approvalCache.get(key);
    if (cached) {
      const ttl = cached.approved ? CONSENT_APPROVAL_TTL_MS : CONSENT_DENIAL_TTL_MS;
      if (Date.now() - cached.at < ttl) {
        approvalCache.delete(key);
        approvalCache.set(key, cached);
        if (cached.approved) {
          logger.audit("CONSENT_APPROVED", { agent: input.agent, tool: input.tool, key, reason: "cache" });
          logger.info(buildDryRunPreview(input.tool, args));
          return true;
        }
        logger.audit("CONSENT_BLOCKED", { agent: input.agent, tool: input.tool, reason: "cached-denial" });
        throw new ConsentBlockedError(t("consentDeniedCached", p));
      }
      approvalCache.delete(key);
    }

    const hasHostAsk = typeof ctx.ask === "function";
    if (!askChannel && !hasHostAsk) {
      logger.audit("CONSENT_BLOCKED", { agent: input.agent, tool: input.tool, reason: "no-ask-channel" });
      throw new ConsentBlockedError(t("consentNoChannel", p));
    }

    if (askChannel && !hasHostAsk) {
      if (!isRootLikeAgent(input.agent) && !askChannel.currentSessionOverride) {
        logger.warn(
          "[consent] no-root-binding: subagent consent from session without a known root - question cannot reach the user",
          {
            agent: input.agent,
            tool: input.tool,
            session: input.sessionID,
          },
        );
        throw new ConsentBlockedError(t("consentNoRootBinding", p));
      }
      if (askChannel.hasPending(answerSession)) {
        throw new ConsentBlockedError(t("consentPendingQuestion", p));
      }
      const deferred = askChannel.deferConsent(
        t("consentAskTitle", { tool: input.tool, detail }),
        { type: "confirm", default: false },
        input.sessionID,
        (answer) => {
          expiredUnseen.delete(key);
          const approved = isApprovalWord(answer);
          const at = Date.now();
          pruneExpiredApprovals();
          evictApprovalIfNeeded();
          approvalCache.set(key, { at, approved });
          logger.audit(approved ? "CONSENT_DEFERRED_APPROVED" : "CONSENT_DEFERRED_DENIED", {
            agent: input.agent,
            tool: input.tool,
            key,
          });
        },
        () => {
          pruneExpiredUnseen(Date.now());
          expiredUnseen.set(key, Date.now());
          logger.warn("[consent] CONSENT_EXPIRED: parked question timed out with no answer", {
            agent: input.agent,
            tool: input.tool,
            key,
            session: input.sessionID,
          });
          logger.audit("CONSENT_EXPIRED", { agent: input.agent, tool: input.tool, key });
          (ctx as unknown as { eventHub?: { emit: (e: unknown) => void } }).eventHub?.emit({
            type: "CONSENT_EXPIRED",
            sessionID: input.sessionID,
            tool: input.tool,
            key,
          });
        },
      );
      if (deferred === ASK_PENDING) {
        if (expiredUnseen.has(key)) {
          expiredUnseen.delete(key);
          throw new ConsentBlockedError(t("consentAwaitingApprovalExpired", p));
        }
        throw new ConsentBlockedError(t("consentAwaitingApproval", p));
      }
      expiredUnseen.delete(key);
      logger.audit("CONSENT_BLOCKED", { agent: input.agent, tool: input.tool, reason: "deferred-refused" });
      throw new ConsentBlockedError(t("consentDeferredRefused", p));
    }

    let granted: boolean;
    try {
      const res = await Promise.race([
        ctx.ask!(t("consentAskTitle", { tool: input.tool, detail }), { type: "confirm", default: false }),
        new Promise<"__timeout__">((resolve) => {
          const timer = setTimeout(() => resolve("__timeout__"), HOST_ASK_TIMEOUT_MS);
          timer.unref?.();
        }),
      ]);
      const norm = typeof res === "string" ? (res as string).toLowerCase().trim() : res;
      granted = isApprovalWord(res) || norm === "always";
    } catch {
      granted = false;
    }

    if (granted) {
      logger.info(buildDryRunPreview(input.tool, args));
      pruneExpiredApprovals();
      evictApprovalIfNeeded();
      approvalCache.set(key, { at: Date.now(), approved: true });
      return true;
    }
    logger.audit("CONSENT_BLOCKED", { agent: input.agent, tool: input.tool });
    throw new ConsentBlockedError(t("consentHostDenied", p));
  },
};
