import { secureRandom } from "../utils/crypto.ts";


export interface DegradationPolicy {
  component: string;
  fallback: string;
  degradeOnErrors: number;
  cooldownMs: number;
}

export interface DegradationState {
  component: string;
  active: boolean;
  errorCount: number;
  lastDegradedAt: number | null;
  fallback: string;
}

export type DegradationCallback = (component: string, active: boolean, fallback: string) => void;

export class GracefulDegradation {
  private states: Map<string, DegradationState> = new Map();
  private policies: Map<string, DegradationPolicy> = new Map();
  private onDegraded: DegradationCallback | null = null;
  private onRecovered: DegradationCallback | null = null;

  setOnDegraded(cb: DegradationCallback): void {
    this.onDegraded = cb;
  }
  setOnRecovered(cb: DegradationCallback): void {
    this.onRecovered = cb;
  }

  register(policy: DegradationPolicy): void {
    this.policies.set(policy.component, policy);
    this.states.set(policy.component, {
      component: policy.component,
      active: false,
      errorCount: 0,
      lastDegradedAt: null,
      fallback: policy.fallback,
    });
  }

  recordError(component: string): void {
    const state = this.states.get(component);
    const policy = this.policies.get(component);
    if (!state || !policy) return;

    const now = Date.now();
    if (state.lastDegradedAt && now < state.lastDegradedAt) {
      state.lastDegradedAt = now;
    }

    state.errorCount++;
    if (state.errorCount >= policy.degradeOnErrors && !state.active) {
      state.active = true;
      state.lastDegradedAt = now;
      this.onDegraded?.(component, true, policy.fallback);
    }
  }

  recordSuccess(component: string): void {
    const state = this.states.get(component);
    if (!state) return;
    state.errorCount = 0;

    if (state.active && state.lastDegradedAt) {
      const policy = this.policies.get(component);
      if (!policy) return;
      const now = Date.now();
      const elapsed = now - state.lastDegradedAt;
      if (elapsed < 0) {
        state.active = false;
        this.onRecovered?.(component, false, state.fallback);
        return;
      }
      const jitter = policy.cooldownMs * (0.5 + secureRandom() * 0.5);
      if (elapsed >= jitter) {
        state.active = false;
        this.onRecovered?.(component, false, state.fallback);
      }
    }
  }

  getFallback(component: string): string | null {
    const state = this.states.get(component);
    if (!state || !state.active) return null;
    return state.fallback;
  }

  isDegraded(component: string): boolean {
    return this.states.get(component)?.active ?? false;
  }
}
