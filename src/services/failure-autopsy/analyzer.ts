

import { logger } from "../../utils/logger.ts";
import { BaseInnovationService, createSingleton } from "../base-innovation-service.ts";
import type {
  FailureInstance,
  Lesson,
  Diagnosis,
  FailureCategory,
  FailurePattern,
  FailureAutopsyConfig,
  FailureEvent,
  FailureQuery,
  FailureQueryResult,
} from "./types.js";
import {
  FailureAutopsyConfigSchema,
  generateFailureId,
  generateLessonId,
  generateDiagnosisId,
  generatePatternId,
  categorizeError,
  assessImpact,
} from "./types.js";



function safeParseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}



export class FailureAutopsyAnalyzer extends BaseInnovationService<FailureAutopsyConfig, FailureEvent> {
  private failures: Map<string, FailureInstance> = new Map();
  private lessons: Map<string, Lesson> = new Map();
  private diagnoses: Map<string, Diagnosis> = new Map();
  private patterns: Map<string, FailurePattern> = new Map();
  
  private categorySourceIndex: Map<string, Map<string, Set<string>>> = new Map();
  
  private categoryPatternIndex: Map<string, Set<string>> = new Map();
  private readonly MAX_SIMILAR_CANDIDATES = 50;

  
  private indexPattern(pattern: FailurePattern): void {
    const cat = pattern.category || "unknown";
    if (!this.categoryPatternIndex.has(cat)) {
      this.categoryPatternIndex.set(cat, new Set());
    }
    this.categoryPatternIndex.get(cat)!.add(pattern.id);
  }

  
  private findPatternByCategory(category: string | undefined, source?: string): FailurePattern | undefined {
    if (!category) return undefined;
    const ids = this.categoryPatternIndex.get(category);
    if (!ids) return undefined;
    const sourceNeedle = source || "";
    for (const id of ids) {
      const pattern = this.patterns.get(id);
      if (pattern && pattern.description.includes(sourceNeedle)) {
        return pattern;
      }
    }
    return undefined;
  }

  constructor(config?: Partial<FailureAutopsyConfig>) {
    super(config, FailureAutopsyConfigSchema);
  }

  
  private indexFailure(failure: FailureInstance): void {
    const cat = failure.category || "unknown";
    const src = failure.source || "unknown";
    if (!this.categorySourceIndex.has(cat)) {
      this.categorySourceIndex.set(cat, new Map());
    }
    const srcMap = this.categorySourceIndex.get(cat)!;
    if (!srcMap.has(src)) {
      srcMap.set(src, new Set());
    }
    srcMap.get(src)!.add(failure.id);
  }

  
  recordFailure(
    message: string,
    source: string,
    options?: {
      category?: string;
      stackTrace?: string;
      task?: string;
      context?: Record<string, unknown>;
      userId?: string;
    },
  ): FailureInstance {
    const now = new Date().toISOString();
    const category = options?.category ? (options.category as FailureCategory) : categorizeError(message);

    const failure: FailureInstance = {
      id: generateFailureId(),
      category,
      summary: message.slice(0, 200),
      originalMessage: message,
      stackTrace: options?.stackTrace,
      source,
      task: options?.task,
      context: options?.context,
      timestamp: now,
      resolved: false,
      occurrenceCount: 1,
      affectedUsers: options?.userId ? [options.userId] : [],
    };

    this.failures.set(failure.id, failure);
    this.indexFailure(failure);
    this.trimFailures();

    this.emitEvent({
      type: "failure_recorded",
      payload: { failureId: failure.id, category, source },
      source: "failure-autopsy",
      timestamp: now,
    });

    
    if (this.config.autoGenerateLessons) {
      this.diagnose(failure.id);
    }

    return failure;
  }

  
  diagnose(failureId: string): Diagnosis | null {
    const failure = this.failures.get(failureId);
    if (!failure) return null;

    const now = new Date().toISOString();

    
    const rootCause = this.analyzeRootCause(failure);
    const contributingFactors = this.identifyContributingFactors(failure);
    const impact = assessImpact(failure.originalMessage);
    const suggestedFixes = this.suggestFixes(failure);

    
    const recurrenceProbability = this.calculateRecurrenceProbability(failure);

    const diagnosis: Diagnosis = {
      id: generateDiagnosisId(),
      failureId,
      rootCause,
      contributingFactors,
      impact,
      recurrenceProbability,
      suggestedFixes,
      affectedTools: [failure.source],
      diagnosedAt: now,
      diagnosedBy: "system",
    };

    this.diagnoses.set(diagnosis.id, diagnosis);

    this.emitEvent({
      type: "diagnosis_created",
      payload: { diagnosisId: diagnosis.id, failureId, rootCause },
      source: "failure-autopsy",
      timestamp: now,
    });

    
    if (this.config.autoGenerateLessons) {
      this.generateLesson(failureId, diagnosis.id);
    }

    return diagnosis;
  }

  
  private analyzeRootCause(failure: FailureInstance): string {
    const msg = failure.originalMessage.toLowerCase();

    if (failure.category === "timeout") {
      return "Operation exceeded time limit — consider optimizing or adding timeout handling";
    }
    if (failure.category === "validation_error") {
      return "Input validation failed — check data format and constraints";
    }
    if (failure.category === "tool_error") {
      if (msg.includes("not found")) {
        return "Required resource not found — verify path or dependency";
      }
      if (msg.includes("permission")) {
        return "Insufficient permissions — check access rights";
      }
      return "Tool execution failed — review tool configuration";
    }
    if (failure.category === "resource_exhaustion") {
      return "System resource exhausted — consider cleanup or optimization";
    }
    if (failure.category === "integration_error") {
      return "External integration failed — check connectivity and API status";
    }

    return "Unknown root cause — requires manual investigation";
  }

  
  private identifyContributingFactors(failure: FailureInstance): string[] {
    const factors: string[] = [];

    if (failure.context) {
      if (failure.context["retryCount"]) {
        factors.push("Multiple retry attempts detected");
      }
      if (failure.context["concurrent"]) {
        factors.push("Concurrent operation may have caused conflict");
      }
    }

    if (failure.stackTrace) {
      if (failure.stackTrace.includes("async")) {
        factors.push("Async operation involved");
      }
      if (failure.stackTrace.includes("timeout")) {
        factors.push("Timeout in call stack");
      }
    }

    
    const similarFailures = this.findSimilarFailures(failure);
    if (similarFailures.length > 0) {
      factors.push(`${similarFailures.length} similar failures occurred previously`);
    }

    return factors;
  }

  
  private suggestFixes(failure: FailureInstance): string[] {
    const fixes: string[] = [];

    switch (failure.category) {
      case "timeout":
        fixes.push("Increase timeout duration");
        fixes.push("Optimize operation to complete faster");
        fixes.push("Add timeout handling with graceful degradation");
        break;
      case "validation_error":
        fixes.push("Validate input before processing");
        fixes.push("Add input sanitization");
        fixes.push("Update validation schema");
        break;
      case "tool_error":
        fixes.push("Verify tool configuration");
        fixes.push("Check file paths and permissions");
        fixes.push("Add error handling for tool failures");
        break;
      case "resource_exhaustion":
        fixes.push("Implement resource cleanup");
        fixes.push("Add memory/resource monitoring");
        fixes.push("Optimize resource usage");
        break;
      case "integration_error":
        fixes.push("Check network connectivity");
        fixes.push("Verify API credentials");
        fixes.push("Add retry logic with exponential backoff");
        break;
      default:
        fixes.push("Review error logs for details");
        fixes.push("Add more specific error handling");
    }

    return fixes;
  }

  
  private calculateRecurrenceProbability(failure: FailureInstance): number {
    const similar = this.findSimilarFailures(failure);

    if (similar.length === 0) return 0.1;
    if (similar.length === 1) return 0.3;
    if (similar.length < 5) return 0.5;
    if (similar.length < 10) return 0.7;
    return 0.9;
  }

  
  private findSimilarFailures(failure: FailureInstance): FailureInstance[] {
    const cat = failure.category || "unknown";
    const src = failure.source || "unknown";

    
    const srcMap = this.categorySourceIndex.get(cat);
    if (!srcMap) return [];

    const candidateIds = srcMap.get(src);
    if (!candidateIds || candidateIds.size === 0) return [];

    const candidates: FailureInstance[] = [];
    for (const id of candidateIds) {
      if (id === failure.id) continue;
      const f = this.failures.get(id);
      if (f) candidates.push(f);
      if (candidates.length >= this.MAX_SIMILAR_CANDIDATES) break;
    }

    return candidates.filter((f) => this.calculateSimilarity(f.originalMessage, failure.originalMessage) > 0.6);
  }

  
  private calculateSimilarity(a: string, b: string): number {
    const stem = (w: string) => w.toLowerCase().replace(/ies$/, "y").replace(/ses$/, "s").replace(/s$/, "");
    const wordsA = new Set(a.toLowerCase().split(/\s+/).map(stem).filter(Boolean));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).map(stem).filter(Boolean));

    const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  
  generateLesson(failureId: string, diagnosisId?: string): Lesson | null {
    const failure = this.failures.get(failureId);
    if (!failure) return null;

    const diagnosis = diagnosisId
      ? this.diagnoses.get(diagnosisId)
      : Array.from(this.diagnoses.values()).find((d) => d.failureId === failureId);

    const now = new Date().toISOString();

    const lesson: Lesson = {
      id: generateLessonId(),
      failureId,
      title: `Lesson from ${failure.category}: ${failure.summary.slice(0, 50)}`,
      description: this.generateLessonDescription(failure, diagnosis),
      type: diagnosis?.impact === "critical" ? "prevention" : "recovery",
      priority:
        diagnosis?.impact === "critical"
          ? 5
          : diagnosis?.impact === "high"
            ? 4
            : diagnosis?.impact === "medium"
              ? 3
              : 2,
      applied: false,
      createdAt: now,
      retrievalCount: 0,
      source: "failure_analysis",
    };

    this.lessons.set(lesson.id, lesson);
    this.trimLessons();

    this.emitEvent({
      type: "lesson_generated",
      payload: { lessonId: lesson.id, failureId, title: lesson.title },
      source: "failure-autopsy",
      timestamp: now,
    });

    return lesson;
  }

  
  private generateLessonDescription(failure: FailureInstance, diagnosis?: Diagnosis): string {
    let desc = `Failure: ${failure.originalMessage}\n\n`;

    if (diagnosis) {
      desc += `Root Cause: ${diagnosis.rootCause}\n\n`;
      desc += `Impact: ${diagnosis.impact}\n\n`;
      desc += `Suggested Fixes:\n`;
      for (const fix of diagnosis.suggestedFixes) {
        desc += `- ${fix}\n`;
      }
    }

    return desc;
  }

  
  detectPatterns(): FailurePattern[] {
    const failuresByCategory = new Map<string, FailureInstance[]>();

    
    for (const failure of this.failures.values()) {
      const key = `${failure.category}:${failure.source}`;
      if (!failuresByCategory.has(key)) {
        failuresByCategory.set(key, []);
      }
      failuresByCategory.get(key)!.push(failure);
    }

    const newPatterns: FailurePattern[] = [];

    for (const [key, failures] of failuresByCategory) {
      if (failures.length >= this.config.patternThreshold) {
        const [category, source] = key.split(":");

        
        const existingPattern = this.findPatternByCategory(category, source || "");

        if (existingPattern) {
          
          existingPattern.frequency = failures.length;
          existingPattern.lastSeen = new Date().toISOString();
          existingPattern.failureIds = failures.map((f) => f.id);
        } else {
          
          const pattern: FailurePattern = {
            id: generatePatternId(),
            description: `Recurring ${category} errors in ${source}`,
            category: category as FailureCategory,
            frequency: failures.length,
            failureIds: failures.map((f) => f.id),
            successfulResolutions: [],
            permanentlyResolved: false,
            lastSeen: new Date().toISOString(),
            firstSeen: failures[failures.length - 1]?.timestamp || new Date().toISOString(),
          };

          this.patterns.set(pattern.id, pattern);
          this.indexPattern(pattern);
          newPatterns.push(pattern);

          this.emitEvent({
            type: "pattern_detected",
            payload: { patternId: pattern.id, category, frequency: pattern.frequency },
            source: "failure-autopsy",
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    return newPatterns;
  }

  
  applyLesson(lessonId: string): boolean {
    const lesson = this.lessons.get(lessonId);
    if (!lesson) return false;

    lesson.applied = true;

    this.emitEvent({
      type: "lesson_applied",
      payload: { lessonId, title: lesson.title },
      source: "failure-autopsy",
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  
  resolveFailure(failureId: string, resolution: string): boolean {
    const failure = this.failures.get(failureId);
    if (!failure) return false;

    failure.resolved = true;
    failure.resolution = resolution;

    this.emitEvent({
      type: "failure_resolved",
      payload: { failureId, resolution },
      source: "failure-autopsy",
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  
  resolvePattern(patternId: string, resolution: string): boolean {
    const pattern = this.patterns.get(patternId);
    if (!pattern) return false;

    pattern.permanentlyResolved = true;
    pattern.successfulResolutions.push(resolution);

    this.emitEvent({
      type: "pattern_resolved",
      payload: { patternId, resolution },
      source: "failure-autopsy",
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  
  query(query: FailureQuery): FailureQueryResult {
    const startTime = Date.now();
    let failures = Array.from(this.failures.values());
    let lessons = Array.from(this.lessons.values());
    let patterns = Array.from(this.patterns.values());

    
    if (query.category) {
      failures = failures.filter((f) => f.category === query.category);
    }

    
    if (query.source) {
      failures = failures.filter((f) => f.source === query.source);
    }

    
    if (query.resolved !== undefined) {
      failures = failures.filter((f) => f.resolved === query.resolved);
    }

    
    if (query.since) {
      const since = safeParseDate(query.since);
      if (since) {
        failures = failures.filter((f) => {
          const d = safeParseDate(f.timestamp);
          return d && d >= since;
        });
      }
    }

    if (query.until) {
      const until = safeParseDate(query.until);
      if (until) {
        failures = failures.filter((f) => {
          const d = safeParseDate(f.timestamp);
          return d && d <= until;
        });
      }
    }

    
    if (query.minOccurrences) {
      failures = failures.filter((f) => f.occurrenceCount >= query.minOccurrences!);
    }

    
    const orderBy = query.orderBy || "recent";
    if (orderBy === "recent") {
      failures.sort((a, b) => {
        const da = safeParseDate(a.timestamp);
        const db = safeParseDate(b.timestamp);
        return (db?.getTime() ?? 0) - (da?.getTime() ?? 0);
      });
    } else if (orderBy === "frequent") {
      failures.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
    } else if (orderBy === "impact") {
      const impactOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      failures.sort((a, b) => {
        const aImpact = impactOrder[assessImpact(a.originalMessage)] || 0;
        const bImpact = impactOrder[assessImpact(b.originalMessage)] || 0;
        return bImpact - aImpact;
      });
    }

    
    const limit = query.limit || 50;
    failures = failures.slice(0, limit);
    lessons = lessons.slice(0, limit);
    patterns = patterns.slice(0, limit);

    return {
      failures,
      lessons,
      patterns,
      total: failures.length + lessons.length + patterns.length,
      queryTimeMs: Date.now() - startTime,
    };
  }

  
  private trimFailures(): void {
    if (this.failures.size <= this.config.maxFailures) return;

    const impactWeight = (f: FailureInstance): number => {
      const impact = assessImpact(f.originalMessage);
      const score = impact === "critical" ? 4 : impact === "high" ? 3 : impact === "medium" ? 2 : 1;
      const ageMs = Date.now() - new Date(f.timestamp).getTime();
      const recency = Math.exp(-ageMs / (7 * 24 * 3600 * 1000));
      return score * (0.5 + recency);
    };
    const sorted = Array.from(this.failures.values()).sort((a, b) => impactWeight(b) - impactWeight(a));

    const toKeep = sorted.slice(0, this.config.maxFailures);
    this.failures.clear();
    this.categorySourceIndex.clear();
    for (const failure of toKeep) {
      this.failures.set(failure.id, failure);
      this.indexFailure(failure);
    }
  }

  
  private trimLessons(): void {
    if (this.lessons.size <= this.config.maxLessons) return;

    const sorted = Array.from(this.lessons.values()).sort((a, b) => b.priority - a.priority);

    const toKeep = sorted.slice(0, this.config.maxLessons);
    this.lessons.clear();
    for (const lesson of toKeep) {
      this.lessons.set(lesson.id, lesson);
    }
  }

  
  async persist(): Promise<void> {
    this.persistToDisk("failure-autopsy", () => ({
      failures: Array.from(this.failures.values()),
      lessons: Array.from(this.lessons.values()),
      diagnoses: Array.from(this.diagnoses.values()),
      patterns: Array.from(this.patterns.values()),
    }));
  }

  
  async load(): Promise<void> {
    const data = await this.readFromDisk<{
      version: string;
      persistedAt: string;
      failures: FailureInstance[];
      lessons: Lesson[];
      diagnoses: Diagnosis[];
      patterns: FailurePattern[];
    }>();

    if (!data) return;

    if (data.failures && Array.isArray(data.failures)) {
      for (const failure of data.failures) {
        this.failures.set(failure.id, failure);
        this.indexFailure(failure);
      }
    }

    if (data.lessons && Array.isArray(data.lessons)) {
      for (const lesson of data.lessons) {
        this.lessons.set(lesson.id, lesson);
      }
    }

    if (data.diagnoses && Array.isArray(data.diagnoses)) {
      for (const diagnosis of data.diagnoses) {
        this.diagnoses.set(diagnosis.id, diagnosis);
      }
    }

    if (data.patterns && Array.isArray(data.patterns)) {
      for (const pattern of data.patterns) {
        this.patterns.set(pattern.id, pattern);
        this.indexPattern(pattern);
      }
    }

    
    if (this.config.autoGenerateLessons && data.failures?.length) {
      this.detectPatterns();
    }

    logger.info(`Loaded ${this.failures.size} failures, ${this.lessons.size} lessons`);
  }

  
  getStats(): {
    totalFailures: number;
    totalLessons: number;
    totalDiagnoses: number;
    totalPatterns: number;
    resolvedFailures: number;
    appliedLessons: number;
  } {
    return {
      totalFailures: this.failures.size,
      totalLessons: this.lessons.size,
      totalDiagnoses: this.diagnoses.size,
      totalPatterns: this.patterns.size,
      resolvedFailures: Array.from(this.failures.values()).filter((f) => f.resolved).length,
      appliedLessons: Array.from(this.lessons.values()).filter((l) => l.applied).length,
    };
  }

  
  formatForLLM(failureId: string): string {
    const failure = this.failures.get(failureId);
    if (!failure) return `## Failure Analysis\n\nNo data found for ID: ${failureId}`;

    const diagnosis = Array.from(this.diagnoses.values()).find((d) => d.failureId === failureId);
    const pattern = Array.from(this.patterns.values()).find((p) => p.failureIds.includes(failureId));
    const lesson = Array.from(this.lessons.values()).find((l) => l.failureId === failureId);

    const lines: string[] = [
      `## Failure Analysis Report`,
      ``,
      `**Summary:** ${failure.summary}`,
      `**Category:** ${failure.category}`,
      `**Source:** ${failure.source}`,
      `**Timestamp:** ${failure.timestamp}`,
      `**Occurrences:** ${failure.occurrenceCount}`,
      `**Resolved:** ${failure.resolved ? "Yes" : "No"}`,
      ``,
    ];

    if (diagnosis) {
      lines.push(`### Diagnosis`);
      lines.push(`**Root Cause:** ${diagnosis.rootCause}`);
      lines.push(`**Impact:** ${diagnosis.impact}`);
      lines.push(`**Suggested Fixes:**`);
      for (const fix of diagnosis.suggestedFixes) {
        lines.push(`- ${fix}`);
      }
      lines.push("");
    }

    if (pattern) {
      lines.push(`### Pattern`);
      lines.push(`**Frequency:** ${pattern.frequency}`);
      lines.push(`**Description:** ${pattern.description}`);
      lines.push(`**Resolved:** ${pattern.permanentlyResolved ? "Yes" : "No"}`);
      lines.push("");
    }

    if (lesson) {
      lines.push(`### Lesson`);
      lines.push(`**Title:** ${lesson.title}`);
      lines.push(`**Priority:** ${lesson.priority}`);
      lines.push(`**Applied:** ${lesson.applied ? "Yes" : "No"}`);
      lines.push(`**Description:** ${lesson.description}`);
      lines.push("");
    }

    lines.push(`### Original Error`);
    lines.push(`\`\`\``);
    lines.push(failure.originalMessage);
    lines.push(`\`\`\``);

    return lines.join("\n");
  }

  
  clear(): void {
    this.failures.clear();
    this.lessons.clear();
    this.diagnoses.clear();
    this.patterns.clear();
    this.categoryPatternIndex.clear();
  }

  
  isEnabled(): boolean {
    return this.config.enabled;
  }
}



export const { get: getFailureAutopsyAnalyzer, reset: resetFailureAutopsyAnalyzer } =
  createSingleton<FailureAutopsyAnalyzer>(
    (config) => new FailureAutopsyAnalyzer(config as Partial<FailureAutopsyConfig> | undefined),
    true, // warn when config passed to existing instance
  );
