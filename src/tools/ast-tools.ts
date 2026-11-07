import { readFile } from "node:fs/promises";
import type { TawassulContext } from "../context.ts";
import type { ToolDefinition, ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { resolveSafe, toErrorMessage, escapeRegex } from "../utils/path.ts";
import { t } from "../translations.ts";
import { getAstService } from "../services/ast-service.ts";

async function recordIndexFile(ctx: TawassulContext, filePath: string): Promise<void> {
  await ctx.projectIndex?.recordFile(filePath);
}

function findBlockEnd(lines: string[], startLine: number): number {
  const startLineText = lines[startLine] || "";
  const stripped = startLineText.trim();
  if (!stripped.endsWith("{") && !stripped.endsWith(")") && (stripped.endsWith(";") || stripped.endsWith(","))) {
    return startLine;
  }
  let braceDepth = 0;
  let started = false;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i] || "";
    for (const ch of line) {
      if (ch === "{") {
        braceDepth++;
        started = true;
      }
      if (ch === "}") {
        braceDepth--;
      }
    }
    if (started && braceDepth <= 0 && line.trim().endsWith("}")) {
      return i;
    }
  }
  return lines.length - 1;
}

function extractSymbol(
  content: string,
  symbol: string,
  kind?: string,
): { start: number; end: number; found: boolean; lines: string[] } {
  const lines = content.split("\n");
  let startLine = -1;
  if (kind) {
    const kindPatterns: Record<string, RegExp> = {
      function: /function\s+/,
      class: /class\s+/,
      interface: /interface\s+/,
      type: /type\s+/,
      enum: /enum\s+/,
      method: /\w+\s*\(/,
      variable: /(const|let|var)\s+/,
    };
    const kindRegex = kindPatterns[kind.toLowerCase()];
    if (kindRegex) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] || "";
        if (line.match(kindRegex) && line.includes(symbol)) {
          startLine = i;
          break;
        }
      }
    }
  }
  if (startLine === -1) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || "";
      if (line.match(new RegExp(`\\b${escapeRegex(symbol)}\\b`))) {
        startLine = i;
        break;
      }
    }
  }
  if (startLine === -1) {
    return { start: -1, end: -1, found: false, lines: [] };
  }
  const contextStart = Math.max(0, startLine - 2);
  const endLine = findBlockEnd(lines, startLine);
  const extractedLines = lines.slice(contextStart, endLine + 1);
  return { start: contextStart, end: endLine, found: true, lines: extractedLines };
}

export function buildAstQueryTool(ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Query a file's structure using AST (Abstract Syntax Tree).",
      "Returns a list of symbols (functions, classes, interfaces, types) and imports in a given file.",
      "More precise than plain-text search.",
      "",
      "Examples:",
      '  astquery(file: "src/utils.ts")',
      '  astquery(file: "src/services/auth.ts", symbol: "AuthService")',
      '  astquery(file: "src/utils.ts", kind: "function")',
    ].join("\n"),
    args: {
      file: tool.schema.string().describe("File path"),
      symbol: tool.schema.string().optional().describe("Symbol name"),
      kind: tool.schema
        .enum(["function", "class", "interface", "type", "enum", "method", "variable"])
        .optional()
        .describe("Symbol type"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      const { file, symbol, kind } = args as { file?: string; symbol?: string; kind?: string };
      if (!file) {
        return { output: t("astQueryNoFile") };
      }
      const safe = await resolveSafe(cctx.directory, file);
      if (safe.error) {
        return { output: safe.error };
      }
      const ast = getAstService();
      try {
        if (symbol) {
          const info = await ast.findSymbol(safe.resolved, symbol, kind);
          if (!info) {
            return { output: t("readSymbolNotFound", { symbol, file }) };
          }
          await recordIndexFile(ctx, safe.resolved);
          const output = [
            t("readSymbolLocation", { symbol: info.name, kind: info.kind, file, line: String(info.startLine + 1) }),
            "",
            info.text,
          ];
          return { output: output.join("\n") };
        }
        const structure = await ast.getStructure(safe.resolved);
        if (!structure) {
          const idx = file.lastIndexOf(".");
          const ext = idx >= 0 ? file.slice(idx) : "";
          return { output: t("astQueryNotSupported", { ext }) };
        }
        await recordIndexFile(ctx, safe.resolved);
        let filteredSymbols = structure.symbols;
        if (kind) {
          const mappedKind = ast.mapKind(kind);
          filteredSymbols = filteredSymbols.filter((s) => s.kind === mappedKind);
        }
        const lines: string[] = [
          t("astQuerySummary", {
            file,
            symbols: String(filteredSymbols.length),
            imports: String(structure.imports.length),
          }),
          "",
        ];
        if (structure.imports.length > 0) {
          lines.push(t("astQueryImportsHeader"));
          for (const imp of structure.imports) {
            const names = imp.names.length > 0 ? ` { ${imp.names.join(", ")} }` : "";
            lines.push(`  import${imp.isTypeOnly ? " type" : ""}${names} from "${imp.source}"`);
          }
          lines.push("");
        }
        if (filteredSymbols.length > 0) {
          lines.push(t("astQuerySymbolsHeader"));
          for (const sym of filteredSymbols) {
            const kindLabel = sym.kind.replace(/_/g, " ");
            lines.push(`  ${kindLabel} **${sym.name}** (line ${sym.startLine + 1}-${sym.endLine + 1})`);
          }
          lines.push("");
        }
        return { output: lines.join("\n") };
      } catch (e: unknown) {
        return { output: t("astQueryError", { error: toErrorMessage(e) }) };
      }
    },
  });
}

export function buildReadSymbolTool(ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Read a specific symbol's definition (function, class, interface, type, variable) from a file.",
      "Extracts only the requested symbol instead of reading the entire file.",
      "Reduces read volume by ~80%.",
      "When ast:true is enabled, uses Tree-sitter for precise symbol boundaries.",
      "",
      "Examples:",
      '  read_symbol(file: "src/utils.ts", symbol: "formatDate")',
      '  read_symbol(file: "src/services/auth.ts", symbol: "AuthService", kind: "class")',
      '  read_symbol(file: "src/utils.ts", symbol: "greet", ast: true)',
    ].join("\n"),
    args: {
      file: tool.schema.string().describe("File path"),
      symbol: tool.schema.string().describe("Symbol name"),
      kind: tool.schema
        .enum(["function", "class", "interface", "type", "enum", "method", "variable"])
        .optional()
        .describe("Symbol type (optional)"),
      ast: tool.schema
        .boolean()
        .optional()
        .default(false)
        .describe("Use AST (supports .ts, .tsx, .js)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      const { file, symbol, kind, ast } = args as { file: string; symbol: string; kind?: string; ast?: boolean };
      if (!file) {
        return { output: t("readSymbolNoFile") };
      }
      if (!symbol) {
        return { output: t("readSymbolNoSymbol") };
      }
      const safe = await resolveSafe(cctx.directory, file);
      if (safe.error) {
        return { output: safe.error };
      }
      try {
        if (ast) {
          const astService = getAstService();
          const info = await astService.findSymbol(safe.resolved, symbol, kind);
          if (info) {
            await recordIndexFile(ctx, safe.resolved);
            const output = [
              t("readSymbolLocation", { symbol: info.name, kind: info.kind, file, line: String(info.startLine + 1) }),
              "",
              info.text,
            ];
            return { output: output.join("\n") };
          }
        }
        const content = await readFile(safe.resolved, "utf-8");
        const result = extractSymbol(content, symbol, kind);
        if (!result.found) {
          return { output: t("readSymbolNotFound", { symbol, file }) };
        }
        await recordIndexFile(ctx, safe.resolved);
        const output = [
          t("readSymbolLocation", { symbol, kind: kind || "symbol", file, line: String(result.start + 1) }),
          "",
          ...result.lines,
        ];
        return { output: output.join("\n") };
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string };
        if (err.code === "ENOENT") {
          return { output: t("readSymbolFileNotFound", { file }) };
        }
        return { output: t("readSymbolReadError", { error: toErrorMessage(e) }) };
      }
    },
  });
}