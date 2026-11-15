import { readdir, stat } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import type { TawassulContext } from "../context.ts";
import type { ToolDefinition, ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { resolveSafe } from "../utils/path.ts";
import { t } from "../translations.ts";
import { cancelledResult } from "./cancel.ts";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".opencode",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
  "target",
  "venv",
  "__pycache__",
  ".DS_Store",
]);


const FILE_TYPES: Record<string, string> = {
  ".ts": "TS",
  ".tsx": "TSX",
  ".js": "JS",
  ".jsx": "JSX",
  ".json": "JSON",
  ".md": "MD",
  ".css": "CSS",
  ".scss": "SCSS",
  ".html": "HTML",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".toml": "TOML",
  ".env": "ENV",
  ".py": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".rb": "Ruby",
  ".java": "Java",
  ".c": "C",
  ".cpp": "C++",
  ".h": "Header",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".sql": "SQL",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".gitignore": "Git",
  ".dockerignore": "Docker",
  Dockerfile: "Docker",
  Makefile: "Make",
};

function getFileType(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  if (FILE_TYPES[ext]) return FILE_TYPES[ext];
  if (FILE_TYPES[fileName]) return FILE_TYPES[fileName];
  
  if (fileName === "Dockerfile" || fileName.endsWith(".dockerfile")) return "Docker";
  if (fileName === "Makefile") return "Make";
  return ext ? ext.slice(1).toUpperCase() : "—";
}

interface TreeNode {
  name: string;
  type: "dir" | "file";
  fileType?: string;
  size?: number;
  children?: TreeNode[];
}

type TreeStamps = {
  files: { path: string; mtimeMs: number; size: number }[];
  dirs: { path: string; mtimeMs: number }[];
};

async function buildTree(
  dirPath: string,
  rootDir: string,
  depth: number,
  maxDepth: number,
  stamps?: TreeStamps,
  signal?: AbortSignal,
): Promise<TreeNode | null> {
  if (signal?.aborted) return null;
  if (depth > maxDepth) return null;

  const dirName = basename(dirPath);
  if (IGNORE_DIRS.has(dirName) || dirName.startsWith(".")) return null;

  if (depth === 0 && stamps) {
    try {
      const rootStat = await stat(dirPath);
      stamps.dirs.push({ path: dirPath, mtimeMs: rootStat.mtimeMs });
    } catch {}
  }

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return null;
  }

  
  const sorted: { name: string; isDir: boolean }[] = [];
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || entry.startsWith(".")) continue;
    const fullPath = resolve(dirPath, entry);
    try {
      const entryStat = await stat(fullPath);
      sorted.push({ name: entry, isDir: entryStat.isDirectory() });
      if (entryStat.isDirectory() && stamps) {
        stamps.dirs.push({ path: fullPath, mtimeMs: entryStat.mtimeMs });
      }
    } catch {

    }
  }
  sorted.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const children: TreeNode[] = [];

  for (const entry of sorted) {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDir) {
      const child = await buildTree(fullPath, rootDir, depth + 1, maxDepth, stamps, signal);
      if (child) {
        children.push(child);
      }
    } else {
      try {
        const fileStat = await stat(fullPath);
        if (stamps) {
          stamps.files.push({ path: fullPath, mtimeMs: fileStat.mtimeMs, size: fileStat.size });
        }
        children.push({
          name: entry.name,
          type: "file",
          fileType: getFileType(entry.name),
          size: fileStat.size,
        });
      } catch {

      }
    }
  }

  return {
    name: dirName || "/",
    type: "dir",
    children,
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function renderTree(node: TreeNode, prefix: string = "", isLast: boolean = true): string[] {
  const lines: string[] = [];
  const marker = isLast ? "└── " : "├── ";
  const childPrefix = isLast ? "    " : "│   ";

  if (node.type === "dir") {
    lines.push(`${prefix}${marker}📁 ${node.name}/`);
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]!;
        const childLines = renderTree(child, prefix + childPrefix, i === node.children.length - 1);
        lines.push(...childLines);
      }
    }
  } else {
    const typeTag = node.fileType ? `[${node.fileType}]` : "";
    const sizeStr = node.size ? formatSize(node.size) : "";
    lines.push(`${prefix}${marker}📄 ${node.name} ${typeTag} ${sizeStr}`.trim());
  }

  return lines;
}

function countStats(node: TreeNode): {
  files: number;
  dirs: number;
  totalSize: number;
  byType: Record<string, number>;
} {
  let files = 0;
  let dirs = 0;
  let totalSize = 0;
  const byType: Record<string, number> = {};

  if (node.type === "dir") {
    dirs++;
    if (node.children) {
      for (const child of node.children) {
        const stats = countStats(child);
        files += stats.files;
        dirs += stats.dirs;
        totalSize += stats.totalSize;
        for (const [type, count] of Object.entries(stats.byType)) {
          byType[type] = (byType[type] || 0) + count;
        }
      }
    }
  } else {
    files++;
    totalSize += node.size || 0;
    const type = node.fileType || "—";
    byType[type] = (byType[type] || 0) + 1;
  }

  return { files, dirs, totalSize, byType };
}

export function buildProjectMapTool(ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Render the project structure as a tree with file classification and stats.",
      "Reduces the need for multiple glob + list + read calls to understand the project layout.",
      "",
      "Examples:",
      "  project_map(depth: 3)",
      "  project_map(depth: 2, path: src/components/)",
    ].join("\n"),
    args: {
      depth: tool.schema.number().optional().describe("Tree depth (default 3, max 5)"),
      path: tool.schema.string().optional().describe("Starting path (optional, defaults to project root)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      if (cctx.abort?.aborted) return cancelledResult();
      const { depth, path } = args as { depth?: number; path?: string };
      const maxDepth = Math.min(depth ?? 3, 5);
      let rootDir: string;
      if (path) {
        const safe = await resolveSafe(cctx.directory, path);
        if (safe.error) {
          return { output: safe.error };
        }
        rootDir = safe.resolved;
      } else {
        rootDir = cctx.directory;
      }

      const stamps: TreeStamps = { files: [], dirs: [] };
      const rootNode = await buildTree(rootDir, rootDir, 0, maxDepth, stamps, cctx.abort);
      if (cctx.abort?.aborted) return cancelledResult();
      if (!rootNode) {
        return { output: t("projectMapNoTree") };
      }
      await ctx.projectIndex?.recordTree(stamps.files, stamps.dirs);

      const treeLines = renderTree(rootNode);
      const stats = countStats(rootNode);

      
      const typeSummary = Object.entries(stats.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type}: ${count}`)
        .join(" · ");

      const statsSection = [
        "",
        t("projectMapStats", {
          files: String(stats.files),
          dirs: String(stats.dirs),
          size: formatSize(stats.totalSize),
        }),
        typeSummary ? `🏷️ ${typeSummary}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const title = t("projectMapTitle", { depth: String(maxDepth) }) + (path ? ` — ${path}` : "");

      const result = [title, "", ...treeLines, statsSection];

      return { output: result.join("\n") };
    },
  });
}
