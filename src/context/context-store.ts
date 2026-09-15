

import { AsyncLocalStorage } from "node:async_hooks";
import type { TawassulContext } from "../context-class.ts";


export const contextStore = new AsyncLocalStorage<TawassulContext>();


export async function runWithContext<T>(ctx: TawassulContext, fn: () => Promise<T>): Promise<T> {
  return contextStore.run(ctx, fn);
}


export function getContext(): TawassulContext {
  const ctx = contextStore.getStore();
  if (!ctx) {
    throw new Error(
      "[tawassul] No TawassulContext available. " +
        "Ensure you are within a runWithContext() call or use the explicit ctx parameter.",
    );
  }
  return ctx;
}


export function getContextOrNull(): TawassulContext | null {
  return contextStore.getStore() ?? null;
}


export function hasContext(): boolean {
  return contextStore.getStore() !== undefined;
}


export function withContext<TArgs extends unknown[], TResult>(
  fn: (ctx: TawassulContext, ...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  return (...args: TArgs): TResult => {
    const ctx = getContext();
    return fn(ctx, ...args);
  };
}


export type OptionalContextFn<T extends (...args: never[]) => unknown> = (
  ctx: TawassulContext | undefined,
  ...args: Parameters<T>
) => ReturnType<T>;


export function withAutoContext<TArgs extends unknown[], TResult>(
  fn: (ctx: TawassulContext, ...args: TArgs) => TResult,
): (ctx: TawassulContext | undefined, ...args: TArgs) => TResult {
  return (ctx: TawassulContext | undefined, ...args: TArgs): TResult => {
    const resolvedCtx = ctx ?? getContext();
    return fn(resolvedCtx, ...args);
  };
}
