export function normalizeArabic(text: string): string {
  let s = text.normalize("NFC");
  s = s.normalize("NFC");
  return s.toLowerCase().trim();
}

export function stemRoot(word: string): string {
  return word;
}

export function rootLettersInOrder(word: string, root: string): boolean {
  if (root.length === 0) return true;
  let ri = 0;
  for (const ch of word) {
    if (ch === root[ri]) {
      ri++;
      if (ri === root.length) return true;
    }
  }
  return false;
}

class TrieNode {
  children = new Map<string, TrieNode>();
  role: string | null = null;
  fail: TrieNode | null = null;
  keywordLen = 0;
}

export class ArabicRootTrie {
  private root = new TrieNode();

  insert(rootWord: string, role: string): void {
    let node = this.root;
    for (const ch of rootWord) {
      let child = node.children.get(ch);
      if (!child) {
        child = new TrieNode();
        node.children.set(ch, child);
      }
      node = child;
    }
    node.role = role;
  }

  findRoot(word: string): string | null {
    const stemmed = stemRoot(word);
    let node = this.root;
    let best: string | null = null;
    for (const ch of stemmed) {
      const child = node.children.get(ch);
      if (!child) break;
      node = child;
      if (node.role) best = node.role;
    }
    if (best) return best;

    return this._subseqMatch(this.root, word, 0, null);
  }

  private _subseqMatch(node: TrieNode, word: string, startIdx: number, best: string | null): string | null {
    if (node.role) best = node.role;
    for (const [ch, child] of node.children) {
      const idx = word.indexOf(ch, startIdx);
      if (idx !== -1) {
        const result = this._subseqMatch(child, word, idx + 1, best);
        if (result) return result;
      }
    }
    return best;
  }
}

export class KeywordTrie {
  private root = new TrieNode();
  private built = false;

  insert(keyword: string, role: string): void {
    const kw = keyword.toLowerCase();
    let node = this.root;
    for (const ch of kw) {
      let child = node.children.get(ch);
      if (!child) {
        child = new TrieNode();
        node.children.set(ch, child);
      }
      node = child;
    }
    node.role = role;
    node.keywordLen = kw.length;
    this.built = false;
  }

  private buildFailureLinks(): void {
    if (this.built) return;
    const queue: TrieNode[] = [];
    this.root.fail = this.root;
    for (const child of this.root.children.values()) {
      child.fail = this.root;
      queue.push(child);
    }
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const [ch, child] of cur.children) {
        let f = cur.fail!;
        while (f !== this.root && !f.children.has(ch)) f = f.fail!;
        child.fail = f.children.get(ch) ?? this.root;
        queue.push(child);
      }
    }
    this.built = true;
  }

  findKeyword(text: string): string | null {
    this.buildFailureLinks();
    const lower = text.toLowerCase();
    let node: TrieNode = this.root;
    for (let i = 0; i < lower.length; i++) {
      const ch = lower[i]!;
      while (node !== this.root && !node.children.has(ch)) node = node.fail!;
      node = node.children.get(ch) ?? this.root;
      let cur: TrieNode | null = node;
      while (cur && cur !== this.root) {
        if (cur.role) {
          const start = i - cur.keywordLen + 1;
          if (start >= 0 && this._hasWordBoundary(lower, start, cur.keywordLen)) {
            return cur.role;
          }
        }
        cur = cur.fail;
      }
    }
    return null;
  }

  private _hasWordBoundary(text: string, idx: number, wordLen: number): boolean {
    const before = idx === 0 || /[^a-z]/.test(text[idx - 1]!);
    const after = idx + wordLen >= text.length || /[^a-z]/.test(text[idx + wordLen]!);
    return before && after;
  }
}

export function levenshtein(a: string, b: string, maxDistance?: number): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (maxDistance !== undefined && Math.abs(m - n) > maxDistance) return maxDistance + 1;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const jStart = maxDistance !== undefined ? Math.max(1, i - maxDistance) : 1;
    const jEnd = maxDistance !== undefined ? Math.min(n, i + maxDistance) : n;
    if (maxDistance !== undefined) {
      for (let j = 1; j < jStart; j++) curr[j] = maxDistance + 1;
      for (let j = jEnd + 1; j <= n; j++) curr[j] = maxDistance + 1;
    }
    let rowMin = curr[0];
    for (let j = jStart; j <= jEnd; j++) {
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + (a[i - 1]! === b[j - 1]! ? 0 : 1));
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (maxDistance !== undefined && rowMin > maxDistance) return maxDistance + 1;
    [prev, curr] = [curr, prev];
  }
  const result = prev[n]!;
  if (maxDistance !== undefined && result > maxDistance) return maxDistance + 1;
  return result;
}
