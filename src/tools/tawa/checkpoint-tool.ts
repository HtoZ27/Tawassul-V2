import { tool } from "../../tool.ts";
import type { ToolDefinition } from "../../tool.ts";
import type { CheckpointManager } from "../../services/checkpoint-manager.ts";

export function buildCheckpointTool(checkpointManager: CheckpointManager): ToolDefinition {
  return tool({
    description: "Create, list, or restore checkpoints for code state snapshots.",
    args: {
      action: tool.schema.enum(["create", "list", "restore", "diff"]).describe("Checkpoint action"),
      label: tool.schema.string().optional().describe("Label for the checkpoint (required for create/restore/diff)"),
      from: tool.schema.string().optional().describe("Source checkpoint ID (for diff)"),
      to: tool.schema.string().optional().describe("Target checkpoint ID (for diff, default: HEAD)"),
    },
    async execute(args) {
      switch (args.action) {
        case "create": {
          if (!args.label) return { title: "Checkpoint", output: "Error: label required for create." };
          const id = await checkpointManager.createSnapshot(args.label);
          return { title: "Checkpoint Created", output: `Checkpoint created: ${id}` };
        }
        case "list": {
          const snapshots = checkpointManager.listSnapshots();
          if (snapshots.length === 0) return { title: "Checkpoints", output: "No checkpoints found." };
          const lines = snapshots.map((s) => `- **${s.id}**: ${s.label} (${new Date(s.createdAt).toISOString()})`);
          return { title: "Checkpoints", output: lines.join("\n") };
        }
        case "restore": {
          if (!args.label) return { title: "Checkpoint", output: "Error: checkpoint ID required for restore." };
          await checkpointManager.restore(args.label);
          return { title: "Checkpoint Restored", output: `Restored to checkpoint: ${args.label}` };
        }
        case "diff": {
          if (!args.from) return { title: "Checkpoint", output: "Error: from ID required for diff." };
          const result = await checkpointManager.diff(args.from, args.to);
          return {
            title: "Checkpoint Diff",
            output: `From: ${result.from}\nTo: ${result.to}\nDiff: ${result.diff ?? "no changes"}`,
          };
        }
        default:
          return { title: "Checkpoint", output: `Unknown action: ${args.action}` };
      }
    },
  });
}
