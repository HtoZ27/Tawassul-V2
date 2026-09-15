import { z } from "zod";
import { logger } from "../utils/logger.ts";
import { schedulePersist, hmacWriteFile, hmacReadFile, resolveConfigPath } from "./persist-utils.ts";

export interface BaseServiceConfig {
  storagePath: string;
}

export abstract class BaseInnovationService<TConfig extends BaseServiceConfig, TEvent = never> {
  protected config: TConfig;
  protected storagePath: string;
  protected eventListeners: Array<(event: TEvent) => void> = [];

  constructor(config: Partial<TConfig> | undefined, schema: z.ZodSchema<TConfig>) {
    this.config = schema.parse(config || {});
    this.storagePath = resolveConfigPath(this.config.storagePath);
  }

  onEvent(listener: (event: TEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  protected emitEvent(event: TEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error("Event listener error:", error);
      }
    }
  }

  protected persistToDisk(persistKey: string, buildData: () => Record<string, unknown>): void {
    schedulePersist(persistKey, async () => {
      try {
        await hmacWriteFile(this.storagePath, {
          version: "1.0.0",
          persistedAt: new Date().toISOString(),
          ...buildData(),
        });
      } catch (error) {
        logger.error("Failed to persist:", error);
      }
    });
  }

  protected async readFromDisk<T>(): Promise<T | null> {
    return hmacReadFile<T>(this.storagePath);
  }

  abstract clear(): void;
}

export interface ServiceSingleton<T extends { clear(): void }> {
  get(config?: unknown): T;
  reset(): void;
}

export function createSingleton<T extends { clear(): void }>(
  createInstance: (config?: unknown) => T,
  warnOnConfigIgnored = false,
): ServiceSingleton<T> {
  let instance: T | null = null;

  return {
    get(config?: unknown): T {
      if (!instance) {
        instance = createInstance(config);
      } else if (config !== undefined && warnOnConfigIgnored) {
        logger.warn("getInstance called with config but instance already exists — config ignored");
      }
      return instance;
    },

    reset(): void {
      if (instance) {
        instance.clear();
        instance = null;
      }
    },
  };
}
