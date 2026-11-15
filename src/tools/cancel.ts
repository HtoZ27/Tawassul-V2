import type { ToolResult } from "../tool.ts";

export function cancelledResult(): ToolResult {
  return { title: "Cancelled", output: "Cancelled", metadata: { status: "cancelled" } };
}
