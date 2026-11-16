import { promises as fsPromises } from "node:fs";
import { getAstService, type FileStructure, type SymbolInfo } from "./ast-service.ts";
import { randomUUID } from "node:crypto";
import { t } from "../translations.ts";
import type { FixRecord } from "./regression-guard.ts";

interface BehavioralContract {
  id: string;
  featureId: string;
  fixId?: string;
  createdAt: string;
  changedSymbols: ContractSymbol[];
  expectedBehavior: string[];
  testLinks: TestLink[];
  verified: boolean;
  verifiedAt?: string;
}

interface ContractSymbol {
  name: string;
  kind: string;
  file: string;
  lines: string;
  previousSignature: string;
  currentSignature: string;
}

interface TestLink {
  symbolName: string;
  testFile: string;
  testName?: string;
}

interface ContractVerification {
  contractId: string;
  featureId: string;
  allLinked: boolean;
  totalSymbols: number;
  linkedSymbols: number;
  unlinkedSymbols: UnlinkedSymbol[];
  verificationResult: "pass" | "warn" | "fail";
}

interface UnlinkedSymbol {
  name: string;
  file: string;
  reason: string;
}

function extractFunctionSignature(content: string, name: string): string {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.includes(name) && (line.includes("function") || line.includes("=>") || line.includes("("))) {
      const sigLines: string[] = [];
      let depth = 0;
      let j = i;
      while (j < lines.length && j < i + 15) {
        const l = lines[j];
        if (!l) break;
        sigLines.push(l);
        for (const ch of l) {
          if (ch === "{" || ch === "(" || ch === "[") depth++;
          if (ch === "}" || ch === ")" || ch === "]") depth--;
        }
        if (depth <= 0 && j > i && (l.includes(")") || l.includes("=>"))) {
          break;
        }
        j++;
      }
      return sigLines.join("\n").slice(0, 300);
    }
  }
  return "";
}

function findTestFiles(files: string[]): string[] {
  return files.filter(
    (f) =>
      f.endsWith(".test.ts") ||
      f.endsWith(".spec.ts") ||
      f.endsWith(".test.js") ||
      f.endsWith(".spec.js") ||
      f.endsWith("_test.py") ||
      f.endsWith("_test.go") ||
      f.endsWith(".test.rs"),
  );
}

const MAX_CONTRACTS = 200;

export class SemanticRegressionOracle {
  private contracts = new Map<string, BehavioralContract>();
  private contractOrder: string[] = [];

  async extractContract(featureId: string, changedFiles: string[], fixRecord?: FixRecord): Promise<BehavioralContract> {
    const ast = getAstService();
    const changedSymbols: ContractSymbol[] = [];
    const testFiles = findTestFiles(changedFiles);

    for (const file of changedFiles) {
      let content: string;
      try {
        content = await fsPromises.readFile(file, "utf-8");
      } catch {
        continue;
      }

      let symbols: SymbolInfo[];
      const structure: FileStructure | null = await ast.getStructure(file).catch(() => null);
      if (structure && structure.symbols.length > 0) {
        symbols = structure.symbols;
      } else {
        const extracted = extractSymbolsBasic(content);
        symbols = extracted.map((s) => ({
          name: s,
          kind: "unknown",
          startLine: 0,
          endLine: 0,
          startCol: 0,
          endCol: 0,
          text: "",
        }));
      }

      for (const sym of symbols) {
        const sig = extractFunctionSignature(content, sym.name);
        changedSymbols.push({
          name: sym.name,
          kind: sym.kind,
          file,
          lines: `${sym.startLine}-${sym.endLine}`,
          previousSignature: sig,
          currentSignature: sig,
        });
      }
    }

    const testLinks: TestLink[] = [];
    for (const sym of changedSymbols) {
      for (const tf of testFiles) {
        let tfContent: string;
        try {
          tfContent = await fsPromises.readFile(tf, "utf-8");
        } catch {
          continue;
        }
        if (tfContent.toLowerCase().includes(sym.name.toLowerCase())) {
          testLinks.push({ symbolName: sym.name, testFile: tf });
        }
      }
    }

    const expectedBehavior = changedSymbols.map((sym) =>
      t("sroMustPreserve", { sym: sym.name, file: sym.file, kind: sym.kind }),
    );

    const contract: BehavioralContract = {
      id: `contract-${randomUUID()}`,
      featureId,
      fixId: fixRecord?.id,
      createdAt: new Date().toISOString(),
      changedSymbols,
      expectedBehavior,
      testLinks,
      verified: false,
    };

    if (!this.contracts.has(contract.id)) {
      if (this.contracts.size >= MAX_CONTRACTS) {
        const oldest = this.contractOrder.shift();
        if (oldest) this.contracts.delete(oldest);
      }
      this.contractOrder.push(contract.id);
    }
    this.contracts.set(contract.id, contract);
    return contract;
  }

  verifyContract(contract: BehavioralContract): ContractVerification {
    const unlinked: UnlinkedSymbol[] = [];

    for (const sym of contract.changedSymbols) {
      const hasLink = contract.testLinks.some((tl) => tl.symbolName === sym.name);
      if (!hasLink) {
        unlinked.push({
          name: sym.name,
          file: sym.file,
          reason: t("sroNoTest", { sym: sym.name }),
        });
      }
    }

    const total = contract.changedSymbols.length;
    const linked = total - unlinked.length;
    const allLinked = unlinked.length === 0;

    contract.verified = true;
    contract.verifiedAt = new Date().toISOString();

    return {
      contractId: contract.id,
      featureId: contract.featureId,
      allLinked,
      totalSymbols: total,
      linkedSymbols: linked,
      unlinkedSymbols: unlinked,
      verificationResult: allLinked ? "pass" : "fail",
    };
  }

  clear(): void {
    this.contracts.clear();
    this.contractOrder = [];
  }
}


const SYMBOL_PATTERNS = [
  /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
  /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=(?:\s*async)?\s*(?:\([^)]*\)|[^=]+)\s*=>/g,
  /(?:export\s+)?class\s+(\w+)/g,
  /def\s+(\w+)/g,
  /fn\s+(\w+)/g,
  /func\s+(\w+)/g,
  /(?:public|private|protected)?\s*(\w+)\s*\([^)]*\)\s*{/g,
];

function extractSymbolsBasic(content: string): string[] {
  const symbols = new Set<string>();

  for (const pattern of SYMBOL_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      if (m[1]) symbols.add(m[1]);
    }
  }

  return [...symbols];
}
