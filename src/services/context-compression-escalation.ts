






import { countTokens, shouldCompress, DEFAULT_THRESHOLD, type Message } from "./context-compressor.ts";
import { logger } from "../utils/logger.ts";

export const CONTEXT_COMPRESSION_NEEDED = "CONTEXT_COMPRESSION_NEEDED";

export interface CompressionEscalationConfig {
  threshold?: number;
  
  maxTrackedTokens?: number;
}

export class ContextCompressionEscalation {
  private estimatedTokens = 0;
  private readonly threshold: number;
  private readonly maxTrackedTokens: number;
  private fired = false;
  private readonly emit?: (type: string, payload: Record<string, unknown>) => void;

  constructor(cfg: CompressionEscalationConfig = {}, emit?: (type: string, payload: Record<string, unknown>) => void) {
    this.threshold = cfg.threshold ?? DEFAULT_THRESHOLD;
    this.maxTrackedTokens = cfg.maxTrackedTokens ?? this.threshold * 4;
    this.emit = emit;
  }

  
  observe(text: string): void {
    this.estimatedTokens = Math.min(this.estimatedTokens + countTokens(text), this.maxTrackedTokens);
  }

  
  observeMessages(messages: Message[]): void {
    for (const m of messages) this.observe(m.content);
  }

  reset(): void {
    this.estimatedTokens = 0;
    this.fired = false;
  }

  get currentTokens(): number {
    return this.estimatedTokens;
  }

  
  isOverThreshold(): boolean {
    return shouldCompress({ input: this.estimatedTokens, output: 0 }, this.threshold);
  }

  
  evaluate(): boolean {
    if (this.fired) return false;
    if (!this.isOverThreshold()) return false;
    this.fired = true;
    const payload = {
      estimatedTokens: this.estimatedTokens,
      threshold: this.threshold,
      source: "tool-execute.after",
    };
    try {
      this.emit?.(CONTEXT_COMPRESSION_NEEDED, payload);
    } catch (e) {
      logger.warn("context-compression-escalation emit failed:", e);
    }
    return true;
  }
}
