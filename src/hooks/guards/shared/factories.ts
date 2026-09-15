
import type { ValidationStage } from "../../tool-execute-types.ts";
import type { Ctx, GuardFn, Input, StageOutput } from "./types.ts";


import { logger } from "../../../utils/logger.ts";
import { t } from "../../../translations.ts";


export function guard(name: string, fn: GuardFn): ValidationStage {
  return {
    name,
    check: async (ctx, input, output) => {
      let err: string | null | undefined;
      try {
        err = fn(ctx, input, output);
      } catch (e) {
        
        
        logger.error(`[tawassul] GUARD_THROW "${name}":`, e instanceof Error ? e.message : e);
        try {
          logger.audit("GUARD_THROW", { guard: name, error: e instanceof Error ? e.message : String(e) });
        } catch {
          void 0;
        }
        output.error = t("guardFailClosed", { name });
        return false;
      }
      if (err) {
        output.error = err;
        return false;
      }
      return true;
    },
  };
}

export function guardWithRetry(name: string, fn: GuardFn, retries = 2): ValidationStage {
  return {
    name,
    check: async (ctx, input, output) => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const err = fn(ctx, input, output);
          if (err) {
            output.error = err;
            return false;
          }
          return true;
        } catch {
          if (attempt < retries)
            await new Promise((r) => {
              const t = setTimeout(r, 100 * attempt);
              t.unref?.();
            });
          else throw new Error(`Guard "${name}" فشل بعد ${retries} محاولات`);
        }
      }
      return true;
    },
  };
}

export function effect(
  name: string,
  fn: (ctx: Ctx, input: Input, output: StageOutput) => Promise<void> | void,
): ValidationStage {
  return {
    name,
    check: async (ctx, input, output) => {
      try {
        await fn(ctx, input, output);
      } catch (e) {
        
        
        
        logger.warn(`[tawassul] effect "${name}" threw — skipped:`, e instanceof Error ? e.message : e);
        try {
          logger.audit("EFFECT_SKIPPED", { effect: name, error: e instanceof Error ? e.message : String(e) });
        } catch {
          void 0;
        }
      }
      return true;
    },
  };
}


export function combinedStage(groupName: string, checks: ValidationStage[]): ValidationStage {
  return {
    name: groupName,
    async check(ctx, input, output) {
      for (const c of checks) {
        const ok = await c.check(ctx, input, output);
        if (!ok) {
          
          (output as Record<string, unknown>).blockingGuard = c.name;
          return false;
        }
      }
      return true;
    },
  };
}
