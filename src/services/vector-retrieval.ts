














import { atomicWriteFile } from "../infra/disk-utils.ts";
import { isIsolationActiveSync } from "./isolation.ts";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { logger } from "../utils/logger.ts";

export interface VectorDoc {
  id: string;
  text: string;
  kind: "record" | "handoff";
}

export interface VectorHit {
  id: string;
  kind: "record" | "handoff";
  score: number;
}

export interface VectorStore {
  ingest(docs: VectorDoc[]): void;
  search(query: string, k?: number): VectorHit[];
  size(): number;
  
  remove(id: string): void;
  
  syncFromLive(docs: VectorDoc[]): number;
  
  save?(stateDir: string): Promise<void>;
  
  load?(stateDir: string): Promise<void>;
}

const DIM = 128;
const MAX_DOCS = 2000;

function vectorIndexPath(stateDir: string): string {
  return resolve(stateDir, ".opencode", "vector-index.json");
}


function embed(text: string): Float32Array {
  const vec = new Float32Array(DIM);
  const tokens = text.toLowerCase().match(/[a-z0-9_]+|[\u0600-\u06ff]+/g) ?? [];
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = (h >>> 0) % DIM;
    vec[idx] = (vec[idx] ?? 0) + 1;
  }
  
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]}_${tokens[i + 1]}`;
    let h = 2166136261;
    for (let j = 0; j < bigram.length; j++) {
      h ^= bigram.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    const idx = (h >>> 0) % DIM;
    vec[idx] = (vec[idx] ?? 0) + 0.5;
  }
  
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += (vec[i] ?? 0) * (vec[i] ?? 0);
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) vec[i] = (vec[i] ?? 0) / norm;
  return vec;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < DIM; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

export class InMemoryVectorIndex implements VectorStore {
  private readonly vectors = new Map<string, { vec: Float32Array; kind: VectorDoc["kind"] }>();
  
  private readonly docs = new Map<string, VectorDoc>();

  ingest(docs: VectorDoc[]): void {
    for (const d of docs) {
      if (!d.text) continue;
      this.docs.set(d.id, d);
      this.vectors.set(d.id, { vec: embed(d.text), kind: d.kind });
      if (this.vectors.size > MAX_DOCS) {
        const firstKey = this.vectors.keys().next().value;
        if (firstKey) {
          this.vectors.delete(firstKey);
          this.docs.delete(firstKey);
        }
      }
    }
  }

  remove(id: string): void {
    this.docs.delete(id);
    this.vectors.delete(id);
  }

  
  syncFromLive(docs: VectorDoc[]): number {
    const liveIds = new Set<string>();
    for (const d of docs) {
      if (!d.text) continue; 
      this.docs.set(d.id, d);
      this.vectors.set(d.id, { vec: embed(d.text), kind: d.kind });
      liveIds.add(d.id);
    }
    let purged = 0;
    for (const id of [...this.docs.keys()]) {
      if (!liveIds.has(id)) {
        this.docs.delete(id);
        this.vectors.delete(id);
        purged++;
      }
    }
    
    while (this.vectors.size > MAX_DOCS) {
      const oldest = this.vectors.keys().next().value;
      if (oldest === undefined) break;
      this.vectors.delete(oldest);
      this.docs.delete(oldest);
    }
    return purged;
  }

  search(query: string, k = 5): VectorHit[] {
    const q = embed(query);
    
    const heap: VectorHit[] = [];
    for (const [id, v] of this.vectors) {
      const score = cosine(q, v.vec);
      if (score <= 0) continue;
      const hit: VectorHit = { id, kind: v.kind, score };
      if (heap.length < k) {
        heap.push(hit);
        if (heap.length === k) heap.sort((a, b) => a.score - b.score); 
      } else if (score > heap[0]!.score) {
        heap[0] = hit;
        heap.sort((a, b) => a.score - b.score);
      }
    }
    heap.sort((a, b) => b.score - a.score);
    return heap;
  }

  size(): number {
    return this.vectors.size;
  }

  
  async save(stateDir: string): Promise<void> {
    if (isIsolationActiveSync()) return; 
    const p = vectorIndexPath(stateDir);
    try {
      await mkdir(dirname(p), { recursive: true });
    } catch {
      /* ignore */
    }
    const data = JSON.stringify({ docs: [...this.docs.values()] }, null, 2);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await atomicWriteFile(p, data);
        return;
      } catch (e) {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 5 * (attempt + 1)));
        else logger.warn("vector-index save failed after 3 attempts:", e);
      }
    }
  }

  
  async load(stateDir: string): Promise<void> {
    if (isIsolationActiveSync()) return;
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(vectorIndexPath(stateDir), "utf-8");
      const parsed = JSON.parse(raw) as { docs?: unknown };
      if (Array.isArray(parsed.docs)) {
        for (const d of parsed.docs as VectorDoc[]) {
          if (d && typeof d.id === "string" && typeof d.text === "string") {
            this.ingest([d]);
          }
        }
      }
    } catch {
      /* no index yet — fresh start */
    }
  }
}
