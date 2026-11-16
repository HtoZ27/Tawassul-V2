import type { TaskPriority } from "../conflict-resolver/types.ts";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";

type PriorityTask = {
  id: string;
  handoffId: string;
  from: string;
  to: string;
  task: string;
  priority: TaskPriority;
  createdAt: string;
  deadline?: string;
};

const PRIORITY_WEIGHT: Record<TaskPriority, number> = { P0: 5, P1: 4, P2: 3, P3: 2, P4: 1 };



const AGING_WINDOW_MS = 3_600_000;












export class TaskPriorityManager {
  
  private heaps = new Map<string, PriorityTask[]>();
  
  private lastHeapifyMs = new Map<string, number>();
  private static MAX_QUEUE_SIZE = 100;

  private static decayFactor(createdAt: string): number {
    const ageMs = Math.max(0, Date.now() - new Date(createdAt).getTime());
    return 1 + Math.min(2, ageMs / AGING_WINDOW_MS);
  }

  private static effectivePriority(task: PriorityTask): number {
    return PRIORITY_WEIGHT[task.priority] * TaskPriorityManager.decayFactor(task.createdAt);
  }

  private heapFor(agent: string): PriorityTask[] {
    const key = normalizeName(agent);
    let h = this.heaps.get(key);
    if (!h) {
      h = [];
      this.heaps.set(key, h);
      this.lastHeapifyMs.set(key, -1);
    }
    return h;
  }

  
  private ensureAgentHeapValid(agent: string): PriorityTask[] {
    const key = normalizeName(agent);
    const h = this.heaps.get(key);
    if (!h || h.length === 0) return h ?? [];
    const now = Date.now();
    if (now <= this.lastHeapifyMs.get(key)!) return h;
    
    for (let i = h.length - 1; i >= 0; i--) this.siftDown(h, i);
    this.lastHeapifyMs.set(key, now);
    return h;
  }

  enqueue(task: Omit<PriorityTask, "createdAt">): boolean {
    if (this.size() >= TaskPriorityManager.MAX_QUEUE_SIZE) {
      logger.warn(`Task queue full (${TaskPriorityManager.MAX_QUEUE_SIZE}). Dropping lowest priority task.`);
      this.evictLowest();
    }
    const full: PriorityTask = { ...task, createdAt: new Date().toISOString() };
    const key = normalizeName(full.to);
    const h = this.heapFor(full.to);
    h.push(full);
    
    
    
    for (let i = h.length - 1; i >= 0; i--) this.siftDown(h, i);
    this.lastHeapifyMs.set(key, Date.now());
    return true;
  }

  dequeue(agent: string): PriorityTask | undefined {
    const h = this.ensureAgentHeapValid(agent);
    if (h.length === 0) return undefined;
    return this.removeAt(h, 0);
  }

  peek(agent: string): PriorityTask | undefined {
    const h = this.ensureAgentHeapValid(agent);
    return h.length === 0 ? undefined : h[0];
  }

  removeFromQueue(handoffId: string): boolean {
    for (const [, h] of this.heaps) {
      const idx = h.findIndex((t) => t.handoffId === handoffId);
      if (idx !== -1) {
        this.removeAt(h, idx);
        return true;
      }
    }
    return false;
  }

  getQueue(): PriorityTask[] {
    const all: PriorityTask[] = [];
    for (const h of this.heaps.values()) all.push(...h);
    return all.sort((a, b) => TaskPriorityManager.effectivePriority(b) - TaskPriorityManager.effectivePriority(a));
  }

  getQueueForAgent(agent: string): PriorityTask[] {
    const h = this.heaps.get(normalizeName(agent)) ?? [];
    return h
      .slice()
      .sort((a, b) => TaskPriorityManager.effectivePriority(b) - TaskPriorityManager.effectivePriority(a));
  }

  size(): number {
    let n = 0;
    for (const h of this.heaps.values()) n += h.length;
    return n;
  }

  isQueued(handoffId: string): boolean {
    for (const h of this.heaps.values()) {
      if (h.some((t) => t.handoffId === handoffId)) return true;
    }
    return false;
  }

  

  
  private evictLowest(): void {
    let lowestAgentKey: string | null = null;
    let lowestIdx = -1;
    let lowestScore = Infinity;
    for (const [key, h] of this.heaps) {
      for (let i = 0; i < h.length; i++) {
        const score = TaskPriorityManager.effectivePriority(h[i]!);
        if (score < lowestScore) {
          lowestScore = score;
          lowestIdx = i;
          lowestAgentKey = key;
        }
      }
    }
    if (lowestAgentKey === null || lowestIdx === -1) return;
    this.removeAt(this.heaps.get(lowestAgentKey)!, lowestIdx);
  }

  
  private removeAt(h: PriorityTask[], idx: number): PriorityTask {
    const removed = h[idx]!;
    const last = h.length - 1;
    if (idx !== last) {
      h[idx] = h[last]!;
      h.pop();
      this.siftUp(h, idx);
      this.siftDown(h, idx);
    } else {
      h.pop();
    }
    return removed;
  }

  private siftUp(h: PriorityTask[], idx: number): void {
    let i = idx;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (TaskPriorityManager.effectivePriority(h[i]!) <= TaskPriorityManager.effectivePriority(h[parent]!)) break;
      [h[i], h[parent]] = [h[parent]!, h[i]!];
      i = parent;
    }
  }

  private siftDown(h: PriorityTask[], idx: number): void {
    let i = idx;
    const n = h.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let largest = i;
      if (
        left < n &&
        TaskPriorityManager.effectivePriority(h[left]!) > TaskPriorityManager.effectivePriority(h[largest]!)
      ) {
        largest = left;
      }
      if (
        right < n &&
        TaskPriorityManager.effectivePriority(h[right]!) > TaskPriorityManager.effectivePriority(h[largest]!)
      ) {
        largest = right;
      }
      if (largest === i) break;
      [h[i], h[largest]] = [h[largest]!, h[i]!];
      i = largest;
    }
  }
}
