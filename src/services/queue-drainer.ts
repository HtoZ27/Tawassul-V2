import type { HandoffEntry } from "../context/types.ts";
import type { SagaEffect } from "../core/saga-effects.ts";
import type { QueueDrainerPort, TawaOrchestratorContext } from "../core/service-context.ts";
import { effect } from "../core/saga-effects.ts";
import { normalizeName } from "../utils/name-utils.ts";

export interface QueueDrainerOptions {
  drainThreshold?: number;
  drainBatchSize?: number;
}


export interface DrainSource {
  shouldDrain: (agent: string, threshold?: number) => boolean;
}

export class QueueDrainer implements QueueDrainerPort {
  private drainThreshold: number;
  private drainBatchSize: number;

  constructor(
    private source: DrainSource,
    opts: QueueDrainerOptions = {},
  ) {
    this.drainThreshold = opts.drainThreshold ?? 5;
    this.drainBatchSize = opts.drainBatchSize ?? 2;
  }

  
  shouldDrain(agent: string, _allHandoffs?: HandoffEntry[]): boolean {
    return this.source.shouldDrain(agent, this.drainThreshold);
  }

  
  buildDrainEffects(
    agent: string,
    allHandoffs: HandoffEntry[],
    alternateAgent: string,
  ): SagaEffect<TawaOrchestratorContext>[] {
    const normalized = normalizeName(agent);
    const pending = allHandoffs
      .filter((h) => normalizeName(h.to) === normalized && h.status === "pending")
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(0, this.drainBatchSize);

    return pending.map((h) => {
      const originalTo = h.to;
      return effect(
        `drain:${h.id}`,
        async (_handoff, ctx) => {
          const real = ctx.handoffs.get(h.id);
          if (!real || real.status !== "pending") return;
          real.to = alternateAgent;
          ctx.handoffs.set(real.id, real);
        },
        async (_handoff, ctx) => {
          const real = ctx.handoffs.get(h.id);
          if (!real) return;
          real.to = originalTo;
          ctx.handoffs.set(real.id, real);
        },
      );
    });
  }
}
