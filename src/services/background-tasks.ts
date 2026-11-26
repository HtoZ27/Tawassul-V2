export type BackgroundItem =
  | { kind: "codemode"; sessionID: string; jobID: string }
  | { kind: "shell"; sessionID: string; shellID: string; command: string }
  | {
      kind: "subagent";
      sessionID: string;
      childSessionID: string;
      agent: string;
      description: string;
    }
  | { kind: "image"; sessionID: string; path: string; model: string }
  | { kind: "video"; sessionID: string; path: string };

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function sanitizeBackgroundItems(items: readonly unknown[]): BackgroundItem[] {
  const out: BackgroundItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const sessionID = stringField(record, "sessionID");
    if (!sessionID) continue;
    switch (record.kind) {
      case "codemode": {
        const jobID = stringField(record, "jobID");
        if (jobID) out.push({ kind: "codemode", sessionID, jobID });
        break;
      }
      case "shell": {
        const shellID = stringField(record, "shellID");
        const command = stringField(record, "command");
        if (shellID && command) out.push({ kind: "shell", sessionID, shellID, command });
        break;
      }
      case "subagent": {
        const childSessionID = stringField(record, "childSessionID");
        const agent = stringField(record, "agent");
        const description = stringField(record, "description");
        if (childSessionID && agent && description) {
          out.push({ kind: "subagent", sessionID, childSessionID, agent, description });
        }
        break;
      }
      case "image": {
        const path = stringField(record, "path");
        const model = stringField(record, "model");
        if (path && model) out.push({ kind: "image", sessionID, path, model });
        break;
      }
      case "video": {
        const path = stringField(record, "path");
        if (path) out.push({ kind: "video", sessionID, path });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export type BackgroundSnapshot = {
  found: boolean;
  at: number;
  ageMs: number;
  stale: boolean;
  items: readonly BackgroundItem[];
};

export type BackgroundControl = {
  cancelSubagent: (childSessionID: string) => Promise<void>;
  reviveSubagent: (childSessionID: string, text: string) => Promise<void>;
};

export const BACKGROUND_SNAPSHOT_TTL_MS = 10 * 60_000;
export const MAX_SNAPSHOT_SESSIONS = 200;

const _snapshots = new Map<string, { at: number; items: BackgroundItem[] }>();
let _control: BackgroundControl | undefined;

export function recordBackgroundSnapshot(
  sessionID: string,
  items: readonly BackgroundItem[],
  now = Date.now(),
): void {
  if (!sessionID) return;
  const copy: BackgroundItem[] = [];
  for (const item of items) {
    if (item.kind === "subagent") {
      copy.push({
        kind: "subagent",
        sessionID: item.sessionID,
        childSessionID: item.childSessionID,
        agent: item.agent,
        description: item.description,
      });
    } else if (item.kind === "shell") {
      copy.push({
        kind: "shell",
        sessionID: item.sessionID,
        shellID: item.shellID,
        command: item.command,
      });
    } else if (item.kind === "codemode") {
      copy.push({ kind: "codemode", sessionID: item.sessionID, jobID: item.jobID });
    } else if (item.kind === "image") {
      copy.push({ kind: "image", sessionID: item.sessionID, path: item.path, model: item.model });
    } else {
      copy.push({ kind: "video", sessionID: item.sessionID, path: item.path });
    }
  }
  _snapshots.delete(sessionID);
  _snapshots.set(sessionID, { at: now, items: copy });
  if (_snapshots.size > MAX_SNAPSHOT_SESSIONS) {
    const oldest = _snapshots.keys().next().value;
    if (oldest !== undefined && oldest !== sessionID) _snapshots.delete(oldest);
  }
}

export function readBackgroundSnapshot(sessionID: string, now = Date.now()): BackgroundSnapshot {
  const entry = _snapshots.get(sessionID);
  if (!entry) {
    return { found: false, at: 0, ageMs: 0, stale: false, items: [] };
  }
  const ageMs = Math.max(0, now - entry.at);
  return {
    found: true,
    at: entry.at,
    ageMs,
    stale: ageMs > BACKGROUND_SNAPSHOT_TTL_MS,
    items: entry.items,
  };
}

export function installBackgroundControl(control: BackgroundControl): void {
  _control = control;
}

export function uninstallBackgroundControl(): void {
  _control = undefined;
}

export function backgroundControl(): BackgroundControl | undefined {
  return _control;
}

export function resetBackgroundState(): void {
  _snapshots.clear();
  _control = undefined;
}
