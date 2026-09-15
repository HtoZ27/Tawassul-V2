import { logger } from "../utils/logger.ts";

export function getRole(input: Record<string, unknown>, output: { message: { role: string } }): string {
  const inputRole = input.role;
  if (typeof inputRole === "string" && inputRole.trim().length > 0) {
    return inputRole;
  }
  const outputRole = output?.message?.role;
  if (typeof outputRole === "string" && outputRole.trim().length > 0) {
    return outputRole;
  }
  logger.warn("getRole: empty role — no input.role or output.message.role found");
  return "";
}
