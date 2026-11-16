
import type { ConflictLearner } from "../conflict-resolver/learner.ts";
import { logger } from "../utils/logger.ts";

export function logRuleAdjustments(learner: ConflictLearner): void {
  const adjustments = learner.checkAllRules();
  if (adjustments.length > 0) {
    logger.debug(`Rule adjustments recommended: ${
      adjustments.map(a => `${a.ruleId}(${a.disable ? 'disable' : `priority=${a.adjustPriority}`})`).join(', ')
    }`);
  }
}
