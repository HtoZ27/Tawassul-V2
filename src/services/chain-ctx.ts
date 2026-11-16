


export type ChainCtx = {
  chainId: string; 
  sessionId: string;
  taskId: string;
  hop: number; 
  origin: "user" | "agent" | "system";
};

let _chainSeq = 0;


export function newChainId(): string {
  _chainSeq += 1;
  return `chain-${Date.now().toString(36)}-${_chainSeq}`;
}


export type ReflectionFact = {
  kind: "worked" | "failed" | "learned";
  claim: string;
};


export type ADRRecord = {
  id: string;
  title: string;
  context: string;
  decision: string;
  alternatives: string[];
  votedAt: string;
  quorumReached: boolean;
  
  provenance?: "user_stated" | "agent_inferred";
};
