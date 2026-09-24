export interface Checkpoint {
  phase: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface RollbackResult {
  success: boolean;
  fromPhase: string;
  toPhase: string;
  reason?: string;
  aborted?: boolean;
  error?: string;
}

export class RollbackManager {
  private checkpoints: Checkpoint[] = [];
  private processedPhases = new Set<string>();

  checkpoint(phase: string, data: Record<string, unknown>): void {
    if (this.processedPhases.has(phase)) {
      throw new Error(`Phase "${phase}" was already recorded — non-atomic operation`);
    }
    this.checkpoints.push({ phase, data: JSON.parse(JSON.stringify(data)), timestamp: Date.now() });
    this.processedPhases.add(phase);
  }

  rollback(toPhase: string, reason?: string, signal?: AbortSignal): RollbackResult {
    if (signal?.aborted) {
      return {
        success: false,
        fromPhase: this.currentPhase(),
        toPhase,
        reason,
        aborted: true,
        error: "Rollback aborted by signal",
      };
    }
    const idx = this.checkpoints.findIndex((c) => c.phase === toPhase);
    if (idx < 0)
      return {
        success: false,
        fromPhase: this.currentPhase(),
        toPhase,
        reason,
        error: `No checkpoint found for phase "${toPhase}"`,
      };
    this.checkpoints = this.checkpoints.slice(0, idx + 1);
    this.processedPhases = new Set(this.checkpoints.map((c) => c.phase));
    return { success: true, fromPhase: this.currentPhase(), toPhase, reason };
  }

  listCheckpoints(): Checkpoint[] {
    return [...this.checkpoints];
  }

  currentPhase(): string {
    return this.checkpoints.length > 0 ? this.checkpoints[this.checkpoints.length - 1]!.phase : "initial";
  }

  verifyOnRollback(toPhase: string): boolean {
    const idx = this.checkpoints.findIndex((c) => c.phase === toPhase);
    if (idx < 0) return false;
    const data = this.checkpoints[idx]!.data;
    return data !== undefined && data !== null && Object.keys(data).length > 0;
  }

  clear(): void {
    this.checkpoints = [];
    this.processedPhases.clear();
  }
}
