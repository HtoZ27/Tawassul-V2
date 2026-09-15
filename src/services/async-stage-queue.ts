import { secureId } from "../utils/crypto.ts";





interface QueuedTask<T = unknown> {
  id: string;
  priority: number;
  execute: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  enqueuedAt: number;
}

export interface AsyncStageQueueOptions {
  maxConcurrency?: number;
  maxQueueSize?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_CONCURRENCY = 5;
const DEFAULT_MAX_QUEUE_SIZE = 1000;

export class AsyncStageQueue {
  private heap: QueuedTask[] = [];
  private activeCount = 0;
  private maxConcurrency: number;
  private maxQueueSize: number;
  private disposed = false;
  private drainResolvers: (() => void)[] = [];
  private activeControllers = new Set<AbortController>();
  private totalEnqueued = 0;
  private totalCompleted = 0;
  private totalFailed = 0;
  private totalRejected = 0;

  constructor(options?: AsyncStageQueueOptions) {
    this.maxConcurrency = options?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.maxQueueSize = options?.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    options?.signal?.addEventListener("abort", () => this.dispose(), { once: true });
  }

  enqueue<T>(task: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.disposed) {
        reject(new Error("AsyncStageQueue is disposed"));
        return;
      }
      if (this.heap.length >= this.maxQueueSize) {
        this.totalRejected++;
        reject(new Error(`AsyncStageQueue full (max ${this.maxQueueSize}). Backpressure applied.`));
        return;
      }

      const id = `Q-${Date.now()}-${secureId()}`;
      const entry: QueuedTask<T> = {
        id,
        priority,
        execute: task,
        resolve: resolve as (value: T) => void,
        reject,
        enqueuedAt: Date.now(),
      };

      this.heapPush(entry as QueuedTask);
      this.totalEnqueued++;

      if (this.activeCount < this.maxConcurrency) {
        queueMicrotask(() => this.tryDrain());
      }
    });
  }

  private heapPush(task: QueuedTask): void {
    this.heap.push(task);
    let idx = this.heap.length - 1;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      const pTask = this.heap[parent];
      if (!pTask || pTask.priority >= task.priority) break;
      this.heap[idx] = pTask;
      idx = parent;
    }
    this.heap[idx] = task;
  }

  private heapPop(): QueuedTask | undefined {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private sinkDown(idx: number): void {
    const size = this.heap.length;
    const task = this.heap[idx];
    if (!task) return;
    while (true) {
      let largest = idx;
      const left = (idx << 1) + 1;
      const right = left + 1;

      if (left < size) {
        const lTask = this.heap[left];
        if (lTask && lTask.priority > task.priority) largest = left;
      }
      if (right < size) {
        const rTask = this.heap[right];
        const largestTask = this.heap[largest];
        if (rTask && largestTask && rTask.priority > largestTask.priority) largest = right;
      }
      if (largest === idx) break;
      this.heap[idx] = this.heap[largest]!;
      this.heap[largest] = task;
      idx = largest;
    }
  }

  private tryDrain(): void {
    while (this.activeCount < this.maxConcurrency && this.heap.length > 0) {
      const task = this.heapPop();
      if (!task) break;

      this.activeCount++;
      this.executeTask(task).finally(() => {
        this.activeCount--;
        if (!this.disposed) {
          const t = setTimeout(() => this.tryDrain(), 0); t.unref?.();
        }
      });
    }

    if (this.heap.length === 0 && this.activeCount === 0 && this.drainResolvers.length > 0) {
      const resolvers = this.drainResolvers.splice(0);
      for (const r of resolvers) r();
    }
  }

  private async executeTask(task: QueuedTask): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.add(controller);
    try {
      const result = await task.execute(controller.signal);
      this.totalCompleted++;
      task.resolve(result);
    } catch (e) {
      this.totalFailed++;
      task.reject(e);
    } finally {
      this.activeControllers.delete(controller);
    }
  }

  async drain(): Promise<void> {
    if (this.heap.length === 0 && this.activeCount === 0) return;
    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  get pendingCount(): number {
    return this.heap.length;
  }

  get activeTaskCount(): number {
    return this.activeCount;
  }

  get metrics() {
    return {
      pending: this.heap.length,
      active: this.activeCount,
      totalEnqueued: this.totalEnqueued,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
      totalRejected: this.totalRejected,
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const task of this.heap) {
      task.reject(new Error("AsyncStageQueue disposed"));
    }
    this.heap.length = 0;
    for (const controller of this.activeControllers) {
      controller.abort();
    }
    this.activeControllers.clear();
    if (this.drainResolvers.length > 0) {
      const resolvers = this.drainResolvers.splice(0);
      for (const r of resolvers) r();
    }
  }
}
