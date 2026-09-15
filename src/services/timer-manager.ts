

type AnyTimer = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;

export class TimerManager {
  private timers = new Set<AnyTimer>();
  private disposed = false;

  setTimeout(fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]): ReturnType<typeof setTimeout> {
    if (this.disposed) throw new Error("TimerManager disposed");
    
    
    
    
    const t = setTimeout(
      (...a: unknown[]) => {
        this.timers.delete(t);
        fn(...a);
      },
      ms,
      ...args,
    );
    this.timers.add(t);
    if (t?.unref) t.unref();
    return t;
  }

  setInterval(fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]): ReturnType<typeof setInterval> {
    if (this.disposed) throw new Error("TimerManager disposed");
    const t = setInterval(fn, ms, ...args);
    this.timers.add(t);
    if (t?.unref) t.unref();
    return t;
  }

  clear(t: AnyTimer): void {
    clearTimeout(t as ReturnType<typeof setTimeout>);
    clearInterval(t as ReturnType<typeof setInterval>);
    this.timers.delete(t);
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) {
      clearTimeout(t as ReturnType<typeof setTimeout>);
      clearInterval(t as ReturnType<typeof setInterval>);
    }
    this.timers.clear();
  }

  get activeCount(): number {
    return this.timers.size;
  }
}
