
import type { HandoffEntry } from "../context/types.ts";

import type { TawaOrchestratorContext } from "./service-context.ts";
import { logger } from "../utils/logger.ts";

export interface SagaEffect<C = TawaOrchestratorContext> {
  name: string;
  execute: (p: { handoff: HandoffEntry; ctx: C }) => Promise<void>;
  compensate: (p: { handoff: HandoffEntry; ctx: C }) => Promise<void>;
}

export function effect<C = TawaOrchestratorContext>(
  name: string,
  execute: (handoff: HandoffEntry, ctx: C) => void | Promise<void>,
  compensate: (handoff: HandoffEntry, ctx: C) => void | Promise<void>,
): SagaEffect<C> {
  return {
    name,
    async execute({ handoff: h, ctx }) {
      await execute(h, ctx);
    },
    async compensate({ handoff: h, ctx }) {
      await compensate(h, ctx);
    },
  };
}


export function fireAndForget<C = TawaOrchestratorContext>(
  name: string,
  execute: (handoff: HandoffEntry, ctx: C) => void | Promise<void>,
  compensate?: (handoff: HandoffEntry, ctx: C) => void | Promise<void>,
): SagaEffect<C> {
  return {
    name,
    async execute({ handoff: h, ctx }) {
      await execute(h, ctx);
    },
    async compensate({ handoff: h, ctx }) {
      if (compensate) {
        await compensate(h, ctx);
        return;
      }
      logger.warn(`[saga] ⚠️ ${name} cannot be compensated — side effect left applied`);
    },
  };
}


export function safeSideEffect<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    logger.warn(`${label} failed:`, e);
    return undefined;
  }
}
