import type { TawassulContext } from "../context.ts";
import type { ToolDefinition, ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { t, recordTypeLabel } from "../translations.ts";
import { severityEmoji, recordEmoji } from "../utils/format.ts";
import { toolScopeOnlyHint } from "../utils/text-utils.ts";
import type { RecordEntry } from "../context/types.ts";
import { RecordEntrySchema } from "../validation.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { continuityEnabled } from "../services/continuity/owner.ts";

const RECORD_TYPE_ENUM = RecordEntrySchema.shape.type;
const RECORD_SEVERITY_ENUM = RecordEntrySchema.shape.severity.unwrap();
export const VALID_TYPES = RECORD_TYPE_ENUM.options as readonly string[];
export const VALID_SEVERITIES = RECORD_SEVERITY_ENUM.options as readonly string[];

const MAX_HITS = 20;
const SEVERITY_RANK: Record<string, number> = { critical: 4, severe: 3, moderate: 2, minor: 1 };

function resolveLimit(value: unknown): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : MAX_HITS;
  return Math.max(1, Math.min(MAX_HITS, raw));
}

function severityRank(record: RecordEntry): number {
  return record.severity ? (SEVERITY_RANK[record.severity] ?? 0) : 0;
}

export function buildRecordTool(ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Record a decision, fix, incident, or note for the project history.",
      toolScopeOnlyHint("Session records live ONLY behind this tool", "them"),
      "",
      "WRITE — REQUIRED: type, title, detail. OPTIONAL: severity (for fixes/incidents)",
      "",
      'READ-BACK: record(get: "R-001") → one by id; record(list: true) → all',
      "",
      'SEARCH: record(search: "text") → matches in title/detail, max 20',
      "",
      'EXAMPLES: record(type: "decision", title: "We use React", detail: "We chose React for its easy ecosystem")',
      "",
      'DELETE: record(delete: "R-001")',
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
      search: tool.schema.string().optional().describe("Case-folded substring over title and detail"),
      limit: tool.schema.number().int().optional().describe("Max records to return (default 20, max 20)"),
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
        const total = ctx.records.length;
        const limit = args.limit === undefined ? total : resolveLimit(args.limit);
        const shown = ctx.records.slice(0, limit);
        const lines = shown.map((r: RecordEntry) => {
          const emoji = recordEmoji(r.type);
          const label = recordTypeLabel(r.type, r.severity);
          return `${emoji} **${r.id}** — ${label} — ${r.title} (${r.agent})`;
        });
        const footer =
          shown.length < total
            ? `\n${t("recordListLimited", { shown: String(shown.length), total: String(total) })}`
            : "";
        return {
          title: t("recordListTitle", { count: String(total) }),
          output: lines.join("\n") + footer,
        };
      }
      if (args.search !== undefined) {
        if (!continuityEnabled()) return { output: t("continuityDisabled") };
        const query = String(args.search).trim();
        if (!query) return { output: t("recordSearchRequired") };
        const limit = resolveLimit(args.limit);
        const needle = query.toLowerCase();
        const scanned = ctx.records.length;
        const matched = ctx.records.filter((r: RecordEntry) =>
          `${r.title}\n${r.detail}`.toLowerCase().includes(needle),
        );
        const hits = matched
          .sort(
            (a, b) =>
              severityRank(b) - severityRank(a) ||
              Date.parse(b.timestamp) - Date.parse(a.timestamp) ||
              b.id.localeCompare(a.id),
          )
          .slice(0, limit);
        const metadata = { search: query, scanned, matched: matched.length, limit, hits: hits.map((r) => r.id) };
        if (hits.length === 0) {
          return { output: t("recordSearchEmpty", { query, limit: String(limit) }), metadata };
        }
        const lines = hits.map((r: RecordEntry) => {
          const emoji = recordEmoji(r.type);
          const label = recordTypeLabel(r.type, r.severity);
          return `${emoji} **${r.id}** — ${label} — ${r.title} (${r.agent})`;
        });
        return {
          title: t("recordSearchTitle", { count: String(hits.length), query }),
          output: lines.join("\n"),
          metadata,
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
      await ctx.saveState();
      const health = ctx.getSaveHealth();
      const emoji = recordEmoji(args.type as string);
      const severityLine = args.severity ? `${severityEmoji(args.severity as string)} ${args.severity}` : "";
      const persistenceNote = health.stale
        ? `\n\n⚠️ Persistence warning: on-disk save failed (${String(health.failureCount)} failure(s)) — this record is in memory but may not survive a restart.`
        : "";
      return {
        title: `${emoji} ${entry.id}: ${entry.title}`,
        output: [
          `${emoji} **${entry.id}** — ${recordTypeLabel(args.type as string, args.severity as string | undefined)}`,
          `**${entry.title}**`,
          `${entry.detail}`,
          severityLine,
          `— ${cctx.agent}`,
          persistenceNote,
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: { record: entry },
      };
    },
  });
}