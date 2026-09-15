import { readFile } from "node:fs/promises";
import { smartTruncate } from "../utils/smart-truncate.ts";
import type { TawassulContext } from "../context.ts";
import type { ToolDefinition, ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { resolveSafe, toErrorMessage } from "../utils/path.ts";
import { t } from "../translations.ts";
import { secureExec } from "../utils/secure-exec.ts";

const DEFAULT_CONTEXT = 3;
const MAX_RESULTS = 60;

export function buildSmartGrepTool(_ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Regex-based project search with context lines before and after each match.",
      "Supports scoping the search path and choosing the context size.",
      "Reduces the need for sequential grep + read calls.",
      "",
      "Examples:",
      '  smart_grep(pattern: "function handle", context: 5)',
      '  smart_grep(pattern: "TODO|FIXME", path: "src/", context: 2)',
    ].join("\n"),
    args: {
      pattern: tool.schema.string().describe("Regex pattern to search for"),
      path: tool.schema.string().optional().describe("Search path (optional, defaults to project root)"),
      context: tool.schema.number().optional().describe("Number of context lines before/after a match (default 3)"),
      maxResults: tool.schema.number().optional().describe("Maximum number of results (default 60)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      const { pattern, path, context, maxResults } = args as {
        pattern: string;
        path?: string;
        context?: number;
        maxResults?: number;
      };
      if (!pattern) {
        return { output: t("smartGrepNoPattern") };
      }
      const ctxLines = context ?? DEFAULT_CONTEXT;
      const maxRes = maxResults ?? MAX_RESULTS;
      let searchDir: string;
      if (path) {
        const safe = await resolveSafe(cctx.directory, path);
        if (safe.error) {
          return { output: safe.error };
        }
        searchDir = safe.resolved;
      } else {
        searchDir = cctx.directory;
      }
      try {
        const child = await secureExec(
          "rg",
          [
            "--no-heading",
            "--line-number",
            `--context=${ctxLines}`,
            `--max-count=${maxRes}`,
            "--color=never",
            pattern,
            searchDir,
          ],
          { timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
        );
        const output = child.stdout;
        if (!output || output.trim() === "") {
          return { output: t("smartGrepNoMatch", { pattern }) };
        }
        const lines = output.split("\n");
        const fileCount = new Set(lines.filter((l) => l.includes(":")).map((l) => l.split(":")[0])).size;
        let displayed = lines;
        let truncated = false;
        if (lines.length > maxRes * (ctxLines * 2 + 1)) {
          displayed = lines.slice(0, maxRes * (ctxLines * 2 + 1));
          truncated = true;
        }
        const result = [
          t("smartGrepSummary", { pattern, fileCount: String(fileCount), lineCount: String(displayed.length) }),
          "",
          ...displayed,
        ];
        if (truncated) {
          result.push(t("smartGrepTruncated", { maxRes: String(maxRes) }));
        }
        return { output: result.join("\n") };
      } catch (e: unknown) {
        const err = e as { code?: string; stderr?: string; message?: string };
        if (err.code === "ENOENT") {
          return { output: t("smartGrepNoRipgrep") };
        }
        if (err.stderr?.includes("regex")) {
          return { output: t("smartGrepBadRegex", { stderr: err.stderr }) };
        }
        return { output: t("smartGrepFailed", { error: toErrorMessage(e) }) };
      }
    },
  });
}

const MAX_OUTPUT_LINES = 1000;

interface DiffStats {
  files: number;
  added: number;
  deleted: number;
}

function parseDiffStats(raw: string): DiffStats {
  const lines = raw.split("\n");
  let files = 0;
  let added = 0;
  let deleted = 0;
  for (const line of lines) {
    if (line.startsWith("diff --git")) files++;
    else if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) deleted++;
  }
  return { files, added, deleted };
}

export function buildGitDiffTool(_ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "View Git changes (unstaged/staged/commit) with stats and context.",
      "Reduces the need for bash git diff + manual analysis.",
      "",
      "Examples:",
      "  git_diff()                              → unstaged diff",
      "  git_diff(staged: true)                  → staged diff only",
      '  git_diff(commit: "HEAD~1")              → a specific commit',
      '  git_diff(file: "src/index.ts")          → a specific file',
      "  git_diff(summary: true)                 → summary only",
    ].join("\n"),
    args: {
      staged: tool.schema.boolean().optional().describe("Show only the staged diff (default false)"),
      commit: tool.schema.string().optional().describe("Commit hash or reference to view"),
      file: tool.schema.string().optional().describe("A specific file to view diff"),
      statOnly: tool.schema.boolean().optional().describe("Stats only without content (default false)"),
      summary: tool.schema.boolean().optional().describe("Summary only without full diff content (default false)"),
      context: tool.schema.number().optional().describe("Number of context lines (default 3)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      const { staged, commit, file, statOnly, summary, context } = args as {
        staged?: boolean;
        commit?: string;
        file?: string;
        statOnly?: boolean;
        summary?: boolean;
        context?: number;
      };
      const ctxLines = context ?? 3;
      const gitArgs: string[] = ["diff", "--stat", `--unified=${ctxLines}`, "--no-color", "-p"];
      if (staged) gitArgs.push("--cached");
      if (commit) {
        gitArgs.length = 0;
        gitArgs.push("diff", "--stat", `--unified=${ctxLines}`, "--no-color", "-p");
        gitArgs.push(`${commit}^!`);
      }
      if (file) {
        const safe = await resolveSafe(cctx.directory, file);
        if (safe.error) {
          return { output: safe.error };
        }
        gitArgs.push("--", safe.resolved);
      }
      try {
        const { stdout } = await secureExec("git", gitArgs, {
          timeout: 30000,
          maxBuffer: 5 * 1024 * 1024,
          cwd: cctx.directory,
        });
        const lines = stdout.split("\n");
        const patchStart = lines.findIndex((l) => l.startsWith("diff --git"));
        const statBlock = patchStart >= 0 ? lines.slice(0, patchStart).join("\n").trim() : stdout.trim();
        const patchOut = patchStart >= 0 ? lines.slice(patchStart).join("\n") : "";
        const stats = parseDiffStats(patchOut);
        if (statOnly || summary) {
          const outputParts = [
            t("gitDiffStats", {
              files: String(stats.files),
              insertions: String(stats.added),
              deletions: String(stats.deleted),
            }),
            statBlock,
          ];
          if (summary) {
            outputParts.push(t("gitDiffDetailsHint", { file: file || "..." }));
          }
          return { output: outputParts.filter(Boolean).join("\n") };
        }
        if (!patchOut.trim()) {
          return { output: t("gitDiffNoChanges") };
        }
        const result: string[] = [
          t("gitDiffStats", {
            files: String(stats.files),
            insertions: String(stats.added),
            deletions: String(stats.deleted),
          }),
          "",
          smartTruncate(patchOut, MAX_OUTPUT_LINES),
        ];
        return { output: result.join("\n") };
      } catch (e: unknown) {
        const err = e as { code?: string; stderr?: string; message?: string };
        if (err.code === "ENOENT") {
          return { output: t("gitDiffNoGit") };
        }
        if (err.stderr?.includes("not a git repository")) {
          return { output: t("gitDiffNotRepo") };
        }
        return { output: t("gitDiffFailed", { error: toErrorMessage(e) }) };
      }
    },
  });
}

export function buildBatchReadTool(_ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Read multiple files in a single call instead of separate read tools.",
      "Reduces the number of tool calls and improves performance.",
      "",
      "Examples:",
      '  batch_read(paths: ["src/index.ts", "src/config.ts"])',
      '  batch_read(paths: ["package.json"], limit: 50)',
    ].join("\n"),
    args: {
      paths: tool.schema.array(tool.schema.string()).describe("List of file paths to read"),
      limit: tool.schema.number().optional().describe("Maximum number of lines per file (optional)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      const { paths, limit } = args as { paths: string[]; limit?: number };
      if (!paths || paths.length === 0) {
        return { output: t("batchReadNoPaths") };
      }
      if (paths.length > 50) {
        return { output: t("batchReadMaxFiles") };
      }

      const results: string[] = [];
      let errors = 0;

      for (const filePath of paths) {
        const safe = await resolveSafe(cctx.directory, filePath);
        if (safe.error) {
          errors++;
          results.push(`━━━ ⚠️ ${filePath} ━━━`);
          results.push(safe.error);
          continue;
        }
        try {
          const content = await readFile(safe.resolved, "utf-8");
          const lines = content.split("\n");
          const totalLines = lines.length;
          const displayedLines = limit ? lines.slice(0, limit) : lines;
          const suffix =
            limit && totalLines > limit ? `\n${t("batchReadTruncated", { count: String(totalLines - limit) })}` : "";

          results.push(t("batchReadLines", { file: filePath, count: String(totalLines) }));
          results.push(displayedLines.join("\n") + suffix);
        } catch (e: unknown) {
          errors++;
          results.push(`━━━ ⚠️ ${filePath} ━━━`);
          results.push(t("batchReadError", { error: toErrorMessage(e, t("batchReadReadError")) }));
        }
      }

      const summary =
        errors === 0
          ? t("batchReadSuccess", { count: String(paths.length) })
          : t("batchReadPartial", {
              success: String(paths.length - errors),
              total: String(paths.length),
              failed: String(errors),
            });

      results.push("");
      results.push(summary);

      return { output: results.join("\n") };
    },
  });
}