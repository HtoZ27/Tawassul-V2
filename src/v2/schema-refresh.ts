import { logger } from "../utils/logger.ts";

export type SchemaRefreshProbe = () => Promise<{ ready: boolean; error?: { message?: string } }>;

export type SchemaRefreshOptions = {
  probe: SchemaRefreshProbe;
  refresh: () => Promise<boolean | void>;
  reload: () => Promise<void>;
  describe: () => string;
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logInfo?: (message: string) => void;
  logWarn?: (message: string, error?: unknown) => void;
};

export type SchemaRefreshHandle = {
  done: Promise<void>;
  stop: () => Promise<void>;
};

export const DEFAULT_ATTEMPTS = 6;
export const DEFAULT_DELAY_MS = 500;

export function startSchemaRefresh(options: SchemaRefreshOptions): SchemaRefreshHandle {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (timer.unref) timer.unref();
      }));
  const info = options.logInfo ?? ((message: string) => logger.info(message));
  const warn = options.logWarn ?? ((message: string, error?: unknown) => logger.warn(message, error));
  let stopped = false;
  const done = (async () => {
    try {
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (stopped) return;
        const status = await options.probe();
        if (status.ready) {
          const changed = (await options.refresh()) !== false;
          if (stopped) return;
          if (!changed) {
            info(
              `[tawassul] v2 tool schemas unchanged after init (${options.describe()}); reload skipped`,
            );
            return;
          }
          try {
            await options.reload();
            info(
              `[tawassul] v2 tool schemas refreshed after init (${options.describe()}, attempt ${attempt + 1})`,
            );
          } catch (e) {
            warn("[tawassul] v2 tool reload failed; placeholders stay until restart:", e);
          }
          return;
        }
        if (attempt === attempts - 1) {
          warn(
            `[tawassul] v2 schema refresh gave up after ${attempts} attempts: init not ready (${status.error?.message ?? "pending"})`,
          );
          return;
        }
        await sleep(delayMs);
      }
    } catch (e) {
      warn("[tawassul] v2 schema refresh failed:", e);
    }
  })();
  const stop = async (): Promise<void> => {
    stopped = true;
    await done;
  };
  return { done, stop };
}
