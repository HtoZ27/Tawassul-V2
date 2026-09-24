import { Plugin } from "@opencode/plugin";
import { initPlugin } from "./bootstrap/plugin-init.ts";
import { createV2Setup } from "./v2/setup.ts";

export const tawassul: Plugin.Plugin & { server: typeof initPlugin } = {
  id: "tawassul",
  server: initPlugin,
  setup: createV2Setup(),
};

export default Plugin.define(tawassul);