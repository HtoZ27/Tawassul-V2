import { initPlugin } from "./bootstrap/plugin-init.ts";
import { createV2Setup } from "./v2/setup.ts";

export const tawassul = {
  id: "tawassul",
  server: initPlugin,
  setup: createV2Setup(),
};

export default tawassul;