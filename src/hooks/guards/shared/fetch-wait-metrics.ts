const MAX_SAMPLES = 500;
const samples: number[] = [];

export function recordFetchWait(ms: number): void {
  if (!Number.isFinite(ms)) return;
  samples.push(ms);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

export interface FetchWaitStats {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export function getFetchWaitStats(): FetchWaitStats | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
}

export function resetFetchWaitStats(): void {
  samples.length = 0;
}
