import type { RecordEntry, HandoffEntry } from "./types.ts";
import type { PauseState } from "../tools/system-controls.ts";

export class TawassulState {
  records: RecordEntry[] = [];
  handoffs: Map<string, HandoffEntry> = new Map();
  recSeq = 0;
  hoffSeq = 0;
  seenAgents: Map<string, Set<string>> = new Map();
  onboardedAgents: Set<string> = new Set();
  pauseState: PauseState | null = null;
}
