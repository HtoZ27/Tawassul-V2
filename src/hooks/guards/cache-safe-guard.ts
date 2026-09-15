
import { guardWithRetry } from "./shared.ts";
import { logger } from "../../utils/logger.ts";
import { t } from "../../translations.ts";

const CACHE_UNSAFE_PATTERNS = [
  { field: "noCache", reason: t("csgNoCache") },
  { field: "cacheAction", reason: t("csgCacheAction") },
];

const CONTAMINATION_FIELDS = ["sessionID", "forceRefresh", "skipCache"];

export const cacheSafeGuard = guardWithRetry(
  "cache-safe",
  (_ctx, input, output) => {
    const args = output.args ?? {};
    for (const { field, reason } of CACHE_UNSAFE_PATTERNS) {
      if (field in args) {
        logger.audit("CACHE_SAFE_BLOCKED", { agent: input.agent, tool: input.tool, field, reason });
        return reason;
      }
    }
    if (typeof args.cacheKey !== "string") return null;
    if (args.cacheKey.length > 256) {
      logger.audit("CACHE_SAFE_BLOCKED", { agent: input.agent, tool: input.tool, reason: t("csgCacheKeyLong") });
      return t("csgCacheKeyTooLong");
    }
    for (const f of CONTAMINATION_FIELDS) {
      if (typeof args[f] === "string" && args[f] !== args.cacheKey) {
        logger.audit("CACHE_SAFE_BLOCKED", { agent: input.agent, tool: input.tool, field: f, cacheKey: args.cacheKey });
        return t("csgCacheKeyContamination", { field: f });
      }
    }

    if (
      typeof args.cacheKey === "string" &&
      (args.cacheKey.includes("__proto__") || args.cacheKey.includes("constructor"))
    ) {
      logger.audit("CACHE_SAFE_BLOCKED", { agent: input.agent, tool: input.tool, reason: "prototype pollution" });
      return t("csgCacheKeyProto");
    }

    return null;
  },
  2,
);
