import { logger } from "../utils/logger.ts";
import { t } from "../translations.ts";

const RETRY_CATEGORIES = new Set(["rate_limited", "timeout", "network", "temporary"]);
const ESCALATE_CATEGORIES = new Set(["auth_error", "validation", "not_found", "permission", "security"]);


export const MAX_RETRIES = 5;

export interface HealDecision {
  action: "retry" | "escalate";
  reason: string;
  retryCount: number;
}

export class HealPolicy {
  private maxRetries: number;

  constructor(options?: { maxRetries?: number }) {
    this.maxRetries = options?.maxRetries ?? MAX_RETRIES;
  }

  decide(category: string, retryCount: number): HealDecision {
    if (retryCount >= this.maxRetries) {
      return { action: "escalate", reason: t("hpMaxRetries", { max: String(this.maxRetries) }), retryCount };
    }
    if (RETRY_CATEGORIES.has(category)) {
      return { action: "retry", reason: t("hpTransient", { category }), retryCount: retryCount + 1 };
    }
    if (ESCALATE_CATEGORIES.has(category)) {
      return { action: "escalate", reason: t("hpPermanent", { category }), retryCount };
    }
    logger.warn(t("hpUnknownWarn", { category, count: String(retryCount) }));
    return { action: "escalate", reason: t("hpUnknownClass", { category }), retryCount };
  }
}
