

export interface LruSetOptions {
  
  cap?: number;
  
  moveToFront?: boolean;
  
  onEvict?: (key: unknown) => void;
}


export function lruSet<K, V>(map: Map<K, V>, key: K, value: V, options: LruSetOptions = {}): V {
  const { cap = 0, moveToFront = false, onEvict } = options;
  if (moveToFront && map.has(key)) map.delete(key);
  map.set(key, value);
  if (cap > 0) {
    while (map.size > cap) {
      const oldest = map.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      map.delete(oldest);
      onEvict?.(oldest);
    }
  }
  return value;
}
