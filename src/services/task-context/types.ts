import type { FileStamp } from "../project-index/types.ts";

export const TASK_CONTEXT_KILL_ENV = "TAWASSUL_TASK_CONTEXT";
export const MAX_DECLARED_FILES = 50;
export const MAX_CONTEXT_ITEMS = 40;
export const MAX_FILE_ITEMS = 24;
export const MAX_SYMBOL_ITEMS = 10;
export const MAX_EDGE_ITEMS = 6;
export const MAX_MISSING_ITEMS = 32;

export type ContextItem =
  | { kind: "file"; path: string; stamp: FileStamp; reason: string; score: number }
  | {
      kind: "symbol";
      path: string;
      name: string;
      symbolKind: string;
      startLine: number;
      endLine: number;
      reason: string;
      score: number;
    }
  | { kind: "edge"; from: string; to: string; reason: string; score: number };

export type MissingContext = string;

export type TaskContextBundle = {
  schemaVersion: 1;
  taskId: string;
  task: string;
  projectKey: string;
  revision: string;
  items: ContextItem[];
  missing: MissingContext[];
  bytes: number;
  truncated: boolean;
};

export type TaskContextRequest = {
  taskId: string;
  task: string;
  declaredFiles?: string[];
};
