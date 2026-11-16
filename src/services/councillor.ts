
export interface CouncillorOutput {
  agent: string;
  content: string;
  confidence?: number;
  weight?: number;
}


export interface CouncillorResult {
  winner: CouncillorOutput;
  votes: Map<string, number>;
  weightedVotes: Map<string, number>;
  tieBroken: boolean;
}


export function councillorVote(outputs: CouncillorOutput[], requiredQuorum = 0): CouncillorResult {
  if (outputs.length === 0) throw new Error("No outputs to vote on");
  if (outputs.length < requiredQuorum) throw new Error(`Quorum not met: need ${requiredQuorum}, got ${outputs.length}`);

  const weightedVotes = new Map<string, number>();
  const voteCount = new Map<string, number>();
  for (const o of outputs) {
    const w = o.weight ?? 1;
    voteCount.set(o.content, (voteCount.get(o.content) ?? 0) + 1);
    weightedVotes.set(o.content, (weightedVotes.get(o.content) ?? 0) + w);
  }

  let maxVotes = 0;
  let top: string[] = [];
  for (const [content, count] of voteCount) {
    if (count > maxVotes) {
      maxVotes = count;
      top = [content];
    } else if (count === maxVotes) {
      top.push(content);
    }
  }

  let winnerContent: string;
  let tieBroken = false;

  if (top.length === 1) {
    winnerContent = top[0]!;
  } else {
    tieBroken = true;
    
    let maxWeight = 0;
    let weightedTop: string[] = [];
    for (const content of top) {
      const w = weightedVotes.get(content) ?? 0;
      if (w > maxWeight) {
        maxWeight = w;
        weightedTop = [content];
      } else if (w === maxWeight) {
        weightedTop.push(content);
      }
    }
    if (weightedTop.length === 1) {
      winnerContent = weightedTop[0]!;
    } else {
      
      const tied = outputs.filter((o) => weightedTop.includes(o.content));
      const withConfidence = tied.filter((o) => o.confidence !== undefined);
      if (withConfidence.length > 0) {
        withConfidence.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
        winnerContent = withConfidence[0]!.content;
      } else {
        winnerContent = weightedTop[0]!;
      }
    }
  }

  const winner = outputs.find((o) => o.content === winnerContent)!;
  return { winner, votes: voteCount, weightedVotes, tieBroken };
}
