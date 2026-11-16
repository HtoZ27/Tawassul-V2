

import { logger } from "../utils/logger.ts";
import type { ToolExecuteAfterContext } from "../hooks/tool-execute-types.ts";
import type { FixRecord } from "./regression-guard.ts";



export const _taskTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

export function drainTaskTimeouts(): void {
  for (const [key, t] of _taskTimeouts) {
    clearTimeout(t);
    _taskTimeouts.delete(key);
  }
}







export const _pendingAnalyses = new Set<Promise<void>>();
export const MAX_PENDING_ANALYSES = 50;

export function drainStructuralAnalyses(timeoutMs = 2000): Promise<void> {
  const all = [..._pendingAnalyses];
  if (all.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.allSettled(all).then(() => undefined),
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      t.unref?.();
    }),
  ]);
}

async function runStructuralAnalysisInBackground(
  ctx: ToolExecuteAfterContext,
  featureId: string,
  changedFiles: string[],
  fixRecord: FixRecord,
): Promise<void> {
  try {
    const fp = await ctx.semanticCoverageGuard.captureFingerprint(featureId, changedFiles);
    ctx.featureIndex.setMetadata(featureId, "structuralFingerprint", JSON.stringify(fp));
    logger.debug(`Structural fingerprint captured: ${changedFiles.length} files`);

    const contract = await ctx.semanticRegressionOracle.extractContract(featureId, changedFiles, fixRecord);
    ctx.featureIndex.setMetadata(featureId, "behavioralContract", JSON.stringify(contract));
    ctx.featureIndex.setMetadata(featureId, "lastContractId", contract.id);
    logger.debug(`Behavioral contract extracted: ${contract.changedSymbols.length} symbols`);

    const sourceFiles = changedFiles.filter(
      (f) =>
        !f.endsWith(".test.ts") &&
        !f.endsWith(".spec.ts") &&
        !f.endsWith(".test.js") &&
        !f.endsWith(".spec.js") &&
        !f.endsWith("_test.py") &&
        !f.endsWith("_test.go") &&
        !f.endsWith(".test.rs"),
    );
    const testFileList = changedFiles.filter(
      (f) =>
        f.endsWith(".test.ts") ||
        f.endsWith(".spec.ts") ||
        f.endsWith(".test.js") ||
        f.endsWith(".spec.js") ||
        f.endsWith("_test.py") ||
        f.endsWith("_test.go") ||
        f.endsWith(".test.rs"),
    );
    if (sourceFiles.length > 0) {
      const coverageResult = await ctx.semanticCoverageGuard.checkCoverage(featureId, sourceFiles, testFileList);
      ctx.featureIndex.setMetadata(
        featureId,
        "structuralCoverageResult",
        JSON.stringify({
          hasGaps: coverageResult.hasGaps,
          gaps: coverageResult.gaps,
          coverageRatio: coverageResult.coverageRatio,
        }),
      );
      logger.debug(
        `Structural coverage: ${coverageResult.coveredSymbols}/${coverageResult.totalSymbols} symbols covered`,
      );
    } else {
      ctx.featureIndex.setMetadata(
        featureId,
        "structuralCoverageResult",
        JSON.stringify({
          hasGaps: false,
          gaps: [],
          coverageRatio: 1,
        }),
      );
    }

    const verification = ctx.semanticRegressionOracle.verifyContract(contract);
    ctx.featureIndex.setMetadata(
      featureId,
      "contractVerification",
      JSON.stringify({
        allLinked: verification.allLinked,
        total: verification.totalSymbols,
        linked: verification.linkedSymbols,
        unlinkedSymbols: verification.unlinkedSymbols,
        result: verification.verificationResult,
      }),
    );
    logger.debug(`Contract verification: ${verification.linkedSymbols}/${verification.totalSymbols} symbols linked`);
  } catch (e) {
    logger.warn("[tawassul] background structural analysis error:", e);
  }
}

export function runTrackedStructuralAnalysis(
  ctx: ToolExecuteAfterContext,
  featureId: string,
  changedFiles: string[],
  fixRecord: FixRecord,
): void {
  
  
  
  if (_pendingAnalyses.size >= MAX_PENDING_ANALYSES) {
    logger.warn(`[tawassul] _pendingAnalyses limit reached (${MAX_PENDING_ANALYSES}) — dropping new analysis`);
    return;
  }
  const p: Promise<void> = runStructuralAnalysisInBackground(ctx, featureId, changedFiles, fixRecord).finally(() => {
    _pendingAnalyses.delete(p);
  });
  _pendingAnalyses.add(p);
}

export function getPendingAnalysesCount(): number {
  return _pendingAnalyses.size;
}

export function __resetPendingAnalysesForTest(): void {
  _pendingAnalyses.clear();
}
