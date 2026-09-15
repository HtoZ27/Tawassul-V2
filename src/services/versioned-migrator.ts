import { t } from "../translations.ts";

export interface MigrationStep {
  version: number;
  description: string;
  migrate: (data: Record<string, unknown>) => Record<string, unknown>;
  rollback: (data: Record<string, unknown>) => Record<string, unknown>;
}

export interface MigrationResult {
  success: boolean;
  fromVersion: number;
  toVersion: number;
  error?: string;
  dryRun?: boolean;
}

export class VersionedMigrator {
  private steps: MigrationStep[] = [];

  register(step: MigrationStep): void {
    this.steps.push(step);
    this.steps.sort((a, b) => a.version - b.version);
    for (let i = 0; i < this.steps.length - 1; i++) {
      if (this.steps[i]!.version >= this.steps[i + 1]!.version) {
        throw new Error(
          t("vmVersionOrder", { a: String(this.steps[i]!.version), b: String(this.steps[i + 1]!.version) }),
        );
      }
    }
  }

  migrate(data: Record<string, unknown>, targetVersion: number, dryRun = false): MigrationResult {
    const currentVersion = (data._version as number) ?? 0;
    if (currentVersion >= targetVersion) {
      return { success: true, fromVersion: currentVersion, toVersion: currentVersion };
    }

    if (currentVersion > 0 && (data._checksum as string) !== this.checksum(data)) {
      return {
        success: false,
        fromVersion: currentVersion,
        toVersion: currentVersion,
        error: t("vmChecksum"),
      };
    }

    let current: Record<string, unknown> = { ...data };
    for (const step of this.steps) {
      if (step.version > currentVersion && step.version <= targetVersion) {
        try {
          current = step.migrate(current);
          current._version = step.version;
          current._checksum = this.checksum(current);
        } catch (err) {
          return { success: false, fromVersion: currentVersion, toVersion: currentVersion, error: String(err) };
        }
      }
    }

    if (dryRun && currentVersion > 0) {
      return { success: true, fromVersion: currentVersion, toVersion: targetVersion, dryRun: true };
    }

    return { success: true, fromVersion: currentVersion, toVersion: targetVersion };
  }

  rollback(data: Record<string, unknown>, targetVersion: number, dryRun = false): MigrationResult {
    const currentVersion = (data._version as number) ?? 0;
    if (currentVersion <= targetVersion) {
      return { success: true, fromVersion: currentVersion, toVersion: currentVersion };
    }

    let current: Record<string, unknown> = { ...data };
    const reverseSteps = [...this.steps].reverse();
    for (const step of reverseSteps) {
      if (step.version <= currentVersion && step.version > targetVersion) {
        try {
          current = step.rollback(current);
          current._version = step.version - 1;
          if ((current._version as number) > 0) current._checksum = this.checksum(current);
        } catch (err) {
          return { success: false, fromVersion: currentVersion, toVersion: currentVersion, error: String(err) };
        }
      }
    }

    if (dryRun) {
      return { success: true, fromVersion: currentVersion, toVersion: targetVersion, dryRun: true };
    }

    return { success: true, fromVersion: currentVersion, toVersion: targetVersion };
  }

  private checksum(data: Record<string, unknown>): string {
    const rest = { ...data };
    delete rest._checksum;
    let hash = 0;
    const str = JSON.stringify(rest);
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash.toString(36);
  }
}
