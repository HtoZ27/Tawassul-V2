import { randomUUID } from "node:crypto";
import type { TawassulEvaluationReport } from "../context/evaluation-report.ts";
import { normalizeLegacyFeatureEntry, sanitizeFeatureText } from "./feature-index-english.ts";

type FeatureStatus = "discovered" | "in-progress" | "completed" | "closed" | "regressed";

interface RegressionRecord {
  date: string;
  testName: string;
  errorMessage: string;
  fixRef?: string;
}

interface FeatureEntry {
  id: string;
  name: string;
  description: string;
  status: FeatureStatus;
  files: string[];
  algorithms: string[];
  tests: string[];
  components: string[];
  regressionTests: RegressionRecord[];
  created: string;
  updated: string;
  closedAt?: string;
  closedBy?: string;
  completedAt?: string;
  tags: string[];
  metadata: Record<string, string>;
  evaluationReports: TawassulEvaluationReport[];
}

interface FeatureIndexSnapshot {
  entries: FeatureEntry[];
  byFile: Record<string, string[]>;
  byComponent: Record<string, string[]>;
  byAlgorithm: Record<string, string[]>;
  byStatus: Record<FeatureStatus, string[]>;
}

const DEFAULT_MAX_FEATURES = 500;
const MAX_SUB_ARRAY = 50;
const MAX_SESSION_FEATURES = 20;

function isSessionFeature(entry: FeatureEntry): boolean {
  return entry.name.startsWith("session:");
}

export class FeatureIndex {
  private entries: FeatureEntry[] = [];
  private maxFeatures: number;
  private _version = 0;
  private _snapshotCache: FeatureIndexSnapshot | null = null;
  private _snapshotVersion = -1;
  private _statsCache: {
    total: number;
    byStatus: Record<FeatureStatus, number>;
    totalFiles: number;
    totalTests: number;
    totalRegressionTests: number;
  } | null = null;
  private _statsVersion = -1;

  constructor(maxFeatures = DEFAULT_MAX_FEATURES) {
    this.maxFeatures = maxFeatures;
  }

  private _bumpVersion(): void {
    this._version++;
    this._snapshotCache = null;
    this._statsCache = null;
  }

  register(params: {
    name: string;
    description: string;
    files?: string[];
    algorithms?: string[];
    components?: string[];
    tags?: string[];
  }): FeatureEntry {
    const entry: FeatureEntry = {
      id: `feat-${randomUUID()}`,
      name: sanitizeFeatureText(params.name, "Session task"),
      description: sanitizeFeatureText(
        params.description,
        "Registered from a non-English message; see the session transcript.",
      ),
      status: "discovered",
      files: [...new Set(params.files ?? [])],
      algorithms: [...new Set(params.algorithms ?? [])],
      tests: [],
      components: [...new Set(params.components ?? [])],
      regressionTests: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      tags: [...new Set(params.tags ?? [])],
      metadata: {},
      evaluationReports: [],
    };

    this.entries.push(entry);

    this._trimEntries();

    this._bumpVersion();
    return entry;
  }

  private _trimEntries(): void {
    const sessionCount = this.entries.reduce((n, e) => n + (isSessionFeature(e) ? 1 : 0), 0);
    const realCount = this.entries.length - sessionCount;
    const sessionExcess = sessionCount - MAX_SESSION_FEATURES;
    const realExcess = realCount - this.maxFeatures;
    if (sessionExcess <= 0 && realExcess <= 0) return;
    let sessDrop = Math.max(0, sessionExcess);
    let realDrop = Math.max(0, realExcess);
    const kept: FeatureEntry[] = [];
    for (const e of this.entries) {
      if (isSessionFeature(e)) {
        if (sessDrop > 0) {
          sessDrop--;
          continue;
        }
      } else if (realDrop > 0) {
        realDrop--;
        continue;
      }
      kept.push(e);
    }
    this.entries = kept;
  }

  transitionTo(id: string, newStatus: FeatureStatus): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;

    const validTransitions: Record<FeatureStatus, FeatureStatus[]> = {
      discovered: ["in-progress"],
      "in-progress": ["completed"],
      completed: ["closed", "regressed"],
      closed: ["regressed"],
      regressed: ["in-progress"],
    };

    const allowed = validTransitions[entry.status];
    if (!allowed?.includes(newStatus)) return false;

    entry.status = newStatus;
    entry.updated = new Date().toISOString();

    if (newStatus === "completed") {
      entry.completedAt = new Date().toISOString();
    }
    if (newStatus === "closed") {
      entry.closedAt = new Date().toISOString();
    }

    this._bumpVersion();
    return true;
  }

  addFile(id: string, file: string): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    entry.files = [...new Set([...entry.files, file])];
    entry.updated = new Date().toISOString();
    this._bumpVersion();
    return true;
  }

  addAlgorithm(id: string, alg: string): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    entry.algorithms = [...new Set([...entry.algorithms, alg])];
    entry.updated = new Date().toISOString();
    this._bumpVersion();
    return true;
  }

  addTest(id: string, testFile: string): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    if (!entry.tests.includes(testFile)) entry.tests.push(testFile);
    if (entry.tests.length > MAX_SUB_ARRAY) entry.tests = entry.tests.slice(-MAX_SUB_ARRAY);
    entry.updated = new Date().toISOString();
    this._bumpVersion();
    return true;
  }

  addRegressionRecord(id: string, record: Omit<RegressionRecord, "date">): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    entry.regressionTests.push({
      ...record,
      date: new Date().toISOString(),
    });
    if (entry.regressionTests.length > MAX_SUB_ARRAY)
      entry.regressionTests = entry.regressionTests.slice(-MAX_SUB_ARRAY);
    entry.updated = new Date().toISOString();
    this._bumpVersion();
    return true;
  }

  setClosedBy(id: string, by: string): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    entry.closedBy = by;
    entry.updated = new Date().toISOString();
    this._bumpVersion();
    return true;
  }

  setMetadata(id: string, key: string, value: string): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    entry.metadata[key] = value;
    entry.updated = new Date().toISOString();
    this._bumpVersion();
    return true;
  }

  getEvaluationReports(id: string): TawassulEvaluationReport[] {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return [];
    return entry.evaluationReports.slice();
  }

  setEvaluationReport(id: string, report: TawassulEvaluationReport): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    entry.evaluationReports.push(report);
    if (entry.evaluationReports.length > MAX_SUB_ARRAY)
      entry.evaluationReports = entry.evaluationReports.slice(-MAX_SUB_ARRAY);
    entry.updated = new Date().toISOString();
    this._bumpVersion();
    return true;
  }

  setEvaluationReports(id: string, reports: TawassulEvaluationReport[]): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    entry.evaluationReports = reports.length > MAX_SUB_ARRAY ? reports.slice(-MAX_SUB_ARRAY) : reports;
    entry.updated = new Date().toISOString();
    this._bumpVersion();
    return true;
  }

  getById(id: string): FeatureEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  getByName(name: string): FeatureEntry | undefined {
    return this.entries.find((e) => e.name === name);
  }

  getByFile(file: string): FeatureEntry[] {
    return this.entries.filter((e) => e.files.includes(file));
  }

  getByAlgorithm(alg: string): FeatureEntry[] {
    return this.entries.filter((e) => e.algorithms.includes(alg));
  }

  getByComponent(component: string): FeatureEntry[] {
    return this.entries.filter((e) => e.components.includes(component));
  }

  getByStatus(status: FeatureStatus): FeatureEntry[] {
    return this.entries.filter((e) => e.status === status);
  }

  getAll(): FeatureEntry[] {
    return [...this.entries];
  }

  search(query: string): FeatureEntry[] {
    const q = query.toLowerCase();
    return this.entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.files.some((f) => f.toLowerCase().includes(q)) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  snapshot(): FeatureIndexSnapshot {
    if (this._snapshotCache && this._snapshotVersion === this._version) return this._snapshotCache;

    const byFile: Record<string, string[]> = {};
    const byComponent: Record<string, string[]> = {};
    const byAlgorithm: Record<string, string[]> = {};
    const byStatus: Record<FeatureStatus, string[]> = {
      discovered: [],
      "in-progress": [],
      completed: [],
      closed: [],
      regressed: [],
    };

    for (const entry of this.entries) {
      byStatus[entry.status].push(entry.id);

      for (const file of entry.files) {
        (byFile[file] ??= []).push(entry.id);
      }
      for (const comp of entry.components) {
        (byComponent[comp] ??= []).push(entry.id);
      }
      for (const alg of entry.algorithms) {
        (byAlgorithm[alg] ??= []).push(entry.id);
      }
    }

    this._snapshotCache = {
      entries: [...this.entries],
      byFile,
      byComponent,
      byAlgorithm,
      byStatus,
    };
    this._snapshotVersion = this._version;
    return this._snapshotCache;
  }

  toJSON(): { entries: FeatureEntry[] } {
    return { entries: this.entries };
  }

  static fromJSON(data: { entries: FeatureEntry[] }): FeatureIndex {
    const index = new FeatureIndex();
    for (const entry of data.entries) normalizeLegacyFeatureEntry(entry);
    index.entries = data.entries;
    index._bumpVersion();
    return index;
  }

  getStats(): {
    total: number;
    byStatus: Record<FeatureStatus, number>;
    totalFiles: number;
    totalTests: number;
    totalRegressionTests: number;
  } {
    if (this._statsCache && this._statsVersion === this._version) return this._statsCache;

    const byStatus: Record<FeatureStatus, number> = {
      discovered: 0,
      "in-progress": 0,
      completed: 0,
      closed: 0,
      regressed: 0,
    };

    let totalFiles = 0;
    let totalTests = 0;
    let totalRegressionTests = 0;

    for (const entry of this.entries) {
      byStatus[entry.status]++;
      totalFiles += entry.files.length;
      totalTests += entry.tests.length;
      totalRegressionTests += entry.regressionTests.length;
    }

    this._statsCache = {
      total: this.entries.length,
      byStatus,
      totalFiles,
      totalTests,
      totalRegressionTests,
    };
    this._statsVersion = this._version;
    return this._statsCache;
  }
}