


import type { HandoffEntry } from "../context/types.ts";

export interface CreateHandoffEntryParams {
  id: string;
  from: string;
  to: string;
  task: string;
  context?: string;
  files?: string[];
  timestamp?: string;
  status?: HandoffEntry["status"];
  parallelId?: string;
  sourceDiscussionId?: string;
}

export function createHandoffEntry(params: CreateHandoffEntryParams): HandoffEntry {
  return {
    id: params.id,
    from: params.from,
    to: params.to,
    task: params.task,
    context: params.context ?? "",
    files: params.files ?? [],
    timestamp: params.timestamp ?? new Date().toISOString(),
    status: params.status ?? "pending",
    ...(params.parallelId !== undefined ? { parallelId: params.parallelId } : {}),
    ...(params.sourceDiscussionId !== undefined ? { sourceDiscussionId: params.sourceDiscussionId } : {}),
  };
}
