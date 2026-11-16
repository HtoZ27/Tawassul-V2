

export type TimerManagerLike = {
  setTimeout: (fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]) => ReturnType<typeof setTimeout>;
  setInterval: (fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]) => ReturnType<typeof setInterval>;
  clear: (t: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>) => void;
};
