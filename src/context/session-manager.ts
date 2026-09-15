

import { randomUUID } from "node:crypto";
import { access, readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { isProcessAlive } from "../utils/process.ts";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { toSessionInfo as apiToSessionInfo, toHookInput as apiToHookInput } from "../services/opencode-session-api.ts";
import type { SessionInfo as ApiSessionInfo, HookInput } from "../services/opencode-session-api.ts";
import { logger } from "../utils/logger.ts";


async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmp, filePath);
}

export interface SessionInfo {
  sessionId: string;
  createdAt: string;
  directory: string;
  pid: number;
}

export class SessionManager {
  private sessionId: string;
  private sessionInfo: SessionInfo;
  private sessionRegistryPath: string;

  constructor(directory: string) {
    this.sessionRegistryPath = resolve(directory, ".opencode", "tawassul-sessions");
    this.sessionId = this.generateSessionId();
    this.sessionInfo = {
      sessionId: this.sessionId,
      createdAt: new Date().toISOString(),
      directory,
      pid: process.pid,
    };
    // I/O deferred to start() — called from lifecycleManager.init()
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${randomUUID().slice(0, 8)}`;
  }

  async start(): Promise<void> {
    try {
      try {
        await access(this.sessionRegistryPath, constants.F_OK);
      } catch {
        await mkdir(this.sessionRegistryPath, { recursive: true });
      }
      const registryFile = resolve(this.sessionRegistryPath, "registry.json");
      let registry: Record<string, SessionInfo> = {};

      
      
      
      const SCHEMA_VERSION = 1;
      try {
        await access(registryFile, constants.F_OK);
        const rawRegistry = await readFile(registryFile, "utf-8");
        try {
          const parsed = JSON.parse(rawRegistry) as Record<string, SessionInfo> & { _schemaVersion?: number };
          if (parsed._schemaVersion !== undefined && parsed._schemaVersion !== SCHEMA_VERSION) {
            logger.warn(
              `[tawassul] session registry schema v${parsed._schemaVersion} ≠ v${SCHEMA_VERSION} — ` +
                `attempting graceful load; report issues if sessions are lost`,
            );
          }
          delete parsed._schemaVersion;
          registry = parsed as Record<string, SessionInfo>;
        } catch (parseErr) {
          
          
          
          const backup = `${registryFile}.corrupt.${Date.now()}`;
          try {
            await writeFile(backup, rawRegistry, "utf-8");
            logger.warn(`session registry was malformed — backed up to ${backup}:`, parseErr);
          } catch (backupErr) {
            logger.warn("session registry was malformed and backup failed — continuing empty:", backupErr);
          }
          registry = {};
        }
      } catch {
        registry = {}; 
      }

      registry[this.sessionId] = this.sessionInfo;
      await atomicWriteJson(registryFile, { ...registry, _schemaVersion: SCHEMA_VERSION });
    } catch (e) {
      logger.warn("Failed to register session:", e);
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionInfo(): SessionInfo {
    return { ...this.sessionInfo };
  }

  
  async cleanup(): Promise<void> {
    try {
      const registryFile = resolve(this.sessionRegistryPath, "registry.json");
      try {
        await access(registryFile, constants.F_OK);
        const registry: Record<string, SessionInfo> = JSON.parse(await readFile(registryFile, "utf-8"));
        delete registry[this.sessionId];
        await atomicWriteJson(registryFile, registry);
      } catch {
        /* file doesn't exist or can't be read */
      }
    } catch (e) {
      logger.warn("Failed to cleanup session:", e);
    }
  }

  
  static async getActiveSessions(directory: string): Promise<SessionInfo[]> {
    const registryPath = resolve(directory, ".opencode", "tawassul-sessions", "registry.json");
    try {
      await access(registryPath, constants.F_OK);
    } catch {
      return [];
    }

    try {
      const registry: Record<string, unknown> = JSON.parse(await readFile(registryPath, "utf-8"));
      return Object.entries(registry)
        .filter(([k]) => k !== "_schemaVersion")
        .map(([, v]) => v as SessionInfo);
    } catch {
      return [];
    }
  }

  
  static isSessionActive(session: SessionInfo): boolean {
    return isProcessAlive(session.pid);
  }

  
  toApiSessionInfo(): ApiSessionInfo {
    return apiToSessionInfo({
      sessionID: this.sessionId,
    });
  }

  
  fromHookInput(input: HookInput): ApiSessionInfo {
    return apiToSessionInfo(input);
  }

  
  toHookInput(): HookInput {
    return apiToHookInput(this.toApiSessionInfo());
  }
}
