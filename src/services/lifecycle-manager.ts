

import type { TawaOrchestratorContext } from "../core/service-context.ts";
import { StatePersistence } from "./state-persistence.ts";
import { LifecycleController } from "./lifecycle-controller.ts";

export class LifecycleManager {
  
  get saveTimeout(): ReturnType<typeof setTimeout> | null {
    return this.persistence.saveTimeout;
  }
  set saveTimeout(v: ReturnType<typeof setTimeout> | null) {
    this.persistence.saveTimeout = v;
  }
  get saveDirty(): boolean {
    return this.persistence.saveDirty;
  }

  private persistence: StatePersistence;
  private controller: LifecycleController;

  constructor(ctx: TawaOrchestratorContext) {
    this.persistence = new StatePersistence(ctx, ctx.timerManager);
    this.controller = new LifecycleController(ctx, this.persistence);
  }

  init(): Promise<void> {
    return this.controller.init();
  }
  async saveState(): Promise<void> {
    return this.persistence.saveState();
  }
  flushSaves(): Promise<void> {
    return this.persistence.flushSaves();
  }
  markDisposing(): void {
    this.controller.markDisposing();
  }
  doSave(type?: string): Promise<void> {
    return this.persistence.doSave(type);
  }
  loadStateAsync(): Promise<void> {
    return this.persistence.loadStateAsync();
  }
  clearAllState(): string {
    return this.controller.clearAllState();
  }
  destroy(): Promise<void> {
    return this.controller.destroy();
  }
  addCleanupCallback(cb: () => void): void {
    this.controller.addCleanupCallback(cb);
  }
}
