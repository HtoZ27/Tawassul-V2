const marks = new Map<string, number>();
const LABEL_PREFIX = "__perf_measure__";
const MAX_MARKS = 1000;

export function mark(name: string): void {
  marks.set(name, performance.now());
  
  if (marks.size > MAX_MARKS) {
    const oldestKey = marks.keys().next().value;
    if (oldestKey !== undefined) marks.delete(oldestKey);
  }
}

export function measure(start: string, end: string, label: string): void {
  const startTime = marks.get(start);
  const endTime = marks.get(end);
  if (startTime === undefined || endTime === undefined) return;
  marks.set(`${LABEL_PREFIX}${label}`, endTime - startTime);
}

export function report(): string | null {
  const entries: string[] = [];
  for (const [key, value] of marks) {
    if (key.startsWith(LABEL_PREFIX)) {
      entries.push(`  ${key.slice(LABEL_PREFIX.length)}: ${value.toFixed(2)}ms`);
    }
  }
  if (entries.length === 0) return null;
  return `[tawassul] Performance:\n${entries.join("\n")}`;
}

export function reset(): void {
  marks.clear();
}
