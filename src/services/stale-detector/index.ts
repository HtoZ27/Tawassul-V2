import { z } from 'zod';
import { existsSync, statSync } from 'node:fs';

export const FileFreshnessSchema = z.enum([
  'fresh',
  'aging',
  'stale',
  'missing',
  'unknown',
]);

export type FileFreshness = z.infer<typeof FileFreshnessSchema>;

export const FileCheckResultSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  freshness: FileFreshnessSchema,
  lastModified: z.string().datetime().optional(),
  daysSinceModified: z.number().int().min(0).optional(),
  size: z.number().int().min(0).optional(),
  needsUpdate: z.boolean(),
  reason: z.string().optional(),
});

export type FileCheckResult = z.infer<typeof FileCheckResultSchema>;

export const StaleDetectorConfigSchema = z.object({
  enabled: z.boolean().default(true),
  freshDays: z.number().int().min(1).default(7),
  agingDays: z.number().int().min(1).default(30),
  trackedFiles: z.array(z.string()).default([
    'AGENTS.md',
    'codemap.md',
    'README.md',
    'CHANGELOG.md',
  ]),
  sendAlerts: z.boolean().default(true),
});

export type StaleDetectorConfig = z.infer<typeof StaleDetectorConfigSchema>;

export class StaleDetector {
  private config: StaleDetectorConfig;

  constructor(config?: Partial<StaleDetectorConfig>) {
    this.config = StaleDetectorConfigSchema.parse(config || {});
  }

  checkFile(filePath: string): FileCheckResult {
    const exists = existsSync(filePath);

    if (!exists) {
      return {
        path: filePath,
        exists: false,
        freshness: 'missing',
        needsUpdate: true,
        reason: 'File does not exist',
      };
    }

    try {
      const stats = statSync(filePath);
      const lastModified = stats.mtime.toISOString();
      const daysSinceModified = Math.floor(
        (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24)
      );

      let freshness: FileFreshness;
      let needsUpdate = false;
      let reason: string | undefined;

      if (daysSinceModified <= this.config.freshDays) {
        freshness = 'fresh';
      } else if (daysSinceModified <= this.config.agingDays) {
        freshness = 'aging';
        needsUpdate = true;
        reason = `File is ${daysSinceModified} days old (aging threshold: ${this.config.freshDays} days)`;
      } else {
        freshness = 'stale';
        needsUpdate = true;
        reason = `File is ${daysSinceModified} days old (stale threshold: ${this.config.agingDays} days)`;
      }

      return {
        path: filePath,
        exists: true,
        freshness,
        lastModified,
        daysSinceModified,
        size: stats.size,
        needsUpdate,
        reason,
      };
    } catch (error) {
      return {
        path: filePath,
        exists: true,
        freshness: 'unknown',
        needsUpdate: true,
        reason: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  checkAllFiles(): FileCheckResult[] {
    return this.config.trackedFiles.map(file => this.checkFile(file));
  }

  findStaleFiles(): FileCheckResult[] {
    return this.checkAllFiles().filter(f => f.needsUpdate);
  }

  getSummary(): {
    total: number;
    fresh: number;
    aging: number;
    stale: number;
    missing: number;
    needsUpdate: number;
  } {
    const results = this.checkAllFiles();

    return {
      total: results.length,
      fresh: results.filter(f => f.freshness === 'fresh').length,
      aging: results.filter(f => f.freshness === 'aging').length,
      stale: results.filter(f => f.freshness === 'stale').length,
      missing: results.filter(f => f.freshness === 'missing').length,
      needsUpdate: results.filter(f => f.needsUpdate).length,
    };
  }

  updateConfig(updates: Partial<StaleDetectorConfig>): void {
    this.config = StaleDetectorConfigSchema.parse({
      ...this.config,
      ...updates,
    });
  }

  getConfig(): StaleDetectorConfig {
    return { ...this.config };
  }
}

let instance: StaleDetector | null = null;

export function getStaleDetector(config?: Partial<StaleDetectorConfig>): StaleDetector {
  if (!instance) {
    instance = new StaleDetector(config);
  }
  return instance;
}

export function resetStaleDetector(): void {
  instance = null;
}