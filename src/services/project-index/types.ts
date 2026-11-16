export type FileStamp = { path: string; mtimeMs: number; size: number };

export type DirStamp = { path: string; mtimeMs: number };

export type SymbolKind = "function" | "class" | "interface" | "type" | "enum" | "method" | "variable";

export type SymbolRecord = {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  exported: boolean;
};

export type ImportEdge = { from: string; specifier: string; to: string | null };

export type FileRecord = {
  stamp: FileStamp;
  lang: string;
  lines: number;
  hash: string;
  symbols: SymbolRecord[];
  imports: ImportEdge[];
};

export type IndexSnapshot = {
  schemaVersion: 1;
  projectKey: string;
  projectRoot: string;
  revision: string;
  generatedAt: number;
  files: Record<string, FileRecord>;
  dirs: Record<string, DirStamp>;
  reverse: Record<string, string[]>;
  stats: { files: number; symbols: number; edges: number; bytes: number };
};

export type IndexStats = IndexSnapshot["stats"] & { parses: number; writes: number; enabled: boolean };
