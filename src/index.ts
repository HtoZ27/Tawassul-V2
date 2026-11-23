import { Plugin } from "@opencode/plugin";
import { initPlugin } from "./bootstrap/plugin-init.ts";
import { createV2Setup } from "./v2/setup.ts";
import { logger } from "./utils/logger.ts";

logger.info(`[tawassul] v2 module eval pid=${process.pid}`);

export const createHooks = initPlugin;

export const tawassul: Plugin.Plugin = {
  id: "tawassul",
  setup: createV2Setup(),
};

export default Plugin.define(tawassul);