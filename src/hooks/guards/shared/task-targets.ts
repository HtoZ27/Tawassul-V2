import { TASK_PERMISSIONS } from "../../../security-policy.ts";
import { resolveRole } from "../../../utils/agent.ts";

export function allowedTaskTargets(agent?: string): readonly string[] {
  const role = resolveRole(agent ?? "");
  return role ? (TASK_PERMISSIONS[role] ?? []) : [];
}

export function allowedTaskTargetsText(agent?: string): string {
  return allowedTaskTargets(agent)
    .map((target) => `@${target}`)
    .join(" or ");
}
