import { Plugin } from "@opencode/plugin";
import { initPlugin } from "./bootstrap/plugin-init.ts";
import { createV2Setup } from "./v2/setup.ts";

export const createHooks = initPlugin;

export const tawassul: Plugin.Plugin = {
  id: "tawassul",
  setup: createV2Setup(),
};

export default Plugin.define(tawassul);