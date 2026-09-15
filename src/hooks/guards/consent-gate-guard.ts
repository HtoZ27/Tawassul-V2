
import type { ValidationStage } from "../tool-execute-types.ts";
import { requiresConsent } from "./shared.ts";
import { logger } from "../../utils/logger.ts";
import { t } from "../../translations.ts";
import { ASK_PENDING } from "../../services/ask-channel.ts";

export let consentGateEnabled = true;

export const setConsentGateEnabled = (enabled: boolean): void => {
  consentGateEnabled = enabled;
};

export const isConsentGateEnabled = (): boolean => consentGateEnabled;




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


export const HOST_ASK_TIMEOUT_MS = 25_000;

interface ConsentApproval {
  at: number;
  approved: boolean;
}

const approvalCache = new Map<string, ConsentApproval>();
const MAX_APPROVAL_CACHE = 200;

function evictApprovalIfNeeded(): void {
  if (approvalCache.size < MAX_APPROVAL_CACHE) return;
  const oldest = approvalCache.keys().next().value as string | undefined;
  if (oldest) approvalCache.delete(oldest);
}

function pruneExpiredApprovals(): void {
  const now = Date.now();
  for (const [k, v] of approvalCache) {
    if (now - v.at > CONSENT_APPROVAL_TTL_MS) approvalCache.delete(k);
  }
}

export function resetConsentApprovals(): void {
  approvalCache.clear();
}


export function stripBashComment(command: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && !inSingle) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(command[i - 1] ?? ""))) {
      return command.slice(0, i);
    }
  }
  return command;
}


export function consentKey(tool: string, args: Record<string, unknown>, sessionID?: string): string {
  const scope = sessionID ? `@${sessionID}` : "@global";
  if (tool === "delete") {
    const file = typeof args?.file === "string" ? args.file : "";
    return `delete:${file}${scope}`;
  }
  if (tool === "bash") {
    const command = typeof args?.command === "string" ? args.command.trim().replace(/\s+/g, " ") : "";
    return `bash:${stripBashComment(command).trim().replace(/\s+/g, " ")}${scope}`;
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
    
    
    const answerSession = askChannel?.currentSessionOverride ?? input.sessionID;
    const key = consentKey(input.tool, args, answerSession);

    
    
    
    
    const cached = approvalCache.get(key);
    if (cached) {
      if (Date.now() - cached.at < CONSENT_APPROVAL_TTL_MS) {
        
        
        
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

    
    if (askChannel) {
      if (askChannel.hasPending(answerSession)) {
        
        
        throw new ConsentBlockedError(t("consentPendingQuestion", p));
      }
      const deferred = askChannel.deferConsent(
        t("consentAskTitle", { tool: input.tool, detail }),
        { type: "confirm", default: false },
        input.sessionID,
        (answer) => {
          
          const norm = typeof answer === "string" ? answer.toLowerCase().trim() : answer;
          const isAlways = norm === "always";
          const approved = norm === true || norm === "true" || norm === "yes" || norm === "once" || isAlways;
          
          const at = Date.now();
          if (isAlways) {
            
            pruneExpiredApprovals();
            evictApprovalIfNeeded();
            approvalCache.set(key, { at, approved: true });
            
            try {
              const cfg = (ctx as unknown as { config?: { permission?: Record<string, unknown> } }).config;
              if (cfg?.permission) (cfg.permission as Record<string, unknown>)[key] = "always";
            } catch {
              void 0;
            }
          } else {
            pruneExpiredApprovals();
            evictApprovalIfNeeded();
            approvalCache.set(key, { at, approved });
          }
          logger.audit(approved ? "CONSENT_DEFERRED_APPROVED" : "CONSENT_DEFERRED_DENIED", {
            agent: input.agent,
            tool: input.tool,
            key,
            ...(isAlways ? { mode: "always" } : {}),
          });
        },
      );
      if (deferred === ASK_PENDING) {
        throw new ConsentBlockedError(t("consentAwaitingApproval", p));
      }
      
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
      const isAlways = norm === "always";
      granted = norm === true || norm === "true" || norm === "yes" || norm === "once" || isAlways;
      if (isAlways) {
        try {
          const cfg = (ctx as unknown as { config?: { permission?: Record<string, unknown> } }).config;
          if (cfg?.permission) (cfg.permission as Record<string, unknown>)[key] = "always";
        } catch {
          void 0;
        }
      }
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
