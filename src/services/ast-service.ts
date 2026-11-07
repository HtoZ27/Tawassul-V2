import { readFile, stat as fsStat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.ts";
import type { Parser, Language, Tree, Node as SyntaxNode } from "web-tree-sitter";

const _dirname = dirname(fileURLToPath(import.meta.url));

type TreeSitterModule = typeof import("web-tree-sitter");
let _wtsModule: TreeSitterModule | null = null;
let _wtsPromise: Promise<TreeSitterModule | null> | null = null;
let _degradationWarned = false;

function compactReason(e: unknown, fallback: string): string {
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const first = text.split("\n")[0]?.trim() ?? "";
  if (!first) return fallback;
  return first.length > 120 ? `${first.slice(0, 117)}...` : first;
}

function warnAstDegraded(reason: string): void {
  if (_degradationWarned) return;
  _degradationWarned = true;
  logger.warn(
    `⚠️ AST degraded — tawassul-runtime/wasm is missing (${reason}): ` +
      `astquery/depmap features are disabled for this session. ` +
      `Fix: reinstall the plugin (see docs/installation.md) to stage tawassul-runtime/wasm, then restart opencode.`,
  );
}

function loadTreeSitter(): Promise<TreeSitterModule | null> {
  if (!_wtsPromise) {
    _wtsPromise = import("web-tree-sitter").then(
      (m) => {
        _wtsModule = m;
        return m;
      },
      (e) => {
        warnAstDegraded(`web-tree-sitter unavailable: ${compactReason(e, "not installed")}`);
        return null;
      },
    );
  }
  return _wtsPromise;
}

function findNodeModules(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = resolvePath(dir, "node_modules");
    if (existsSync(resolvePath(candidate, "web-tree-sitter", "web-tree-sitter.js"))) {
      return candidate;
    }
    const parent = resolvePath(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolvePath(startDir, "..", "node_modules");
}

function findWasmRoot(startDir: string): string {
  const candidates = [
    resolvePath(startDir, "..", "tawassul-runtime", "wasm"),
    resolvePath(startDir, "tawassul-runtime", "wasm"),
    resolvePath(startDir, "tawassul-wasm"),
  ];
  for (const candidate of candidates) {
    if (existsSync(resolvePath(candidate, "web-tree-sitter", "web-tree-sitter.wasm"))) {
      return candidate;
    }
  }
  return findNodeModules(startDir);
}
const WASM_ROOT = findWasmRoot(_dirname);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

type LanguageId = "typescript" | "tsx" | "javascript";

const WASM_PATHS: Record<LanguageId, string> = {
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
};

const EXT_TO_LANG: Record<string, LanguageId> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".mts": "typescript",
  ".cts": "typescript",
};

const KIND_TO_NODE_TYPE: Record<string, string> = {
  function: "function_declaration",
  class: "class_declaration",
  interface: "interface_declaration",
  type: "type_alias_declaration",
  enum: "enum_declaration",
  method: "method_definition",
  variable: "lexical_declaration",
  abstract_class: "abstract_class_declaration",
};

const NODE_TYPE_NAMES = new Set(["identifier", "type_identifier", "property_identifier"]);

interface AstCacheEntry {
  mtimeMs: number;
  size: number;
  tree: Tree;
  text: string;
}

const AST_CACHE_MAX = 64;

function contentCacheKey(filePath: string, content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h + content.charCodeAt(i)) | 0;
  }
  return `c:${filePath}:${h.toString(36)}:${content.length}`;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
  text: string;
}

export interface ImportInfo {
  source: string;
  names: string[];
  isTypeOnly: boolean;
}

export interface FileStructure {
  symbols: SymbolInfo[];
  imports: ImportInfo[];
}

export class AstService {
  private _ready = false;
  private _initPromise: Promise<void> | null = null;
  private _languages = new Map<LanguageId, Language>();
  private _parsers = new Map<LanguageId, Parser>();
  private _astCache = new Map<string, AstCacheEntry>();

  async init(): Promise<void> {
    if (this._ready) return;
    if (!this._initPromise) {
      this._initPromise = (async () => {
        const wts = await loadTreeSitter();
        if (!wts) return;
        if (!existsSync(resolvePath(WASM_ROOT, "web-tree-sitter", "web-tree-sitter.wasm"))) {
          warnAstDegraded(`wasm root not found (${WASM_ROOT})`);
          return;
        }
        try {
          await wts.Parser.init({
            locateFile(script: string) {
              return `${WASM_ROOT}/web-tree-sitter/${script}`;
            },
          });
          this._ready = true;
        } catch (e) {
          warnAstDegraded(`parser init failed: ${compactReason(e, "unknown error")}`);
          this._ready = false;
          this._initPromise = null;
        }
      })();
    }
    return this._initPromise;
  }

  async getParser(langId: LanguageId): Promise<Parser | null> {
    await this.init();
    const wts = _wtsModule;
    if (!this._ready || !wts) return null;
    const cached = this._parsers.get(langId);
    if (cached) return cached;

    try {
      const wasmPath = resolvePath(WASM_ROOT, WASM_PATHS[langId]!);
      const lang = await wts.Language.load(wasmPath);
      this._languages.set(langId, lang);

      const parser = new wts.Parser();
      parser.setLanguage(lang);
      this._parsers.set(langId, parser);
      return parser;
    } catch {
      return null;
    }
  }

  mapKind(kind?: string): string | null {
    if (!kind) return null;
    return KIND_TO_NODE_TYPE[kind] ?? kind;
  }

  async parseFile(filePath: string, content?: string): Promise<{ tree: Tree; text: string } | null> {
    const ext = extname(filePath);
    const langId = EXT_TO_LANG[ext];
    if (!langId) return null;

    const parser = await this.getParser(langId);
    if (!parser) return null;

    if (content !== undefined) {
      const key = contentCacheKey(filePath, content);
      const hit = this._astCache.get(key);
      if (hit) return { tree: hit.tree, text: hit.text };
      const tree = parser.parse(content);
      if (!tree) return null;
      this._astCache.set(key, { mtimeMs: 0, size: content.length, tree, text: content });
      this._trimAstCache();
      return { tree, text: content };
    }

    try {
      const st = await fsStat(filePath);
      if (st.size > MAX_FILE_SIZE) return null;
      const cached = this._astCache.get(filePath);
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        return { tree: cached.tree, text: cached.text };
      }
      const text = await readFile(filePath, "utf-8");
      const tree = parser.parse(text);
      if (!tree) return null;
      this._astCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, tree, text });
      this._trimAstCache();
      return { tree, text };
    } catch {
      return null;
    }
  }

  private _trimAstCache(): void {
    while (this._astCache.size > AST_CACHE_MAX) {
      const oldest = this._astCache.keys().next().value;
      if (oldest === undefined) break;
      const evicted = this._astCache.get(oldest);
      this._astCache.delete(oldest);
      try {
        evicted?.tree.delete();
      } catch {
      }
    }
  }

  clearCache(): void {
    for (const entry of this._astCache.values()) {
      try {
        entry.tree.delete();
      } catch {
      }
    }
    this._astCache.clear();
  }

  async getStructure(filePath: string, content?: string): Promise<FileStructure | null> {
    const result = await this.parseFile(filePath, content);
    if (!result) return null;

    const { tree } = result;
    const symbols: SymbolInfo[] = [];
    const imports: ImportInfo[] = [];

    const root = tree.rootNode;

    for (let i = 0; i < root.childCount; i++) {
      const child = root.child(i);
      if (!child) continue;

      const actualNode = unwrapExport(child);

      if (actualNode.type === "import_statement") {
        const info = extractImportInfo(actualNode);
        if (info) imports.push(info);
      }

      const name = extractDeclName(actualNode);
      if (name) {
        symbols.push({
          name,
          kind: actualNode.type,
          startLine: actualNode.startPosition.row,
          endLine: actualNode.endPosition.row,
          startCol: actualNode.startPosition.column,
          endCol: actualNode.endPosition.column,
          text: actualNode.text,
        });
      }
    }

    return { symbols, imports };
  }

  async findSymbol(filePath: string, symbol: string, kind?: string): Promise<SymbolInfo | null> {
    const result = await this.parseFile(filePath);
    if (!result) return null;

    const { tree } = result;
    const mappedKind = this.mapKind(kind);

    const root = tree.rootNode;
    return findSymbolInTree(root, symbol, mappedKind);
  }

  async extractImports(filePath: string, content?: string): Promise<ImportInfo[]> {
    const result = await this.parseFile(filePath, content);
    if (!result) return [];

    const { tree } = result;
    const imports: ImportInfo[] = [];

    const root = tree.rootNode;

    for (let i = 0; i < root.childCount; i++) {
      const child = root.child(i);
      if (!child) continue;
      if (child.type === "import_statement" || child.type === "import_declaration") {
        const info = extractImportInfo(child);
        if (info) imports.push(info);
      }
    }

    return imports;
  }
}

let _instance: AstService | null = null;

export function getAstService(): AstService {
  if (!_instance) {
    _instance = new AstService();
  }
  return _instance;
}

function unwrapExport(node: SyntaxNode): SyntaxNode {
  if (node.type === "export_statement") {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      if (
        child.type === "function_declaration" ||
        child.type === "class_declaration" ||
        child.type === "interface_declaration" ||
        child.type === "type_alias_declaration" ||
        child.type === "enum_declaration" ||
        child.type === "lexical_declaration" ||
        child.type === "variable_declaration" ||
        child.type === "abstract_class_declaration"
      ) {
        return child;
      }
    }
  }
  return node;
}

function firstNameChild(node: SyntaxNode): string | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && NODE_TYPE_NAMES.has(child.type)) {
      return child.text;
    }
  }
  return null;
}

function extractDeclName(node: SyntaxNode): string | null {
  const nodeType = node.type;

  switch (nodeType) {
    case "function_declaration":
    case "class_declaration":
    case "interface_declaration":
    case "type_alias_declaration":
    case "enum_declaration":
    case "abstract_class_declaration":
      return firstNameChild(node);
    case "method_definition":
    case "abstract_method_signature":
      return firstNameChild(node);
    case "lexical_declaration":
    case "variable_declaration": {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && c.type === "variable_declarator") {
          return firstNameChild(c);
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function extractImportInfo(node: SyntaxNode): ImportInfo | null {
  let source = "";
  const names: string[] = [];
  let isTypeOnly = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "string") {
      source = child.text.slice(1, -1);
    }

    if (child.type === "type") {
      isTypeOnly = true;
    }

    if (child.type === "import_clause") {
      for (let j = 0; j < child.childCount; j++) {
        const gc = child.child(j);
        if (!gc) continue;

        if (gc.type === "import_specifier") {
          const alias = gc.child(0);
          if (alias) names.push(alias.text);
        }

        if (gc.type === "named_imports") {
          for (let k = 0; k < gc.childCount; k++) {
            const spec = gc.child(k);
            if (spec && spec.type === "import_specifier") {
              const alias = spec.child(0);
              if (alias) names.push(alias.text);
            }
          }
        }

        if (gc.type === "namespace_import") {
          const asterisk = gc.child(0);
          if (asterisk && asterisk.type === "*") {
            names.push("*");
          }
        }

        if (
          gc.type !== "{" &&
          gc.type !== "}" &&
          gc.type !== "," &&
          gc.type !== "import_specifier" &&
          gc.type !== "named_imports" &&
          gc.type !== "namespace_import" &&
          gc.isNamed
        ) {
          names.push(gc.text);
        }
      }
    }
  }

  if (!source) return null;
  return { source, names, isTypeOnly };
}

function isKindMatch(actualType: string, searchKind: string | null): boolean {
  if (!searchKind) return true;
  if (actualType === searchKind) return true;
  if (searchKind === "method_definition" && actualType === "abstract_method_signature") return true;
  if (searchKind === "class_declaration" && actualType === "abstract_class_declaration") return true;
  return false;
}

function findSymbolInTree(node: SyntaxNode, symbol: string, kind: string | null): SymbolInfo | null {
  const actual = unwrapExport(node);
  const name = extractDeclName(actual);

  if (name === symbol && isKindMatch(actual.type, kind)) {
    return {
      name,
      kind: actual.type,
      startLine: actual.startPosition.row,
      endLine: actual.endPosition.row,
      startCol: actual.startPosition.column,
      endCol: actual.endPosition.column,
      text: actual.text,
    };
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    const result = findSymbolInTree(child, symbol, kind);
    if (result) return result;
  }

  return null;
}