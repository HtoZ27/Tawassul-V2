





export const DECAY_LAMBDA_PER_HOUR = 0.05;
export const K8_DETAIL_CAP = 10;

export function ageHours(timestampMs: number, now: number = Date.now()): number {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return 0;
  return Math.max(0, (now - timestampMs) / 3_600_000);
}

export function decayWeight(timestampMs: number, now: number = Date.now()): number {
  const age = ageHours(timestampMs, now);
  if (age <= 0) return 1;
  return Math.exp(-DECAY_LAMBDA_PER_HOUR * age);
}
