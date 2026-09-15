
import type { GoalStore } from "./goal-store.ts";
import { logger } from "../utils/logger.ts";
import { lruSet } from "../utils/bounded-map.ts";

export interface TodoCaptureInput {
  store?: GoalStore;
  sessionId: string;
  
  owner: string;
  todos: Array<{ title: string; status: string }>;
}

export interface TodoCaptureResult {
  ok: boolean;
  goalId?: string;
  
  digest?: string;
}

const DIGEST_MAX_CHARS = 700;

const pendingDigestBySession = new Map<string, string>();


export function stashCopilotDigest(sessionId: string, digest: string): void {
  if (!sessionId || !digest) return;
  lruSet(pendingDigestBySession, sessionId, digest, { cap: 64 });
}


export function takeCopilotDigest(sessionId: string): string | undefined {
  const digest = pendingDigestBySession.get(sessionId);
  if (digest === undefined) return undefined;
  pendingDigestBySession.delete(sessionId);
  return digest;
}


export function __resetCopilotDigests(): void {
  pendingDigestBySession.clear();
}


export async function runTodoReconcile(input: TodoCaptureInput): Promise<TodoCaptureResult> {
  const todos = (input.todos ?? [])
    .map((t) => ({ title: String(t.title ?? "").trim(), status: String(t.status ?? "pending").trim() }))
    .filter((t) => t.title.length > 0);
  if (todos.length === 0 || !input.store) return { ok: false };
  try {
    const res = await input.store.reconcileCapture({
      owner: input.owner,
      sessionId: input.sessionId,
      todos,
    });
    if (!res.ok) return { ok: false };
    const digest = input.store.buildDigest().text.slice(0, DIGEST_MAX_CHARS);
    return { ok: true, goalId: res.goal.id, digest };
  } catch (e) {
    logger.warn("[goal-auto] reconcile failed:", (e as Error)?.message ?? e);
    return { ok: false };
  }
}
