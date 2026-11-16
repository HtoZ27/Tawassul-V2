export type BackgroundItem =
  | { kind: "shell"; sessionID: string; shellID: string; command: string }
  | {
      kind: "subagent";
      sessionID: string;
      childSessionID: string;
      agent: string;
      description: string;
    }
  | { kind: "image"; sessionID: string; path: string; model: string };

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
    } else {
      copy.push({ kind: "image", sessionID: item.sessionID, path: item.path, model: item.model });
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
