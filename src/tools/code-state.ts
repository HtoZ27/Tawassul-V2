import type { TawassulContext } from "../context.ts";
import type { ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { CodeStateService } from "../services/code-state.ts";


export function buildCodeStateTool(tawaCtx: TawassulContext) {
  const projectRoot = tawaCtx.stateDir;
  const svc = new CodeStateService(projectRoot);

  return tool({
    description:
      "Code undo/redo via git snapshots — capture, undo, redo, restore, diff and list code states without touching the project's own .git",
    args: {
      action: tool.schema
        .enum(["snapshot", "undo", "redo", "status", "restore", "diff", "reset"])
        .describe("Operation to perform"),
      label: tool.schema.string().optional().describe("Label for a snapshot"),
      id: tool.schema.string().optional().describe("Snapshot id (restore) or id/index (diff)"),
      force: tool.schema.boolean().optional().describe("Overwrite unsaved changes (undo/redo/restore)"),
    },
    async execute(args: { action: string; label?: string; id?: string; force?: boolean }, _cctx: ToolContext) {
      try {
        switch (args.action) {
          case "snapshot": {
            const snap = await svc.capture(args.label ?? "manual", _cctx.messageID);
            const n = snap.changedFiles?.length ?? 0;
            return {
              title: "📸 Code snapshot",
              output: `Captured snapshot ${snap.id} (#${snap.index}) — ${snap.label} [${n} file(s) changed]`,
            };
          }
          case "undo": {
            const res = await svc.undo(args.force ?? false);
            if (!res.ok) return { title: "↩️ Undo", output: `❌ ${res.error}` };
            return { title: "↩️ Undo", output: `Undid snapshot ${res.snapshot!.id} (#${res.snapshot!.index})` };
          }
          case "redo": {
            const res = await svc.redo(args.force ?? false);
            if (!res.ok) return { title: "↪️ Redo", output: `❌ ${res.error}` };
            return { title: "↪️ Redo", output: `Redid snapshot ${res.snapshot!.id} (#${res.snapshot!.index})` };
          }
          case "restore": {
            if (!args.id) return { title: "⏮️ Restore", output: "❌ id is required for restore" };
            const res = await svc.restoreById(args.id, args.force ?? false);
            if (!res.ok) return { title: "⏮️ Restore", output: `❌ ${res.error}` };
            return { title: "⏮️ Restore", output: `Restored snapshot ${res.snapshot!.id} (#${res.snapshot!.index})` };
          }
          case "diff": {
            const d = await svc.diff(args.id);
            if (d === null) return { title: "🔍 Code diff", output: "No diff available for this snapshot." };
            return { title: "🔍 Code diff", output: d || "(no file changes)" };
          }
          case "status": {
            const st = await svc.status();
            if (st.snapshots.length === 0) {
              return { title: "📋 Code state", output: "No snapshots yet. Use action:snapshot to capture one." };
            }
            const lines = st.snapshots.map((s) => {
              const mark = s.index === st.pointer ? "▶" : " ";
              const n = s.changedFiles?.length ?? 0;
              return `${mark} #${s.index} ${s.id} ${s.label} (${n} file(s)) (${s.timestamp})`;
            });
            const unsaved = st.hasUnsavedChanges ? "\n⚠️ Working tree has unsaved changes since last snapshot." : "";
            return { title: "📋 Code state", output: lines.join("\n") + unsaved };
          }
          case "reset": {
            svc.reset();
            return { title: "🧹 Code state", output: "All snapshots cleared for this project." };
          }
          default:
            return { title: "❌ Code state", output: `Unknown action: ${args.action}` };
        }
      } catch (e) {
        return { title: "❌ Code state", output: `Error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });
}
