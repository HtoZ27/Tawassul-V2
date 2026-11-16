import { CircuitBreaker } from "./circuit-breaker.ts";
import { secureRandom } from "../utils/crypto.ts";

export interface FallbackConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  budget: number;
  
  circuitBreaker?: CircuitBreaker;
  
  component?: string;
}

const DEFAULT_CONFIG: FallbackConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  budget: 10,
};

export class ForegroundFallback {
  private usedBudget = 0;
  private config: FallbackConfig;

  constructor(config?: Partial<FallbackConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute<T>(fn: () => Promise<T>, fallbackFn: () => Promise<T>): Promise<T> {
    const cb = this.config.circuitBreaker;
    const component = this.config.component;

    if (cb && component) {
      if (cb.evaluate(component) === "OPEN") return fallbackFn();
    }

    if (this.usedBudget >= this.config.budget) {
      return fallbackFn();
    }

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await fn();
        this.usedBudget = Math.max(0, this.usedBudget - 1);
        cb?.recordSuccess(component!);
        return result;
      } catch {
        this.usedBudget++;
        cb?.recordFailure(component!);
        if (attempt < this.config.maxRetries) {
          const exponential = Math.min(this.config.baseDelayMs * Math.pow(2, attempt - 1), this.config.maxDelayMs);
          const jitter = exponential * (0.5 + secureRandom() * 0.5);
          await new Promise((r) => setTimeout(r, jitter));
        }
      }
    }

    return fallbackFn();
  }

  resetBudget(fraction = 1): void {
    if (fraction >= 1) {
      this.usedBudget = 0;
    } else {
      this.usedBudget = Math.max(0, this.usedBudget - Math.floor(this.config.budget * fraction));
    }
  }

  getBudgetRemaining(): number {
    return Math.max(0, this.config.budget - this.usedBudget);
  }
}
