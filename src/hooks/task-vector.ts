

import { SPECIALIZATIONS } from "../services/specializations.ts";

type SemanticVector = Record<string, number>;

export function getTaskVector(task: string): SemanticVector {
  const vector: SemanticVector = {};
  const text = (task || "").toLowerCase();
  for (const spec of Object.keys(SPECIALIZATIONS)) {
    const keywords = SPECIALIZATIONS[spec]!.keywords;
    let count = 0;
    for (const kw of keywords) {
      const weight = kw.length > 5 ? 1.5 : 1.0;
      if (text.includes(kw.toLowerCase())) count += weight;
    }
    vector[spec] = count;
  }
  return vector;
}
