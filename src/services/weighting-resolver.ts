



export type WeightConfig = {
  specializationWeight: number;
  recencyWeight: number;
  severityWeight: number;
  agentWeight: number;
  completenessWeight: number;
  confidenceWeight: number;
};

export const DEFAULT_WEIGHTS: WeightConfig = {
  specializationWeight: 0.3,
  recencyWeight: 0.2,
  severityWeight: 0.15,
  agentWeight: 0.15,
  completenessWeight: 0.1,
  confidenceWeight: 0.1,
};

export type WeightedItem = {
  specialization: string;
  label: string;
  score: number;
  breakdown: {
    specialization: number;
    recency: number;
    severity: number;
    agent: number;
    completeness: number;
    confidence: number;
  };
};

export class WeightingResolver {
  private weights: WeightConfig;
  private order: string[];

  
  private static SHRINK_SATURATION = 30;

  constructor(weights?: Partial<WeightConfig>, order?: string[]) {
    const merged = { ...DEFAULT_WEIGHTS, ...weights };
    
    const total =
      merged.specializationWeight +
      merged.recencyWeight +
      merged.severityWeight +
      merged.agentWeight +
      merged.completenessWeight +
      merged.confidenceWeight;
    if (Math.abs(total - 1.0) > 0.001 && total > 0) {
      merged.specializationWeight /= total;
      merged.recencyWeight /= total;
      merged.severityWeight /= total;
      merged.agentWeight /= total;
      merged.completenessWeight /= total;
      merged.confidenceWeight /= total;
    }
    this.weights = merged;
    this.order = order ?? [];
  }

  resolve(
    items: {
      specialization: string;
      label: string;
      recencyMs: number;
      severity?: string;
      agentMatch: number;
      completeness: number;
      confidence: number;
      agentConfidence?: number;
      
      sampleSize?: number;
    }[],
  ): WeightedItem[] {
    const maxRecency = Math.max(...items.map((i) => i.recencyMs), 1);

    const scored = items.map((item) => {
      const recencyScore = 1 - item.recencyMs / maxRecency;

      const severityMap: Record<string, number> = {
        critical: 1,
        severe: 0.8,
        moderate: 0.5,
        minor: 0.2,
      };
      const severityScore = item.severity ? (severityMap[item.severity] ?? 0.5) : 0.5;

      const breakdown = {
        specialization: (item.agentConfidence ?? item.confidence) * this.weights.specializationWeight,
        recency: Math.max(0, recencyScore) * this.weights.recencyWeight,
        severity: severityScore * this.weights.severityWeight,
        agent: item.agentMatch * this.weights.agentWeight,
        completeness: item.completeness * this.weights.completenessWeight,
        confidence: item.confidence * this.weights.confidenceWeight,
      };

      let score =
        breakdown.specialization +
        breakdown.recency +
        breakdown.severity +
        breakdown.agent +
        breakdown.completeness +
        breakdown.confidence;

      
      if (item.sampleSize !== undefined) {
        const strength = Math.min(1, item.sampleSize / WeightingResolver.SHRINK_SATURATION);
        score = score * strength + 0.5 * (1 - strength);
      }

      return { specialization: item.specialization, label: item.label, score, breakdown };
    });

    
    if (this.order.length > 0) {
      scored.sort((a, b) => {
        const ai = this.order.indexOf(a.specialization);
        const bi = this.order.indexOf(b.specialization);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return b.score - a.score;
      });
    } else {
      scored.sort((a, b) => b.score - a.score);
    }

    return scored;
  }

  getConfidence(scored: WeightedItem[]): number {
    const sum = scored.reduce((a, b) => a + b.score, 0);
    return sum > 0 ? (scored[0]?.score ?? 0) / sum : 0;
  }

  
  getConfidenceInterval(
    scored: WeightedItem[],
    totalSamples?: number,
  ): { lower: number; upper: number; marginOfError: number } | null {
    if (scored.length === 0) return null;

    const p = Math.max(0, Math.min(1, scored[0]!.score));
    const n = totalSamples !== undefined && totalSamples > 0 ? totalSamples : 1;
    const z = 1.96; 

    const denom = 1 + (z * z) / n;
    const center = (p + (z * z) / (2 * n)) / denom;
    const width = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
    const lower = Math.max(0, center - width);
    const upper = Math.min(1, center + width);

    return { lower, upper, marginOfError: (upper - lower) / 2 };
  }

  getWeights(): WeightConfig {
    return { ...this.weights };
  }
}
