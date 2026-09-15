

export function lazy<T>(factory: () => T): () => T {
  let instance: T | undefined;
  let initialized = false;
  return () => {
    if (!initialized) {
      instance = factory();
      initialized = true;
    }
    return instance!;
  };
}
