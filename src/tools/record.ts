import type { TawassulContext } from "../context.ts";
import type { ToolDefinition, ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { t, recordTypeLabel } from "../translations.ts";
import { severityEmoji, recordEmoji } from "../utils/format.ts";
import { toolScopeOnlyHint } from "../utils/text-utils.ts";
import type { RecordEntry } from "../context/types.ts";
import { RecordEntrySchema } from "../validation.ts";
import { normalizeName } from "../utils/name-utils.ts";

const RECORD_TYPE_ENUM = RecordEntrySchema.shape.type;
const RECORD_SEVERITY_ENUM = RecordEntrySchema.shape.severity.unwrap();
export const VALID_TYPES = RECORD_TYPE_ENUM.options as readonly string[];
export const VALID_SEVERITIES = RECORD_SEVERITY_ENUM.options as readonly string[];

export function buildRecordTool(ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Record a decision, fix, incident, or note for the project history.",
      toolScopeOnlyHint("Session records live ONLY behind this tool", "them"),
      "",
      "WRITE — REQUIRED: type, title, detail",
      "OPTIONAL: severity (for fixes/incidents)",
      "",
      "READ-BACK (write-only gap fix):",
      '  record(get: "R-001")        → one record by id',
      "  record(list: true)          → all session records",
      "",
      "EXAMPLES:",
      '  record(type: "decision", title: "We use React", detail: "We chose React for its easy ecosystem")',
      '  record(type: "fix",   title: "Null pointer", detail: "src/main.rs:42 — cursor not initialized", severity: "critical")',
      '  record(type: "incident", title: "Lost data", detail: "Cache clear() erased user data", severity: "severe")',
      '  record(type: "note",  title: "Improvement", detail: "We need to refactor module X")',
      "",
      'To DELETE a record: record(delete: "R-001")',
    ].join("\n"),
    args: {
      type: tool.schema.enum(VALID_TYPES as [string, ...string[]]).optional(),
      title: tool.schema.string().optional().describe("Short title"),
      detail: tool.schema.string().optional().describe("Detailed description"),
      severity: tool.schema
        .enum(VALID_SEVERITIES as [string, ...string[]])
        .optional()
        .describe("For fixes/incidents"),
      get: tool.schema.string().optional().describe("Record ID to read back (e.g. R-001)"),
      list: tool.schema.boolean().optional().describe("List all session records"),
      delete: tool.schema.string().optional().describe("Record ID to delete (e.g. R-001)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      if (args.get) {
        const id = args.get as string;
        const record = ctx.records.find((r: RecordEntry) => r.id === id);
        if (!record) return { output: t("recordNotFound", { id }) };
        const emoji = recordEmoji(record.type);
        const severityLine = record.severity ? `${severityEmoji(record.severity)} ${record.severity}` : "";
        return {
          title: `${emoji} ${record.id}: ${record.title}`,
          output: [
            `${emoji} **${record.id}** — ${recordTypeLabel(record.type, record.severity)}`,
            `**${record.title}**`,
            `${record.detail}`,
            severityLine,
            `— ${record.agent} · ${record.timestamp}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { record },
        };
      }
      if (args.list) {
        if (ctx.records.length === 0) return { output: t("recordEmpty") };
        const lines = ctx.records.map((r: RecordEntry) => {
          const emoji = recordEmoji(r.type);
          const label = recordTypeLabel(r.type, r.severity);
          return `${emoji} **${r.id}** — ${label} — ${r.title} (${r.agent})`;
        });
        return {
          title: t("recordListTitle", { count: String(ctx.records.length) }),
          output: lines.join("\n"),
        };
      }
      if (args.delete) {
        const id = args.delete as string;
        const idx = ctx.records.findIndex((r: RecordEntry) => r.id === id);
        if (idx === -1) return { output: t("recordNotFound", { id }) };
        const record = ctx.records[idx]!;
        if (normalizeName(record.agent) !== normalizeName(cctx.agent) && normalizeName(cctx.agent) !== "analyst") {
          return { output: t("recordNoPermission", { id, owner: record.agent }) };
        }
        const removed = ctx.records.splice(idx, 1)[0]!;
        ctx.saveState();
        return { title: `🗑️ ${id} deleted`, output: t("recordDeleted", { id, title: removed.title }) };
      }
      if (!args.type || !args.title || !args.detail) {
        return { output: t("recordRequiredFields") };
      }
      if (!VALID_TYPES.includes(args.type as string)) {
        return {
          output: t("recordInvalidType", { type: String(args.type), allowed: VALID_TYPES.join(", ") }),
        };
      }
      if (args.severity && !VALID_SEVERITIES.includes(args.severity as string)) {
        return {
          output: t("recordInvalidSeverity", { severity: String(args.severity), allowed: VALID_SEVERITIES.join(", ") }),
        };
      }
      if (ctx.records.length >= ctx.getMaxRecords()) {
        return { output: t("recordMaxReached", { max: String(ctx.getMaxRecords()) }) };
      }
      ctx.recSeq++;
      const entry: RecordEntry = {
        id: `R-${String(ctx.recSeq).padStart(3, "0")}`,
        timestamp: new Date().toISOString(),
        agent: normalizeName(cctx.agent),
        type: args.type as RecordEntry["type"],
        title: args.title as string,
        detail: args.detail as string,
        severity: args.severity as RecordEntry["severity"],
        provenance: "tool_observed",
      };
      ctx.records.push(entry);
      ctx.recordRecordCreated(cctx.agent);
      ctx.saveState();
      const emoji = recordEmoji(args.type as string);
      const severityLine = args.severity ? `${severityEmoji(args.severity as string)} ${args.severity}` : "";
      return {
        title: `${emoji} ${entry.id}: ${entry.title}`,
        output: [
          `${emoji} **${entry.id}** — ${recordTypeLabel(args.type as string, args.severity as string | undefined)}`,
          `**${entry.title}**`,
          `${entry.detail}`,
          severityLine,
          `— ${cctx.agent}`,
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: { record: entry },
      };
    },
  });
}