
import { TimerManager } from "./timer-manager.ts";
import { parseUserReply, isAskInjection, type AskKind, type AskReply } from "./ask-channel-parse.ts";
import { logger } from "../utils/logger.ts";

export type { AskReply, AskKind } from "./ask-channel-parse.ts";

export const ASK_PENDING = Symbol("tawassul-ask-pending");


export const DEFERRED_TIMEOUT_MS = 60_000;


export const MAX_ANSWER_LENGTH = 60;


export type AskResolveCallback = (answer: AskReply) => void;

export type AskChannelRender = (slot: {
  id: string;
  title: string;
  kind: AskKind;
  sessionID: string;
}) => void | Promise<void>;

export interface AskSlot {
  id: string;
  sessionID: string;
  title: string;
  kind: AskKind;
  resolve: (v: AskReply | typeof ASK_PENDING) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
  
  onResolve?: AskResolveCallback;
  
  onTimeout?: () => void;
}

export interface AskChannelDeps {
  
  render?: AskChannelRender;
  
  sessionID: () => string;
  
  timers: TimerManager;
  
  timeoutMs?: number;
  
  blockingTimeoutMs?: number;
  
  deferredTimeoutMs?: number;
  
  maxPending?: number;
  
  maxPerSession?: number;
}
let askCounter = 0;

export class AskChannel {
  private slots = new Map<string, AskSlot>();
  private perSession: Map<string, string[]> = new Map();
  private disposed = false;
  
  private sessionOverride: string | undefined;

  constructor(private deps: AskChannelDeps) {}

  
  noteSession(sessionID: string): void {
    this.sessionOverride = sessionID;
  }

  
  get currentSessionOverride(): string | undefined {
    return this.sessionOverride;
  }

  
  ask(title: string, kind: AskKind): Promise<AskReply> {
    return this._register(title, kind, "blocking", this.currentSessionID()) as Promise<AskReply>;
  }

  
  askForSession(title: string, kind: AskKind, sessionID: string): Promise<AskReply> {
    return this._register(title, kind, "blocking", sessionID) as Promise<AskReply>;
  }

  
  askForRoot(title: string, kind: AskKind, toolSessionID: string): Promise<AskReply> {
    return this._register(title, kind, "blocking", this.rootTarget(toolSessionID)) as Promise<AskReply>;
  }

  
  deferConsent(
    title: string,
    kind: AskKind,
    toolSessionID: string,
    onResolve?: AskResolveCallback,
    onTimeout?: () => void,
  ): typeof ASK_PENDING | undefined {
    const target = this.rootTarget(toolSessionID);
    if (this.disposed || !this._capacityOk(target)) return undefined;
    this._register(title, kind, "defer", target, onResolve, onTimeout);
    return ASK_PENDING;
  }

  
  deferAsk(title: string, kind: AskKind, sessionID: string): typeof ASK_PENDING | undefined {
    if (this.disposed || !this._capacityOk(sessionID)) return undefined;
    this._register(title, kind, "defer", sessionID);
    return ASK_PENDING;
  }

  
  deferAskResolvable(
    title: string,
    kind: AskKind,
    sessionID: string,
    onResolve: AskResolveCallback,
    onTimeout?: () => void,
  ): typeof ASK_PENDING | undefined {
    if (this.disposed || !this._capacityOk(sessionID)) return undefined;
    this._register(title, kind, "defer", sessionID, onResolve, onTimeout);
    return ASK_PENDING;
  }

  
  hasPending(sessionID: string): boolean {
    return (this.perSession.get(sessionID)?.length ?? 0) > 0;
  }

  
  onUserMessage(sessionID: string, content: string): { consumed: boolean; answer?: AskReply; kind?: AskKind } {
    const queue = this.perSession.get(sessionID);
    if (!queue || queue.length === 0) return { consumed: false };
    const slot = queue[0] !== undefined ? this.slots.get(queue[0]) : undefined;
    if (!slot || slot.settled) {
      this._shift(sessionID);
      return { consumed: false };
    }
    
    
    
    const trimmed = content.trim();
    if (!trimmed || trimmed.includes("\n") || trimmed.length > MAX_ANSWER_LENGTH) return { consumed: false };
    const answer = parseUserReply(trimmed, slot.kind);
    if (answer === undefined) return { consumed: false };
    this._settle(slot, answer);
    this._shift(sessionID);
    slot.onResolve?.(answer);
    return { consumed: true, answer, kind: slot.kind };
  }

  
  isSelfMessage(output?: { parts?: Array<{ type: string; text?: string; [k: string]: unknown }> }): boolean {
    return isAskInjection(output);
  }

  
  get pendingCount(): number {
    return this.slots.size;
  }

  
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots.values()) {
      this.deps.timers.clear(slot.timer);
      if (!slot.settled) this._settle(slot, defaultFor(slot.kind));
    }
    this.slots.clear();
    this.perSession.clear();
  }

  reset(): void {
    this.dispose();
    this.disposed = false;
  }

  private currentSessionID(): string {
    return this.sessionOverride ?? this.deps.sessionID();
  }

  
  private rootTarget(toolSessionID: string): string {
    return this.sessionOverride || toolSessionID;
  }

  private _capacityOk(sessionID?: string): boolean {
    const sid = sessionID ?? this.currentSessionID();
    const queue = this.perSession.get(sid) ?? [];
    const maxPending = this.deps.maxPending ?? 100;
    const maxPerSession = this.deps.maxPerSession ?? 8;
    return this.slots.size < maxPending && queue.length < maxPerSession;
  }

  private _register(
    title: string,
    kind: AskKind,
    mode: "blocking" | "defer",
    sessionID: string,
    onResolve?: AskResolveCallback,
    onTimeout?: () => void,
  ): Promise<AskReply | typeof ASK_PENDING> | typeof ASK_PENDING {
    if (this.disposed) return Promise.resolve(defaultFor(kind));

    const id = `ask-${Date.now().toString(36)}-${++askCounter}`;

    
    if (!this._capacityOk(sessionID)) {
      logger.warn(`AskChannel: cap reached (${this.slots.size} slots) — resolving as default`);
      return Promise.resolve(defaultFor(kind));
    }

    const queue = this.perSession.get(sessionID) ?? [];

    return new Promise<AskReply | typeof ASK_PENDING>((resolve, reject) => {
      const slot: AskSlot = {
        id,
        sessionID,
        title,
        kind,
        resolve,
        reject,
        timer: null as unknown as ReturnType<typeof setTimeout>,
        settled: false,
        onResolve,
        onTimeout,
      };
      const timeoutMs =
        mode === "blocking"
          ? (this.deps.blockingTimeoutMs ?? this.deps.timeoutMs ?? 60_000)
          : (this.deps.deferredTimeoutMs ?? this.deps.timeoutMs ?? DEFERRED_TIMEOUT_MS);
      slot.timer = this.deps.timers.setTimeout(() => {
        if (slot.settled) return;
        logger.debug(`AskChannel: ask "${title}" timed out after ${timeoutMs}ms`);
        slot.onTimeout?.();
        this._settle(slot, defaultFor(kind));
        this._shift(sessionID);
      }, timeoutMs);
      this.slots.set(id, slot);
      queue.push(id);
      this.perSession.set(sessionID, queue);
      this._render(slot);
      if (mode === "defer") {
        resolve(ASK_PENDING);
      }
    });
  }

  private async _render(slot: AskSlot): Promise<void> {
    try {
      if (!this.deps.render) {
        logger.debug(`AskChannel: no renderer — ask "${slot.title}" surfaced in transcript only`);
        return;
      }
      await this.deps.render({ id: slot.id, title: slot.title, kind: slot.kind, sessionID: slot.sessionID });
    } catch (e) {
      logger.warn(`AskChannel: render failed for "${slot.title}":`, e);
    }
  }

  private _settle(slot: AskSlot, value: AskReply | typeof ASK_PENDING): void {
    if (slot.settled) return;
    slot.settled = true;
    this.deps.timers.clear(slot.timer);
    this.slots.delete(slot.id);
    slot.resolve(value);
  }

  private _shift(sessionID: string): void {
    const queue = this.perSession.get(sessionID);
    if (!queue) return;
    queue.shift();
    if (queue.length === 0) this.perSession.delete(sessionID);
  }
}

function defaultFor(kind: AskKind): AskReply {
  if (kind.type === "confirm") return kind.default;
  if (kind.type === "multiselect") return [];
  return "";
}
