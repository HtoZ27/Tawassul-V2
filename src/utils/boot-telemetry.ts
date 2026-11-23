const generationKey = Symbol.for("tawassul.v2.boot-generation");

type GenerationStore = Record<symbol, number | undefined>;

function generationStore(): GenerationStore {
  return globalThis as unknown as GenerationStore;
}

export function beginGeneration(): number {
  const store = generationStore();
  const next = (store[generationKey] ?? 0) + 1;
  store[generationKey] = next;
  return next;
}

export function currentGeneration(): number {
  return generationStore()[generationKey] ?? 0;
}

export function genTag(value: number): string {
  return `gen=${value} pid=${process.pid}`;
}

export function cpuMs(start: { user: number; system: number }): number {
  const delta = process.cpuUsage(start);
  return Math.round((delta.user + delta.system) / 1000);
}

const retireCeilingKey = Symbol.for("tawassul.v2.retire-ceiling-hits");

function counterStore(): Record<symbol, number | undefined> {
  return globalThis as unknown as Record<symbol, number | undefined>;
}

export function countRetireCeiling(): number {
  const store = counterStore();
  const next = (store[retireCeilingKey] ?? 0) + 1;
  store[retireCeilingKey] = next;
  return next;
}

export function retireCeilingHits(): number {
  return counterStore()[retireCeilingKey] ?? 0;
}
