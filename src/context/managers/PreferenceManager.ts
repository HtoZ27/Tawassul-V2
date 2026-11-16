

import type { Strictness, TawassulConfig } from "../types.ts";

export class PreferenceManager {
  private config: TawassulConfig = {};

  setConfig(config: TawassulConfig): void {
    this.config = config;
  }

  strictness(): Strictness {
    return this.config.strictness ?? "normal";
  }

  getLanguage(): string | undefined {
    return this.config.language;
  }
}
