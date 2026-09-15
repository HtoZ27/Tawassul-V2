


import type { FeatureIndex } from "./feature-index.ts";
import { secureId } from "../utils/crypto.ts";



export interface FixRecord {
  id: string;
  featureId: string;
  algId: string;
  description: string;
  files: string[];
  testFile?: string;
  testName?: string;
  timestamp: string;
  verified: boolean;
}

export interface RegressionCheckResult {
  required: boolean;
  hasTest: boolean;
  suggestedTestFile?: string;
  suggestedTestName?: string;
  reason: string;
}



const MAX_FIX_HISTORY = 200;

export class RegressionGuard {
  private fixHistory: FixRecord[] = [];

  registerFix(params: {
    featureId: string;
    algId: string;
    description: string;
    files: string[];
    testFile?: string;
    testName?: string;
  }): FixRecord {
    const record: FixRecord = {
      id: `fix-${Date.now()}-${secureId()}`,
      featureId: params.featureId,
      algId: params.algId,
      description: params.description,
      files: params.files,
      testFile: params.testFile,
      testName: params.testName,
      timestamp: new Date().toISOString(),
      verified: !!params.testFile && !!params.testName,
    };

    this.fixHistory.unshift(record);
    if (this.fixHistory.length > MAX_FIX_HISTORY) {
      this.fixHistory.length = MAX_FIX_HISTORY;
    }

    return record;
  }

  registerFixWithRegression(
    params: {
      featureId: string;
      algId: string;
      description: string;
      files: string[];
      testFile?: string;
      testName?: string;
    },
    featureIndex: FeatureIndex,
  ): FixRecord {
    const record = this.registerFix(params);
    const testName = params.testName || this.guessTestName(params.algId, params.description);
    featureIndex.addRegressionRecord(params.featureId, {
      testName,
      errorMessage: params.description,
      fixRef: record.id,
    });
    return record;
  }

  checkRegressionTestRequired(params: {
    featureIndex: FeatureIndex;
    featureId: string;
    algId: string;
    files: string[];
    description: string;
  }): RegressionCheckResult {
    const feature = params.featureIndex.getById(params.featureId);
    if (!feature) {
      return {
        required: true,
        hasTest: false,
        reason: `الميزة "${params.featureId}" غير مسجلة — يجب إنشاء اختبار تراجعي`,
      };
    }

    const existingRegression = feature.regressionTests;

    const similarFix = this.fixHistory.find(
      f => f.algId === params.algId &&
           f.files.some(file => params.files.includes(file))
    );

    if (similarFix && !similarFix.verified) {
      return {
        required: true,
        hasTest: false,
        suggestedTestFile: similarFix.testFile,
        suggestedTestName: similarFix.testName,
        reason: `إصلاح سابق للخوارزمية ${params.algId} لم ينتج اختباراً تراجعياً`,
      };
    }

    const suggestedTestFile = this.guessTestFile(params.files);
    const suggestedTestName = this.guessTestName(params.algId, params.description);

    if (existingRegression.length === 0) {
      return {
        required: true,
        hasTest: false,
        suggestedTestFile,
        suggestedTestName,
        reason: `هذا أول إصلاح للخوارزمية ${params.algId} — يجب إنشاء اختبار تراجعي`,
      };
    }

    return {
      required: false,
      hasTest: true,
      suggestedTestFile,
      suggestedTestName,
      reason: `توجد ${existingRegression.length} اختبارات تراجعية سابقة`,
    };
  }

  verifyFix(fixId: string, testFile: string, testName: string, featureIndex?: FeatureIndex): boolean {
    const fix = this.fixHistory.find(f => f.id === fixId);
    if (!fix) return false;

    fix.testFile = testFile;
    fix.testName = testName;
    fix.verified = true;

    if (featureIndex) {
      featureIndex.addRegressionRecord(fix.featureId, {
        testName,
        errorMessage: fix.description,
        fixRef: fix.id,
      });
    }
    return true;
  }

  getFixHistory(): FixRecord[] {
    return [...this.fixHistory];
  }

  getFixesForFeature(featureId: string): FixRecord[] {
    return this.fixHistory.filter(f => f.featureId === featureId);
  }

  getFixesForAlgorithm(algId: string): FixRecord[] {
    return this.fixHistory.filter(f => f.algId === algId);
  }

  reset(): void {
    this.fixHistory = [];
  }

  

  private guessTestFile(files: string[]): string {
    for (const file of files) {
      const match = file.match(/^(?:src\/)?(.+?)(?:\.ts)?$/);
      if (match) {
        const baseName = match[1]!.replace(/\/index$/, "");
        return `tests/${baseName}.test.ts`;
      }
    }
    return "tests/regression.test.ts";
  }

  private guessTestName(algId: string, description: string): string {
    const desc = description
      .replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join(" ");

    return `regression-${algId.toLowerCase()}: ${desc}`;
  }
}
