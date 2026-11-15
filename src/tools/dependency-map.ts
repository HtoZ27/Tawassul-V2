import { readFile, readdir, stat, realpath } from "node:fs/promises";
import { resolve, extname, dirname, sep } from "node:path";
import type { TawassulContext } from "../context.ts";
import type { ToolDefinition, ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { resolveSafe, toErrorMessage } from "../utils/path.ts";
import { t } from "../translations.ts";
import { getAstService } from "../services/ast-service.ts";
import type { DirStamp, FileStamp, ImportEdge } from "../services/project-index/types.ts";
import { cancelledResult } from "./cancel.ts";

const IMPORT_REGEX = /import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
const REQUIRE_REGEX = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const IMPORT_REGEX_LAZY = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const MAX_FILES = 300;
const MAX_CYCLES_REPORTED = 10;

class DepMapCancelled extends Error {}

type DepStamps = { files: FileStamp[]; dirs: DirStamp[] };
type DepGraphValue = { nodes: DepNode[]; cycles: Cycle[]; fileCount: number };

interface DepNode {
  path: string;
  imports: string[];
  resolved: string[];
  edges: ImportEdge[];
}

interface Cycle {
  nodes: string[];
}

async function resolveImportPath(imp: string, fromFile: string, _projectDir: string): Promise<string | null> {
  if (imp.startsWith(".")) {
    const fromDir = dirname(fromFile);
    const candidate = resolve(fromDir, imp);
    for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]) {
      const tryPath = candidate + ext;
      try {
        await stat(tryPath);
        return tryPath;
      } catch {
        void 0;
      }
    }
    for (const ext of ["", ".ts", ".tsx", ".js", ".jsx"]) {
      const tryPath = resolve(candidate, "index" + ext);
      try {
        await stat(tryPath);
        return tryPath;
      } catch {
        void 0;
      }
    }
    return null;
  }
  return null;
}

async function collectTsFiles(
  dir: string,
  depth: number,
  maxDepth: number,
  collected: string[],
  stamps: DepStamps,
  visited?: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  if (depth > maxDepth || collected.length >= MAX_FILES) return;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  if (!visited) visited = new Set();
  for (const entry of entries) {
    if (signal?.aborted) return;
    if (entry.startsWith(".") || entry === "node_modules" || entry === "dist" || entry === "build") continue;
    const fullPath = resolve(dir, entry);
    try {
      let real: string;
      try {
        real = await realpath(fullPath);
      } catch {
        real = fullPath;
      }
      if (visited.has(real)) continue;
      visited.add(real);

      const entryStat = await stat(fullPath);
      if (entryStat.isDirectory()) {
        stamps.dirs.push({ path: fullPath, mtimeMs: entryStat.mtimeMs });
        await collectTsFiles(fullPath, depth + 1, maxDepth, collected, stamps, visited, signal);
      } else {
        const ext = extname(entry);
        if (
          [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"].includes(ext) &&
          collected.length < MAX_FILES
        ) {
          collected.push(fullPath);
          stamps.files.push({ path: fullPath, mtimeMs: entryStat.mtimeMs, size: entryStat.size });
        }
      }
    } catch {
      void 0;
    }
  }
}

function extractImports(content: string): Set<string> {
  const imports = new Set<string>();
  let m: RegExpExecArray | null;
  IMPORT_REGEX.lastIndex = 0;
  REQUIRE_REGEX.lastIndex = 0;
  IMPORT_REGEX_LAZY.lastIndex = 0;
  while ((m = IMPORT_REGEX.exec(content)) !== null) {
    if (m[1]) imports.add(m[1]);
  }
  while ((m = REQUIRE_REGEX.exec(content)) !== null) {
    if (m[1]) imports.add(m[1]);
  }
  while ((m = IMPORT_REGEX_LAZY.exec(content)) !== null) {
    if (m[1]) imports.add(m[1]);
  }
  return imports;
}

async function buildDepGraph(
  files: string[],
  projectDir: string,
  useAst?: boolean,
  signal?: AbortSignal,
): Promise<{ nodes: DepNode[]; cycles: Cycle[] }> {
  const nodes: DepNode[] = [];

  for (const filePath of files) {
    if (signal?.aborted) break;
    try {
      let rawImports: Set<string>;

      if (useAst) {
        const astService = getAstService();
        const importInfos = await astService.extractImports(filePath);
        rawImports = new Set(importInfos.map((i) => i.source));
      } else {
        const content = await readFile(filePath, "utf-8");
        rawImports = extractImports(content);
      }
      const resolved: string[] = [];
      const edges: ImportEdge[] = [];
      for (const imp of rawImports) {
        const r = await resolveImportPath(imp, filePath, projectDir);
        edges.push({ from: filePath, specifier: imp, to: r });
        if (r) resolved.push(r);
      }
      nodes.push({
        path: filePath,
        imports: [...rawImports].filter((i) => i.startsWith(".")),
        resolved,
        edges,
      });
    } catch {
      void 0;
    }
  }

  const indexMap = new Map<string, number>();
  nodes.forEach((n, i) => indexMap.set(n.path, i));

  const visited = new Set<number>();
  const inStack = new Set<number>();
  const stack: number[] = [];
  const cycles: Cycle[] = [];

  function dfs(nodeIdx: number): void {
    if (inStack.has(nodeIdx)) {
      const cycleStart = stack.indexOf(nodeIdx);
      if (cycleStart !== -1) {
        const cyclePath = stack.slice(cycleStart).map((i) => nodes[i]!.path);
        cycles.push({ nodes: cyclePath });
      }
      return;
    }
    if (visited.has(nodeIdx)) return;

    visited.add(nodeIdx);
    inStack.add(nodeIdx);
    stack.push(nodeIdx);

    const node = nodes[nodeIdx]!;
    for (const resolved of node.resolved) {
      const neighborIdx = indexMap.get(resolved);
      if (neighborIdx !== undefined) {
        dfs(neighborIdx);
      }
    }

    stack.pop();
    inStack.delete(nodeIdx);
  }

  for (let i = 0; i < nodes.length; i++) {
    if (!visited.has(i)) dfs(i);
  }

  return { nodes, cycles };
}

function relativePaths(nodes: DepNode[], projectDir: string): DepNode[] {
  const prefix = projectDir + sep;
  return nodes.map((n) => ({
    ...n,
    path: n.path.startsWith(prefix) ? n.path.slice(prefix.length) : n.path,
    resolved: n.resolved.map((r) => (r.startsWith(prefix) ? r.slice(prefix.length) : r)),
  }));
}

export function buildDependencyMapTool(ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Analyze the dependency tree (imports) between project files.",
      "Detects circular dependencies and shows the change impact map.",
      "Complements project-map by understanding relationships between files.",
      "When ast:true is enabled, uses Tree-sitter to extract imports with AST precision.",
      "",
      "Examples:",
      "  dependency_map()",
      '  dependency_map(file: "src/index.ts")',
      "  dependency_map(circular: true)",
      '  dependency_map(file: "src/utils.ts", ast: true)',
    ].join("\n"),
    args: {
      file: tool.schema.string().optional().describe("File to analyze"),
      circular: tool.schema.boolean().optional().describe("Circular only (default false)"),
      depth: tool.schema.number().optional().describe("Scan depth (default 3, max 5)"),
      ast: tool.schema
        .boolean()
        .optional()
        .default(false)
        .describe("Use AST (supports .ts, .tsx, .js)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      if (cctx.abort?.aborted) return cancelledResult();
      const { file, circular, depth, ast } = args as {
        file?: string;
        circular?: boolean;
        depth?: number;
        ast?: boolean;
      };

      const maxDepth = Math.min(depth ?? 3, 5);

      const dirPrefix = cctx.directory + sep;

      if (file) {
        const safe = await resolveSafe(cctx.directory, file);
        if (safe.error) {
          return { output: safe.error };
        }
        try {
          const relativePath = safe.resolved.startsWith(dirPrefix)
            ? safe.resolved.slice(dirPrefix.length)
            : safe.resolved;

          let rawImports: Set<string>;

          if (ast) {
            const astService = getAstService();
            const importInfos = await astService.extractImports(safe.resolved);
            rawImports = new Set(importInfos.map((i) => i.source));
          } else {
            const content = await readFile(safe.resolved, "utf-8");
            rawImports = extractImports(content);
          }

          const lines: string[] = [t("depMapFileDeps", { file: relativePath }), ""];
          const edges: ImportEdge[] = [];

          for (const imp of rawImports) {
            if (imp.startsWith(".")) {
              const r = await resolveImportPath(imp, safe.resolved, cctx.directory);
              edges.push({ from: safe.resolved, specifier: imp, to: r });
              const resolvedStr = r ? (r.startsWith(dirPrefix) ? r.slice(dirPrefix.length) : r) : t("depMapNotFound");
              lines.push(`  📄 ${imp} → ${resolvedStr}`);
            } else {
              edges.push({ from: safe.resolved, specifier: imp, to: null });
              lines.push(t("depMapExternalPackage", { imp }));
            }
          }
          if (cctx.abort?.aborted) return cancelledResult();
          ctx.projectIndex?.recordImports(safe.resolved, edges);

          if (rawImports.size === 0) {
            lines.push(t("depMapNoImports"));
          }

          return { output: lines.join("\n") };
        } catch (e: unknown) {
          return { output: t("depMapAnalysisError", { error: toErrorMessage(e) }) };
        }
      }

      try {
        const collected: string[] = [];
        const stamps: DepStamps = { files: [], dirs: [] };
        try {
          const rootStat = await stat(cctx.directory);
          stamps.dirs.push({ path: cctx.directory, mtimeMs: rootStat.mtimeMs });
        } catch {
          void 0;
        }
        await collectTsFiles(cctx.directory, 0, maxDepth, collected, stamps, undefined, cctx.abort);

        if (cctx.abort?.aborted) return cancelledResult();
        if (collected.length === 0) {
          return { output: t("depMapNoTsFiles") };
        }

        const build = async (): Promise<DepGraphValue> => {
          const graph = await buildDepGraph(collected, cctx.directory, ast, cctx.abort);
          if (cctx.abort?.aborted) throw new DepMapCancelled();
          ctx.projectIndex?.recordImportBatch(
            graph.nodes.map((node) => ({ path: node.path, edges: node.edges })),
          );
          return { nodes: graph.nodes, cycles: graph.cycles, fileCount: collected.length };
        };

        const cache = ctx.readCache;
        const graphValue: DepGraphValue = cache
          ? (
              await cache.getOrCompute<DepGraphValue>({
                tool: "depmap",
                args: { dir: cctx.directory, depth: maxDepth, useAst: !!ast },
                files: stamps.files,
                dirs: stamps.dirs,
                compute: build,
              })
            ).value
          : await build();

        if (cctx.abort?.aborted) return cancelledResult();
        const nodes = graphValue.nodes;
        const cycles = graphValue.cycles;
        const relNodes = relativePaths(nodes, cctx.directory);

        if (circular) {
          if (cycles.length === 0) {
            return { output: t("depMapNoCycles") };
          }
          const report = [
            t("depMapCyclesFound", { count: String(cycles.length) }),
            "",
            ...cycles.slice(0, MAX_CYCLES_REPORTED).map((cycle, i) => {
              const path = cycle.nodes.join(" → ");
              return `  ${i + 1}. ${path} → ${cycle.nodes[0]}`;
            }),
          ];
          if (cycles.length > MAX_CYCLES_REPORTED) {
            report.push(t("depMapMoreCycles", { count: String(cycles.length - MAX_CYCLES_REPORTED) }));
          }
          return { output: report.join("\n") };
        }

        const totalImports = relNodes.reduce((s, n) => s + n.resolved.length, 0);
        const filesWithDeps = relNodes.filter((n) => n.resolved.length > 0).length;
        const typeCount = graphValue.fileCount;

        const depCount = new Map<string, number>();
        for (const node of relNodes) {
          for (const r of node.resolved) {
            depCount.set(r, (depCount.get(r) || 0) + 1);
          }
        }
        const topDeps = [...depCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

        const report = [
          t("depMapTitle", { files: String(typeCount), cycles: String(cycles.length) }),
          "",
          t("depMapSummary", {
            files: String(typeCount),
            deps: String(totalImports),
            importers: String(filesWithDeps),
          }) + (cycles.length > 0 ? t("depMapSummaryCycles", { count: String(cycles.length) }) : ""),
          "",
        ];

        if (topDeps.length > 0) {
          report.push(t("depMapTopDeps"));
          for (const [depPath, count] of topDeps) {
            const bar = "█".repeat(Math.min(count, 20));
            report.push(`  ${bar} ${depPath} (${count})`);
          }
          report.push("");
        }

        if (cycles.length > 0) {
          report.push(t("depMapCyclesHeader", { count: String(Math.min(cycles.length, MAX_CYCLES_REPORTED)) }));
          for (const cycle of cycles.slice(0, MAX_CYCLES_REPORTED)) {
            report.push(`  🔄 ${cycle.nodes.join(" → ")} → ${cycle.nodes[0]}`);
          }
          if (cycles.length > MAX_CYCLES_REPORTED) {
            report.push(t("depMapMoreCycles", { count: String(cycles.length - MAX_CYCLES_REPORTED) }));
          }
          report.push("");
        }

        return { output: report.join("\n") };
      } catch (e: unknown) {
        if (e instanceof DepMapCancelled) return cancelledResult();
        return { output: t("depMapReadError", { error: toErrorMessage(e) }) };
      }
    },
  });
}