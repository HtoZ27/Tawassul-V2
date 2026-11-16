

import { generateSignature } from "../../utils/error-signature.ts";
import { normalizeName } from "../../utils/name-utils.ts";

export class ErrorManager {
  agentErrors: Record<string, number> = {};
  private errorSignatures = new Map<string, string>();
  private static MAX_SIGNATURES = 1000;

  incrementError(agent: string): void {
    const key = normalizeName(agent);
    this.agentErrors[key] = (this.agentErrors[key] ?? 0) + 1;
  }

  getErrorCount(agent: string): number {
    return this.agentErrors[normalizeName(agent)] ?? 0;
  }

  clearErrors(agent?: string): void {
    if (agent) {
      delete this.agentErrors[normalizeName(agent)];
    } else {
      for (const k of Object.keys(this.agentErrors)) delete this.agentErrors[k];
    }
  }

  loadFrom(data: Record<string, number>): void {
    for (const k of Object.keys(this.agentErrors)) delete this.agentErrors[k];
    for (const [k, v] of Object.entries(data)) {
      this.agentErrors[normalizeName(k)] = v;
    }
  }

  toJSON(): Record<string, number> {
    return { ...this.agentErrors };
  }

  
  decayErrors(factor: number = 0.8, threshold: number = 0.5): void {
    for (const k of Object.keys(this.agentErrors)) {
      this.agentErrors[k] = Math.floor(this.agentErrors[k]! * factor);
      if (this.agentErrors[k]! < threshold) {
        delete this.agentErrors[k];
      }
    }
  }

  
  incrementErrorWithSignature(agent: string, rawError: string): string {
    const key = normalizeName(agent);
    const sig = generateSignature(rawError);
    this.errorSignatures.set(`${key}:${sig}`, rawError);
    if (this.errorSignatures.size > ErrorManager.MAX_SIGNATURES) {
      const firstKey = this.errorSignatures.keys().next().value;
      if (firstKey) this.errorSignatures.delete(firstKey);
    }
    this.incrementError(key);
    return sig;
  }

  
  getSignatureCount(agent: string, rawError: string): number {
    const key = normalizeName(agent);
    const sig = generateSignature(rawError);
    let count = 0;
    for (const [k] of this.errorSignatures) {
      if (k.startsWith(`${key}:${sig}`)) count++;
    }
    return count;
  }
}
