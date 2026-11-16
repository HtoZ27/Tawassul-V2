export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 1;
  return intersection.size / union.size;
}

export function selectCentroid(outputs: string[]): number {
  const n = outputs.length;
  if (n === 0) return -1;
  if (n === 1) return 0;

  
  
  const cache = new Array<number[]>(n);
  const sim = (i: number, j: number): number => {
    const lo = i < j ? i : j;
    const hi = i < j ? j : i;
    const row = cache[lo] ?? (cache[lo] = new Array<number>(n).fill(-1));
    let v = row[hi]!;
    if (v < 0) {
      v = jaccardSimilarity(outputs[lo]!, outputs[hi]!);
      row[hi] = v;
    }
    return v;
  };

  let bestIdx = 0;
  let bestSim = -1;
  for (let i = 0; i < n; i++) {
    let totalSim = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      totalSim += sim(i, j);
    }
    const avgSim = totalSim / (n - 1);
    if (avgSim > bestSim) {
      bestSim = avgSim;
      bestIdx = i;
    }
  }
  return bestIdx;
}
