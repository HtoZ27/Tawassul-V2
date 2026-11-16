import { getAstService, type FileStructure, type SymbolInfo } from "./ast-service.ts";
import { t } from "../translations.ts";
import { readFile } from "node:fs/promises";

interface StructuralFingerprint {
  featureId: string;
  capturedAt: string;
  files: Record<string, FileFingerprint>;
}

interface FileFingerprint {
  path: string;
  publicSymbols: SymbolFingerprint[];
  importHashes: string[];
}

interface SymbolFingerprint {
  name: string;
  kind: string;
  file: string;
  startLine: number;
  endLine: number;
  signatureHash: string;
}

interface FingerprintDiff {
  featureId: string;
  added: ChangedSymbol[];
  removed: ChangedSymbol[];
  modified: ChangedSymbol[];
  coverageGaps: CoverageGap[];
  allCovered: boolean;
}

interface ChangedSymbol {
  name: string;
  kind: string;
  file: string;
}

interface CoverageGap {
  symbol: string;
  file: string;
  reason: string;
}

interface CoverageResult {
  hasGaps: boolean;
  gaps: CoverageGap[];
  totalSymbols: number;
  coveredSymbols: number;
  coverageRatio: number;
}

function simpleSignatureHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}


const COVERAGE_SYMBOL_PATTERNS = [
  { kind: "function" as const, regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g },
  {
    kind: "function" as const,
    regex: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=(?:\s*async)?\s*(?:\([^)]*\)|[^=]+)\s*=>/g,
  },
  { kind: "class" as const, regex: /(?:export\s+)?class\s+(\w+)/g },
  { kind: "method" as const, regex: /(?:public|private|protected|static)?\s*(\w+)\s*\([^)]*\)\s*{/g },
  { kind: "interface" as const, regex: /(?:export\s+)?interface\s+(\w+)/g },
  { kind: "type" as const, regex: /(?:export\s+)?type\s+(\w+)/g },
  { kind: "struct" as const, regex: /(?:export\s+)?struct\s+(\w+)/g },
  { kind: "impl" as const, regex: /impl\s+(\w+)/g },
  { kind: "fn" as const, regex: /fn\s+(\w+)/g },
  { kind: "def" as const, regex: /def\s+(\w+)/g },
  { kind: "class" as const, regex: /class\s+(\w+)/g },
];
const IMPORT_REGEX = /(?:import|require)\s*\(?\s*['"]([^'"]+)['"]|from\s+['"]([^'"]+)['"]/g;

function extractSymbolsByRegex(content: string, filePath: string): SymbolFingerprint[] {
  const symbols: SymbolFingerprint[] = [];
  const lines = content.split("\n");

  for (const { kind, regex } of COVERAGE_SYMBOL_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (!match[1]) continue;
      const lineNum = content.slice(0, match.index).split("\n").length;
      const line = lines[lineNum - 1] || "";
      symbols.push({
        name: match[1],
        file: filePath,
        kind,
        startLine: lineNum,
        endLine: lineNum,
        signatureHash: simpleSignatureHash(line),
      });
    }
  }

  const seen = new Set<string>();
  return symbols.filter((s) => {
    const key = `${s.name}:${s.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const _fileContentCache = new Map<string, { content: string; ts: number }>();
const FILE_CACHE_TTL = 60_000;
async function getFileContent(tf: string): Promise<string | null> {
  const cached = _fileContentCache.get(tf);
  if (cached && Date.now() - cached.ts < FILE_CACHE_TTL) return cached.content;
  try {
    const content = await readFile(tf, "utf-8");
    _fileContentCache.set(tf, { content, ts: Date.now() });
    if (_fileContentCache.size > 500) {
      const oldest = _fileContentCache.keys().next().value;
      if (oldest) _fileContentCache.delete(oldest);
    }
    return content;
  } catch {
    return null;
  }
}

async function findTestFilesForSymbol(symbol: string, allTestFiles: string[]): Promise<string[]> {
  const symbolLower = symbol.toLowerCase();
  const results = await Promise.allSettled(
    allTestFiles.map(async (tf) => {
      const content = await getFileContent(tf);
      return { tf, match: content !== null && content.toLowerCase().includes(symbolLower) };
    }),
  );
  return results
    .filter(
      (r): r is PromiseFulfilledResult<{ tf: string; match: boolean }> => r.status === "fulfilled" && r.value.match,
    )
    .map((r) => r.value.tf);
}

const MAX_FINGERPRINTS = 200;

export class SemanticCoverageGuard {
  private fingerprints = new Map<string, StructuralFingerprint>();
  private fingerprintOrder: string[] = [];

  async captureFingerprint(featureId: string, files: string[]): Promise<StructuralFingerprint> {
    const ast = getAstService();
    const fileFingerprints: Record<string, FileFingerprint> = {};

    for (const file of files) {
      let symbols: SymbolFingerprint[];
      let imports: string[];

      const structure: FileStructure | null = await ast.getStructure(file).catch(() => null);
      if (structure && structure.symbols.length > 0) {
        symbols = structure.symbols.map((s: SymbolInfo) => ({
          name: s.name,
          kind: s.kind,
          file,
          startLine: s.startLine,
          endLine: s.endLine,
          signatureHash: simpleSignatureHash(s.text || ""),
        }));
        imports = (structure.imports || []).map((i) => i.source);
      } else {
        let content: string;
        try {
          content = await readFile(file, "utf-8");
        } catch {
          continue;
        }
        symbols = extractSymbolsByRegex(content, file);
        imports = [];

        let m: RegExpExecArray | null;
        while ((m = IMPORT_REGEX.exec(content)) !== null) {
          const imp = m[1] ?? m[2];
          if (imp) imports.push(imp);
        }
      }

      fileFingerprints[file] = {
        path: file,
        publicSymbols: symbols,
        importHashes: [...new Set(imports.map((i) => simpleSignatureHash(i)))],
      };
    }

    const fingerprint: StructuralFingerprint = {
      featureId,
      capturedAt: new Date().toISOString(),
      files: fileFingerprints,
    };

    if (!this.fingerprints.has(featureId)) {
      if (this.fingerprints.size >= MAX_FINGERPRINTS) {
        const oldest = this.fingerprintOrder.shift();
        if (oldest) this.fingerprints.delete(oldest);
      }
      this.fingerprintOrder.push(featureId);
    }
    this.fingerprints.set(featureId, fingerprint);
    return fingerprint;
  }

  async diffFingerprints(featureId: string, currentFiles: string[]): Promise<FingerprintDiff | null> {
    const old = this.fingerprints.get(featureId);
    if (!old) return null;

    const current = await this.captureFingerprint(featureId, currentFiles);
    return await this.compareFingerprints(old, current);
  }

  async compareFingerprints(old: StructuralFingerprint, current: StructuralFingerprint): Promise<FingerprintDiff> {
    const oldSymbols = new Map<string, ChangedSymbol>();
    for (const [, fp] of Object.entries(old.files)) {
      for (const sym of fp.publicSymbols) {
        oldSymbols.set(`${sym.name}:${sym.file}`, { name: sym.name, kind: sym.kind, file: sym.file });
      }
    }

    const currentSymbols = new Map<string, ChangedSymbol>();
    for (const [, fp] of Object.entries(current.files)) {
      for (const sym of fp.publicSymbols) {
        currentSymbols.set(`${sym.name}:${sym.file}`, { name: sym.name, kind: sym.kind, file: sym.file });
      }
    }

    const added: ChangedSymbol[] = [];
    const removed: ChangedSymbol[] = [];
    const modified: ChangedSymbol[] = [];

    for (const [key, sym] of currentSymbols) {
      if (!oldSymbols.has(key)) {
        added.push(sym);
      } else {
        const oldSym = oldSymbols.get(key)!;
        if (oldSym.kind !== sym.kind) {
          modified.push(sym);
        }
      }
    }

    for (const [key, sym] of oldSymbols) {
      if (!currentSymbols.has(key)) {
        removed.push(sym);
      }
    }

    const coverageGaps: CoverageGap[] = [];
    const allChanged = [...added, ...modified, ...removed];
    const testFiles = Object.keys(current.files).filter(
      (f) =>
        f.endsWith(".test.ts") ||
        f.endsWith(".spec.ts") ||
        f.endsWith(".test.js") ||
        f.endsWith(".spec.js") ||
        f.endsWith("_test.py") ||
        f.endsWith("_test.go") ||
        f.endsWith(".test.rs"),
    );

    for (const sym of allChanged) {
      const testFilesForSym = await findTestFilesForSymbol(sym.name, testFiles);
      if (testFilesForSym.length === 0) {
        coverageGaps.push({
          symbol: sym.name,
          file: sym.file,
          reason: t("scgNoTest", { sym: sym.name, kind: sym.kind }),
        });
      }
    }

    return {
      featureId: current.featureId,
      added,
      removed,
      modified,
      coverageGaps,
      allCovered: coverageGaps.length === 0,
    };
  }

  async checkCoverage(_featureId: string, changedFiles: string[], testFiles: string[]): Promise<CoverageResult> {
    const ast = getAstService();
    const gaps: CoverageGap[] = [];
    let totalSymbols = 0;

    for (const file of changedFiles) {
      let symbols: SymbolFingerprint[];

      const structure = await ast.getStructure(file).catch(() => null);
      if (structure && structure.symbols.length > 0) {
        symbols = structure.symbols.map((s: SymbolInfo) => ({
          name: s.name,
          kind: s.kind,
          file,
          startLine: s.startLine,
          endLine: s.endLine,
          signatureHash: "",
        }));
      } else {
        let content: string;
        try {
          content = await readFile(file, "utf-8");
        } catch {
          continue;
        }
        symbols = extractSymbolsByRegex(content, file);
      }

      for (const sym of symbols) {
        totalSymbols++;
        const testFilesForSym = await findTestFilesForSymbol(sym.name, testFiles);
        if (testFilesForSym.length === 0) {
          gaps.push({
            symbol: sym.name,
            file,
            reason: t("scgNoTest2", { sym: sym.name }),
          });
        }
      }
    }

    const covered = totalSymbols - gaps.length;
    return {
      hasGaps: gaps.length > 0,
      gaps,
      totalSymbols,
      coveredSymbols: covered,
      coverageRatio: totalSymbols > 0 ? covered / totalSymbols : 1,
    };
  }

  getFingerprint(featureId: string): StructuralFingerprint | undefined {
    return this.fingerprints.get(featureId);
  }

  setFingerprint(featureId: string, fp: StructuralFingerprint): void {
    if (!this.fingerprints.has(featureId)) {
      if (this.fingerprints.size >= MAX_FINGERPRINTS) {
        const oldest = this.fingerprintOrder.shift();
        if (oldest) this.fingerprints.delete(oldest);
      }
      this.fingerprintOrder.push(featureId);
    }
    this.fingerprints.set(featureId, fp);
  }

  removeFingerprint(featureId: string): void {
    this.fingerprints.delete(featureId);
    const idx = this.fingerprintOrder.indexOf(featureId);
    if (idx >= 0) this.fingerprintOrder.splice(idx, 1);
  }

  clear(): void {
    this.fingerprints.clear();
    this.fingerprintOrder = [];
  }
}
