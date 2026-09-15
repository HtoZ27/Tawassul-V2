

import { access, readFile } from "node:fs/promises";
import type { TawaPreferences } from "../../conflict-resolver/types.ts";
import { TawaPrefsSchema } from "../../validation.ts";
import { TAWA_PREFS_FILE } from "../constants.ts";
import { wrapWithHmac, unwrapWithHmac } from "../../utils/crypto.ts";
import { getWriteBlockReason } from "../../services/isolation.ts";
import { atomicWriteFile } from "../../utils/atomic.ts";
import { replaceLegacyEncryptedFields } from "../migration.ts";
import { logger } from "../../utils/logger.ts";
import { normalizeName } from "../../utils/name-utils.ts";
import type { TimerManagerLike } from "../../types/timer-types.ts";

export class ModelManager {
  agentModelMap: Record<string, string> = {};
  tawaPreferences: TawaPreferences;
  private safeConfigPath: (name: string | undefined, fallback: string) => string;
  private _prefsDirty = false;
  private _prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _prefsSavePromise: Promise<void> | null = null;
  private timers: TimerManagerLike | null;

  constructor(
    _stateDir: string,
    safeConfigPath: (name: string | undefined, fallback: string) => string,
    timers?: TimerManagerLike,
  ) {
    this.safeConfigPath = safeConfigPath;
    this.timers = timers ?? null;
    this.tawaPreferences = {
      modelChoices: {},
      userProviders: [],
      learnedPreferences: {},
      failedModels: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  private schedulePrefsSave(): void {
    this._prefsDirty = true;
    if (this._prefsSaveTimer) return;
    const fn = () => {
      this._prefsSaveTimer = null;
      if (this._prefsDirty) {
        this._prefsDirty = false;
        this._prefsSavePromise = this.saveTawaPrefsFile();
      }
    };
    this._prefsSaveTimer = this.timers
      ? (this.timers.setTimeout as (fn: () => void, ms: number) => ReturnType<typeof setTimeout>)(fn, 200)
      : (() => {
          const t = setTimeout(fn, 200);
          if (t?.unref) t.unref();
          return t;
        })();
  }

  tawaPrefsPath(): string {
    return this.safeConfigPath(TAWA_PREFS_FILE, TAWA_PREFS_FILE);
  }

  async saveTawaPrefsFile(): Promise<void> {
    
    
    
    const fp = this.tawaPrefsPath();
    const reason = getWriteBlockReason(fp);
    if (reason !== null) {
      logger.warn(
        reason === "foreign-key"
          ? "⛔ tawa-prefs save skipped: prefs file is signed by an unknown key and no local host key exists (foreign-key) — read-only on this device, no key created."
          : "⛔ tawa-prefs save skipped: session is isolated (read-only fail-safe).",
      );
      return;
    }
    try {
      const data: Record<string, unknown> = {
        modelChoices: this.tawaPreferences.modelChoices,
        userProviders: this.tawaPreferences.userProviders,
        learnedPreferences: this.tawaPreferences.learnedPreferences,
        failedModels: this.tawaPreferences.failedModels,
        lastUpdated: this.tawaPreferences.lastUpdated,
      };

      const signedPayload = wrapWithHmac(JSON.stringify(data, null, 2));

      await atomicWriteFile(fp, signedPayload);
    } catch (e) {
      logger.warn("Failed to save tawa-prefs.json:", e);
    }
  }

  async loadTawaPrefsFile(): Promise<void> {
    const fp = this.tawaPrefsPath();
    try {
      await access(fp);
    } catch {
      return;
    }
    try {
      const rawContent = await readFile(fp, "utf-8");

      const jsonStr = unwrapWithHmac(rawContent);
      if (jsonStr === null) return;

      const raw = JSON.parse(jsonStr);

      
      replaceLegacyEncryptedFields(
        raw,
        [
          { key: "userProviders", fallback: [] },
          { key: "learnedPreferences", fallback: {} },
          { key: "failedModels", fallback: {} },
        ],
        "Prefs",
      );

      const parsed = TawaPrefsSchema.parse(raw);
      if (parsed.modelChoices) {
        for (const [k, v] of Object.entries(parsed.modelChoices)) {
          this.tawaPreferences.modelChoices[normalizeName(k)] = v;
        }
      }
      if (parsed.userProviders) this.tawaPreferences.userProviders = parsed.userProviders;
      if (parsed.learnedPreferences) {
        for (const [k, v] of Object.entries(parsed.learnedPreferences)) {
          this.tawaPreferences.learnedPreferences[normalizeName(k)] = v;
        }
      }
      if (parsed.failedModels) {
        for (const [k, v] of Object.entries(parsed.failedModels)) {
          this.tawaPreferences.failedModels[normalizeName(k)] = v;
        }
      }
      if (parsed.lastUpdated) this.tawaPreferences.lastUpdated = parsed.lastUpdated;
    } catch (e) {
      logger.warn("Failed to load tawa-prefs.json:", e);
    }
  }

  suggestTawaModel(agent: string): string {
    const key = normalizeName(agent);
    const userChoice = this.tawaPreferences.modelChoices[key];
    if (userChoice) {
      const failed = this.tawaPreferences.failedModels[key];
      if (!failed) return userChoice;
      const elapsed = Date.now() - new Date(failed.failedAt).getTime();
      if (elapsed > 3600000) {
        this.clearModelFailure(key);
        return userChoice;
      }
    }
    if (this.agentModelMap[key] && !this.tawaPreferences.failedModels[key]) {
      return this.agentModelMap[key] as string;
    }
    return "opencode/big-pickle";
  }

  saveTawaPreference(agent: string, model: string): void {
    const key = normalizeName(agent);
    this.tawaPreferences.modelChoices[key] = model;
    this.tawaPreferences.lastUpdated = new Date().toISOString();
    this.clearModelFailure(key);
    this.schedulePrefsSave();
  }

  markModelFailed(agent: string, model: string, error: string): void {
    const key = normalizeName(agent);
    this.tawaPreferences.failedModels[key] = {
      model,
      failedAt: new Date().toISOString(),
      error: error.substring(0, 200),
    };
    this.schedulePrefsSave();
  }

  clearModelFailure(agent: string): void {
    delete this.tawaPreferences.failedModels[normalizeName(agent)];
    this.schedulePrefsSave();
  }

  async flushPrefsSave(): Promise<void> {
    if (this._prefsSaveTimer) {
      if (this.timers) this.timers.clear(this._prefsSaveTimer);
      else clearTimeout(this._prefsSaveTimer);
      this._prefsSaveTimer = null;
    }
    if (this._prefsDirty) {
      this._prefsDirty = false;
      const prev = this._prefsSavePromise;
      this._prefsSavePromise = (prev ? prev.then(() => this.saveTawaPrefsFile()) : this.saveTawaPrefsFile()).catch(
        (e) => {
          logger.warn("[tawassul] prefs save failed:", e?.message ?? e);
        },
      );
    }
    await this._prefsSavePromise;
  }

  getAvailableModels(): string[] {
    const models: string[] = ["opencode/big-pickle"];
    for (const model of Object.values(this.agentModelMap)) {
      if (!models.includes(model)) models.push(model);
    }
    for (const model of Object.values(this.tawaPreferences.modelChoices)) {
      if (!models.includes(model)) models.push(model);
    }
    return models;
  }
}
