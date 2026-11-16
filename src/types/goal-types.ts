

export type GoalStatus =
  "open" | "in_progress" | "partial" | "blocked" | "completed" | "verified" | "dropped" | "stale";

export type GoalItemState = "pending" | "in_progress" | "partial" | "done" | "failed" | "dropped";

export type DoDVerification = "automated" | "manual" | "agent_check";

export type DoDStatus = "pending" | "met" | "not_met";

export interface DoDCriterion {
  criterion: string;
  verification: DoDVerification;
  status: DoDStatus;
  
  evidence: string[];
}

export interface RetiredAcceptance {
  criterion: string;
  reason: string;
  retiredAt: string;
}

export interface GoalItem {
  id: string;
  title: string;
  state: GoalItemState;
  evidence: string[];
  verifiedBy: string | null;
  updatedAt: string;
}


export interface CompletedItem {
  id: string;
  title: string;
  completedAt: string;
  
  evidence: string[];
}

export interface Goal {
  id: string;
  seq: number;
  title: string;
  detail: string;
  status: GoalStatus;
  closedAs?: GoalStatus;
  
  progressPct: number;
  owner: string;
  ownerKind: "solo" | "delegated";
  parentId: string | null;
  items: GoalItem[];
  
  completedItems: CompletedItem[];
  acceptance: DoDCriterion[];
  retiredAcceptance: RetiredAcceptance[];
  linkedRecords: string[];
  linkedHandoffs: string[];
  linkedBoards: string[];
  evidence: string[];
  
  evidenceHashes: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  verifiedBy: string | null;
  lastEvidenceAt: string | null;
}

export type GoalListFilter =
  "active" | "open" | "partial" | "blocked" | "completed" | "verified" | "dropped" | "stale" | "all";


export interface GoalInvariantCheck {
  ok: boolean;
  
  missing: string[];
}


export interface GoalDigest {
  text: string;
  attention: number;
  roster: number;
  overflow: number;
  changed: number;
  open: number;
  done: number;
}
