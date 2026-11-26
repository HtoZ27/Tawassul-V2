import { createReadStream, existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

type BootMarks = {
  dir: string;
  marks: Record<string, number>;
  shownAt?: number;
  serviceReadyAt?: number;
};

type Timing = {
  label: string;
  ms: number;
  bytes: number;
};

type Stats = {
  n: number;
  p50: number;
  p95: number;
  max: number;
};

type N2Record = {
  ts_ms?: number;
  session_id?: string | null;
  len?: number;
  process_start_ms?: number;
  since_init_ms?: number;
  role_gate?: boolean;
};

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function numericArg(name: string, fallback: number): number {
  const raw = argValue(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function stats(values: number[]): Stats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
}

function ms(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${value.toFixed(1)}ms`;
}

function bytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${value}B`;
}

function parseMarks(block: string): Record<string, number> {
  const marks: Record<string, number> = {};
  for (const match of block.matchAll(/([A-Za-z][A-Za-z0-9_]*):\s*(\d{10,})/g)) {
    const key = match[1];
    const value = Number(match[2]);
    if (key && Number.isFinite(value)) marks[key] = value;
  }
  return marks;
}

function desktopBoots(root: string, limit: number): BootMarks[] {
  if (!existsSync(root)) return [];
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const boots: BootMarks[] = [];
  for (const dir of dirs) {
    const file = join(root, dir, "main.log");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const start = text.indexOf("app starting");
    if (start < 0) continue;
    const body = text.slice(start);
    const marks = parseMarks(body);
    if (!marks.entry) continue;
    const layers = body.indexOf("layers ready");
    if (layers >= 0) Object.assign(marks, parseMarks(body.slice(layers)));
    const visible = body.match(/main window visible \{[\s\S]*?shownAt:\s*(\d{10,})/);
    const service = body.indexOf("v2 CLI background service ready", layers >= 0 ? layers : 0);
    let serviceReadyAt: number | undefined;
    if (service >= 0) {
      const lineStart = text.lastIndexOf("\n", service) + 1;
      const line = text.slice(lineStart, service);
      const stamp = line.match(/^\[([^\]]+)\]/);
      if (stamp?.[1]) {
        const parsed = Date.parse(stamp[1].replace(" ", "T"));
        if (Number.isFinite(parsed)) serviceReadyAt = parsed;
      }
    }
    boots.push({
      dir,
      marks,
      shownAt: visible?.[1] ? Number(visible[1]) : undefined,
      serviceReadyAt,
    });
    if (boots.length >= limit) break;
  }
  return boots;
}

async function eachLine(path: string, fn: (line: string) => void): Promise<void> {
  if (!existsSync(path)) return;
  const reader = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of reader) fn(line);
}

async function hostTimings(path: string, sinceMs: number): Promise<{
  pluginLoads: number;
  locationBoots: number[];
  sessionGets: Timing[];
}> {
  let pluginLoads = 0;
  const locationBoots: number[] = [];
  const sessionGets: Timing[] = [];
  const recent = (line: string): boolean => {
    if (sinceMs <= 0) return true;
    const stamp = line.match(/^timestamp=(\S+)/);
    if (!stamp?.[1]) return true;
    const parsed = Date.parse(stamp[1]);
    return !Number.isFinite(parsed) || parsed >= sinceMs;
  };
  await eachLine(path, (line) => {
    if (line.includes("loading plugin")) {
      if (recent(line)) pluginLoads += 1;
      return;
    }
    if (line.includes("location services booted")) {
      if (!recent(line)) return;
      const duration = line.match(/durationMs=(\d+)/);
      if (duration?.[1]) locationBoots.push(Number(duration[1]));
      return;
    }
    if (!line.includes("Sent HTTP response")) return;
    if (!recent(line)) return;
    const url = line.match(/http\.url=\/api\/session\/(ses_[A-Za-z0-9]+)(?:\s|$)/);
    if (!url?.[1]) return;
    const status = line.match(/http\.status=(\d+)/);
    if (status?.[1] !== "200") return;
    const span = line.match(/http\.span=(\d+)/);
    if (!span?.[1]) return;
    sessionGets.push({ label: url[1], ms: Number(span[1]), bytes: 0 });
  });
  return { pluginLoads, locationBoots, sessionGets };
}

type CleanupSummary = {
  gen: number;
  steps: number;
  done: number;
  abandoned: number;
  failed: number;
  maxMs: number;
  ms: number;
  cpuMs: number;
};

type SchemaRecord = {
  gen: number;
  reason: string;
  ms: number | null;
  tools: number;
  changed: boolean | null;
};

type SaveRecord = {
  gen: number;
  caller: string;
  outcome: string;
  dirty: boolean | null;
};

type DestroyRecord = {
  gen: number;
  dropped: number;
  handoffs: number;
  saves: number;
  ms: number;
  cpuMs: number;
};

function fields(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of line.matchAll(/([A-Za-z][A-Za-z0-9_-]*)=([^\s{}]+)/g)) {
    if (match[1] && match[2]) out[match[1]] = match[2];
  }
  return out;
}

function numeric(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function tawassulTimings(path: string, sinceMs: number): Promise<{
  init: number[];
  initSync: number[];
  initSyncByPid: Array<{ pid: number; ms: number }>;
  roster: number[];
  setup: Map<string, number[]>;
  cleanupDone: Map<string, number[]>;
  cleanupAbandoned: Map<string, number[]>;
  cleanupSummaries: CleanupSummary[];
  backgroundReady: number;
  moduleEvals: Map<number, number>;
  generationStarts: number;
  schemas: SchemaRecord[];
  saves: SaveRecord[];
  destroys: DestroyRecord[];
}> {
  const init: number[] = [];
  const initSync: number[] = [];
  const initSyncByPid: Array<{ pid: number; ms: number }> = [];
  const roster: number[] = [];
  const setup = new Map<string, number[]>();
  const cleanupDone = new Map<string, number[]>();
  const cleanupAbandoned = new Map<string, number[]>();
  const cleanupSummaries: CleanupSummary[] = [];
  const moduleEvals = new Map<number, number>();
  const schemas: SchemaRecord[] = [];
  const saves: SaveRecord[] = [];
  const destroys: DestroyRecord[] = [];
  let backgroundReady = 0;
  let generationStarts = 0;
  const recent = (line: string): boolean => {
    if (sinceMs <= 0) return true;
    const parsed = Date.parse(line.slice(0, 24));
    return !Number.isFinite(parsed) || parsed >= sinceMs;
  };
  const add = (map: Map<string, number[]>, key: string, value: number): void => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  await eachLine(path, (line) => {
    if (!recent(line)) return;
    if (line.includes("Background init completed successfully")) backgroundReady += 1;
    const initMatch = line.match(/initPlugin=([\d.]+)ms/);
    if (initMatch?.[1]) init.push(Number(initMatch[1]));
    const rosterMatch = line.match(/roster prewarm:.*elapsed=(\d+)ms/);
    if (rosterMatch?.[1]) roster.push(Number(rosterMatch[1]));
    const setupMatch = line.match(/v2 setup step ([a-zA-Z0-9._-]+) done in (\d+)ms/);
    if (setupMatch?.[1] && setupMatch[2]) add(setup, setupMatch[1], Number(setupMatch[2]));
    const cleanupMatch = line.match(/v2 cleanup step (.+?) (?:done in|failed in) ([\d.]+)ms/);
    if (cleanupMatch?.[1] && cleanupMatch[2]) add(cleanupDone, cleanupMatch[1], Number(cleanupMatch[2]));
    const abandonedMatch = line.match(/v2 cleanup step (.+?) abandoned after ([\d.]+)ms/);
    if (abandonedMatch?.[1] && abandonedMatch[2]) {
      add(cleanupAbandoned, abandonedMatch[1], Number(abandonedMatch[2]));
    }
    if (line.includes("v2 module eval pid=")) {
      const pid = numeric(fields(line).pid);
      if (pid !== null) moduleEvals.set(pid, (moduleEvals.get(pid) ?? 0) + 1);
    }
    if (line.includes("v2 init sync gen=")) {
      const f = fields(line);
      const ms = numeric(f.ms);
      const pid = numeric(f.pid);
      if (ms !== null) initSync.push(ms);
      if (ms !== null && pid !== null) initSyncByPid.push({ pid, ms });
    }
    if (line.includes("v2 setup gen=") && line.includes(" start")) generationStarts += 1;
    if (line.includes("v2 cleanup gen=") && line.includes("steps=")) {
      const f = fields(line);
      const gen = numeric(f.gen);
      const steps = numeric(f.steps);
      if (gen !== null && steps !== null) {
        cleanupSummaries.push({
          gen,
          steps,
          done: numeric(f.done) ?? 0,
          abandoned: numeric(f.abandoned) ?? 0,
          failed: numeric(f.failed) ?? 0,
          maxMs: numeric(f.maxMs) ?? 0,
          ms: numeric(f.ms) ?? 0,
          cpuMs: numeric(f.cpuMs) ?? 0,
        });
      }
    }
    if (line.includes("v2 schema gen=")) {
      const f = fields(line);
      const gen = numeric(f.gen);
      if (gen !== null) {
        schemas.push({
          gen,
          reason: f.reason ?? "unknown",
          ms: numeric(f.ms),
          tools: numeric(f.tools) ?? 0,
          changed: f.changed === undefined ? null : f.changed === "true",
        });
      }
    }
    if (line.includes("v2 save gen=")) {
      const f = fields(line);
      const gen = numeric(f.gen);
      if (gen !== null) {
        saves.push({
          gen,
          caller: f.caller ?? "unknown",
          outcome: f.outcome ?? "unknown",
          dirty: f.dirty === undefined ? null : f.dirty === "true",
        });
      }
    }
    if (line.includes("v2 destroy gen=")) {
      const f = fields(line);
      const gen = numeric(f.gen);
      if (gen !== null) {
        destroys.push({
          gen,
          dropped: numeric(f.dropped) ?? 0,
          handoffs: numeric(f.handoffs) ?? 0,
          saves: numeric(f.saves) ?? 0,
          ms: numeric(f.ms) ?? 0,
          cpuMs: numeric(f.cpuMs) ?? 0,
        });
      }
    }
  });
  return {
    init,
    initSync,
    initSyncByPid,
    roster,
    setup,
    cleanupDone,
    cleanupAbandoned,
    cleanupSummaries,
    backgroundReady,
    moduleEvals,
    generationStarts,
    schemas,
    saves,
    destroys,
  };
}

function n2FirstText(path: string, sinceMs: number): {
  firstByProcess: number[];
  sessions: Set<string>;
  records: number;
} {
  const firstByProcess = new Map<number, number>();
  const sessions = new Set<string>();
  let records = 0;
  if (!existsSync(path)) return { firstByProcess: [], sessions, records };
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    let rec: N2Record;
    try {
      rec = JSON.parse(raw) as N2Record;
    } catch {
      continue;
    }
    if (rec.role_gate !== true) continue;
    if (typeof rec.len !== "number" || rec.len <= 0) continue;
    if (typeof rec.ts_ms !== "number" || rec.ts_ms < sinceMs) continue;
    if (typeof rec.process_start_ms !== "number") continue;
    records += 1;
    if (rec.session_id) sessions.add(rec.session_id);
    const previous = firstByProcess.get(rec.process_start_ms);
    if (previous === undefined || rec.ts_ms < previous) firstByProcess.set(rec.process_start_ms, rec.ts_ms);
  }
  const values: number[] = [];
  for (const [processStart, firstTs] of firstByProcess) values.push(Math.max(0, firstTs - processStart));
  return { firstByProcess: values, sessions, records };
}

async function readService(): Promise<{ url: string; password: string } | null> {
  const candidates = [
    join(homedir(), ".local", "state", "opencode", "service.json"),
    join(homedir(), ".config", "opencode", "service.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { url?: string; password?: string };
      if (parsed.url && parsed.password) return { url: parsed.url, password: parsed.password };
    } catch {
      continue;
    }
  }
  return null;
}

async function apiGet(
  base: string,
  password: string,
  path: string,
): Promise<{ ms: number; bytes: number; json: unknown }> {
  const auth = Buffer.from(`opencode:${password}`, "utf8").toString("base64");
  const started = performance.now();
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  const elapsed = performance.now() - started;
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
  return { ms: elapsed, bytes: Buffer.byteLength(body, "utf8"), json: JSON.parse(body) as unknown };
}

type SessionRow = {
  id?: string;
  title?: string;
  time?: { updated?: number };
};

async function liveSessionTimings(
  service: { url: string; password: string },
  limit: number,
): Promise<{
  listCold: Timing;
  listWarm: Timing;
  metadata: Timing[];
  messages: Timing[];
  total: Timing[];
}> {
  const listCold = await apiGet(service.url, service.password, "/api/session");
  const listWarm = await apiGet(service.url, service.password, "/api/session");
  const rows = (listWarm.json as { data?: SessionRow[] }).data ?? [];
  const selected = rows
    .filter((row) => typeof row.id === "string")
    .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
    .slice(0, limit);
  const metadata: Timing[] = [];
  const messages: Timing[] = [];
  const total: Timing[] = [];
  for (const row of selected) {
    const id = row.id as string;
    const meta = await apiGet(service.url, service.password, `/api/session/${encodeURIComponent(id)}`);
    metadata.push({ label: id, ms: meta.ms, bytes: meta.bytes });
    const message = await apiGet(service.url, service.password, `/api/session/${encodeURIComponent(id)}/message`);
    messages.push({ label: id, ms: message.ms, bytes: message.bytes });
    total.push({ label: id, ms: meta.ms + message.ms, bytes: meta.bytes + message.bytes });
  }
  return {
    listCold: { label: "session list (cold)", ms: listCold.ms, bytes: listCold.bytes },
    listWarm: { label: "session list (warm)", ms: listWarm.ms, bytes: listWarm.bytes },
    metadata,
    messages,
    total,
  };
}

function printStats(label: string, values: number[]): void {
  const summary = stats(values);
  if (!summary) {
    console.log(`${label}: no samples`);
    return;
  }
  const p95 = summary.n >= 20 ? ms(summary.p95) : "n/a (n<20)";
  console.log(`${label}: n=${summary.n} p50=${ms(summary.p50)} p95=${p95} max=${ms(summary.max)}`);
}

function printTiming(label: string, timings: Timing[]): void {
  if (timings.length === 0) {
    console.log(`${label}: no samples`);
    return;
  }
  printStats(label, timings.map((timing) => timing.ms));
  const total = timings.reduce((sum, timing) => sum + timing.bytes, 0);
  console.log(`${label} bytes: total=${bytes(total)} mean=${bytes(total / timings.length)}`);
}

async function main(): Promise<void> {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(
      [
        "Usage: bun scripts/measure-boot-sessions.ts [options]",
        "",
        "  --boots N            Desktop boot logs to include (default 10)",
        "  --sessions N         Live sessions to open and time (default 10)",
        "  --since DAYS         Log window in days; 0 disables the filter (default 30)",
        "  --host-pids LIST     Comma-separated host pids for a host-only init-sync summary",
        "  --n2-window-ms N     First-text window after plugin start (default 120000)",
        "  --no-api             Skip the live sidecar session-open measurement",
        "  --json               Print one JSON document",
        "  --desktop-logs PATH  Desktop log root",
        "  --host-log PATH      opencode.log path",
        "  --tawassul-log PATH  Tawassul log path",
        "  --n2-log PATH        n2-auto.jsonl path",
      ].join("\n"),
    );
    return;
  }
  const jsonOut = hasFlag("--json");
  const bootsLimit = numericArg("--boots", 10);
  const sessionsLimit = numericArg("--sessions", 10);
  const sinceRaw = argValue("--since");
  const sinceDays = sinceRaw === undefined ? 30 : Number(sinceRaw);
  const hostPids = new Set(
    (argValue("--host-pids") ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
  );
  const n2WindowMs = numericArg("--n2-window-ms", 120000);
  const sinceMs = Number.isFinite(sinceDays) && sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;
  const desktopRoot =
    argValue("--desktop-logs") ?? join(homedir(), ".config", "ai.opencode.desktop", "logs");
  const hostLog =
    argValue("--host-log") ?? join(homedir(), ".local", "share", "opencode", "log", "opencode.log");
  const tawassulLog =
    argValue("--tawassul-log") ??
    join(homedir(), ".local", "share", "tawassul-v2", "tawassul", "tawassul.log");
  const n2Log =
    argValue("--n2-log") ?? join(homedir(), ".local", "share", "tawassul-v2", "n2-auto.jsonl");

  const boots = desktopBoots(desktopRoot, bootsLimit);
  const bootRows = boots.map((boot) => {
    const base = boot.marks.entry ?? 0;
    const delta = (key: string): number | null => {
      const value = boot.marks[key];
      return typeof value === "number" ? value - base : null;
    };
    return {
      dir: boot.dir,
      entry: base,
      ready: delta("ready"),
      window: delta("window"),
      served: delta("served"),
      bundle: delta("bundle"),
      logging: delta("logging"),
      storage: delta("storage"),
      init: delta("init"),
      layers: delta("layers"),
      visible: boot.shownAt ? boot.shownAt - base : null,
      service: boot.serviceReadyAt ? boot.serviceReadyAt - base : null,
    };
  });

  const host = await hostTimings(hostLog, sinceMs);
  const tawassul = await tawassulTimings(tawassulLog, sinceMs);
  const hostInitSync =
    hostPids.size === 0
      ? []
      : tawassul.initSyncByPid.filter((row) => hostPids.has(row.pid)).map((row) => row.ms);
  const hostPidList = [...hostPids].sort((a, b) => a - b);
  const n2 = n2FirstText(n2Log, sinceMs);
  const n2Window = n2.firstByProcess.filter((value) => value <= n2WindowMs);

  let live: Awaited<ReturnType<typeof liveSessionTimings>> | null = null;
  let liveNote = "";
  if (!hasFlag("--no-api")) {
    const service = await readService();
    if (service) {
      try {
        live = await liveSessionTimings(service, sessionsLimit);
      } catch (error) {
        liveNote = `live API unavailable: ${String((error as Error)?.message ?? error)}`;
      }
    } else {
      liveNote = "live API skipped: no service.json with url/password";
    }
  }

  const setupRows = [...tawassul.setup.entries()]
    .map(([label, values]) => ({ label, summary: stats(values) }))
    .filter((row): row is { label: string; summary: Stats } => row.summary !== null)
    .sort((a, b) => b.summary.p95 - a.summary.p95);
  const cleanupDoneRows = [...tawassul.cleanupDone.entries()]
    .map(([label, values]) => ({ label, summary: stats(values) }))
    .filter((row): row is { label: string; summary: Stats } => row.summary !== null)
    .sort((a, b) => b.summary.p95 - a.summary.p95);
  const cleanupAbandonedRows = [...tawassul.cleanupAbandoned.entries()]
    .map(([label, values]) => ({ label, summary: stats(values) }))
    .filter((row): row is { label: string; summary: Stats } => row.summary !== null)
    .sort((a, b) => b.summary.p95 - a.summary.p95);
  const saveCounts = new Map<string, number>();
  for (const record of tawassul.saves) {
    const key = `${record.caller}/${record.outcome}`;
    saveCounts.set(key, (saveCounts.get(key) ?? 0) + 1);
  }
  const schemaCounts = new Map<string, number>();
  for (const record of tawassul.schemas) {
    schemaCounts.set(record.reason, (schemaCounts.get(record.reason) ?? 0) + 1);
  }

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          appBoot: {
            boots: bootRows,
            ready: stats(bootRows.flatMap((row) => (row.ready === null ? [] : [row.ready]))),
            visible: stats(bootRows.flatMap((row) => (row.visible === null ? [] : [row.visible]))),
            layers: stats(bootRows.flatMap((row) => (row.layers === null ? [] : [row.layers]))),
            service: stats(bootRows.flatMap((row) => (row.service === null ? [] : [row.service]))),
          },
          pluginBoot: {
            initPlugin: stats(tawassul.init),
            initSync: stats(tawassul.initSync),
            initSyncHostOnly: stats(hostInitSync),
            hostPids: hostPidList,
            rosterPrewarm: stats(tawassul.roster),
            backgroundReady: tawassul.backgroundReady,
            generations: {
              starts: tawassul.generationStarts,
              moduleEvals: [...tawassul.moduleEvals.entries()].map(([pid, count]) => ({ pid, count })),
            },
            hostPluginLoads: host.pluginLoads,
            locationServicesBooted: stats(host.locationBoots),
            setup: setupRows.map((row) => ({ label: row.label, ...row.summary })),
            cleanup: {
              done: cleanupDoneRows.map((row) => ({ label: row.label, ...row.summary })),
              abandoned: cleanupAbandonedRows.map((row) => ({ label: row.label, ...row.summary })),
              summaries: tawassul.cleanupSummaries,
            },
            schema: {
              byReason: Object.fromEntries(schemaCounts),
              collections: tawassul.schemas,
            },
            saves: {
              byCallerOutcome: Object.fromEntries(saveCounts),
              records: tawassul.saves,
            },
            destroys: tawassul.destroys,
          },
          sessionOpen: {
            liveListCold: live?.listCold ?? null,
            liveListWarm: live?.listWarm ?? null,
            liveMetadata: live ? stats(live.metadata.map((row) => row.ms)) : null,
            liveMessages: live ? stats(live.messages.map((row) => row.ms)) : null,
            liveTotal: live ? stats(live.total.map((row) => row.ms)) : null,
            historicalSessionGets: stats(host.sessionGets.map((row) => row.ms)),
            firstTextSincePluginStart: stats(n2.firstByProcess),
            firstTextWithinWindow: stats(n2Window),
            firstTextWindowMs: n2WindowMs,
            firstTextWithin15s: n2Window.filter((value) => value <= 15000).length,
            firstTextSamples: n2.firstByProcess.length,
            n2Records: n2.records,
            n2Sessions: n2.sessions.size,
            note: liveNote || undefined,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("== App boot (Desktop main.log marks) ==");
  if (bootRows.length === 0) {
    console.log(`no boot marks under ${desktopRoot}`);
  } else {
    for (const row of bootRows) {
      console.log(
        `${row.dir}  ready=${ms(row.ready)} window=${ms(row.window)} served=${ms(row.served)} ` +
          `bundle=${ms(row.bundle)} logging=${ms(row.logging)} init=${ms(row.init)} ` +
          `layers=${ms(row.layers)} visible=${ms(row.visible)} service=${ms(row.service)}`,
      );
    }
    printStats("entry->ready", bootRows.flatMap((row) => (row.ready === null ? [] : [row.ready])));
    printStats("entry->layers", bootRows.flatMap((row) => (row.layers === null ? [] : [row.layers])));
    printStats("entry->visible", bootRows.flatMap((row) => (row.visible === null ? [] : [row.visible])));
    printStats("entry->service", bootRows.flatMap((row) => (row.service === null ? [] : [row.service])));
  }

  console.log("");
  console.log("== Plugin boot (Tawassul + host logs) ==");
  printStats("initPlugin (legacy perf line)", tawassul.init);
  printStats("init sync (per generation)", tawassul.initSync);
  if (hostPids.size > 0) {
    printStats(`init sync host-only (pids=${hostPidList.join(",")})`, hostInitSync);
  }
  printStats("roster prewarm", tawassul.roster);
  console.log(`host plugin loads: ${host.pluginLoads}`);
  printStats("location services booted", host.locationBoots);
  console.log(`background init completed: ${tawassul.backgroundReady}`);
  console.log(`generations started: ${tawassul.generationStarts}`);
  if (tawassul.moduleEvals.size > 0) {
    const rows = [...tawassul.moduleEvals.entries()].map(([pid, count]) => `${pid}:${count}`);
    console.log(`module evaluations by pid: ${rows.join(", ")}`);
  }
  if (setupRows.length > 0) {
    console.log("setup steps by p95:");
    for (const row of setupRows.slice(0, 8)) {
      console.log(`  ${row.label}: n=${row.summary.n} p50=${ms(row.summary.p50)} max=${ms(row.summary.max)}`);
    }
  }
  if (cleanupDoneRows.length > 0) {
    console.log("cleanup steps done by p95:");
    for (const row of cleanupDoneRows.slice(0, 8)) {
      console.log(`  ${row.label}: n=${row.summary.n} p50=${ms(row.summary.p50)} max=${ms(row.summary.max)}`);
    }
  }
  if (cleanupAbandonedRows.length > 0) {
    console.log("cleanup steps abandoned:");
    for (const row of cleanupAbandonedRows) {
      console.log(`  ${row.label}: n=${row.summary.n} p50=${ms(row.summary.p50)} max=${ms(row.summary.max)}`);
    }
  }
  if (tawassul.cleanupSummaries.length > 0) {
    console.log("cleanup generation summaries:");
    for (const row of tawassul.cleanupSummaries.slice(-5)) {
      console.log(
        `  gen=${row.gen} steps=${row.steps} done=${row.done} abandoned=${row.abandoned} failed=${row.failed} ` +
          `maxMs=${ms(row.maxMs)} ms=${ms(row.ms)} cpuMs=${ms(row.cpuMs)}`,
      );
    }
  }
  if (tawassul.schemas.length > 0) {
    const reasons = [...schemaCounts.entries()].map(([reason, count]) => `${reason}:${count}`).join(", ");
    console.log(`schema collections: total=${tawassul.schemas.length} (${reasons})`);
    const durations = tawassul.schemas.flatMap((row) => (row.ms === null ? [] : [row.ms]));
    printStats("schema collection duration", durations);
  }
  if (tawassul.saves.length > 0) {
    const counts = [...saveCounts.entries()].map(([key, count]) => `${key}:${count}`).join(", ");
    console.log(`state saves: ${counts}`);
  }
  if (tawassul.destroys.length > 0) {
    printStats("destroy duration", tawassul.destroys.map((row) => row.ms));
    printStats("destroy cpu", tawassul.destroys.map((row) => row.cpuMs));
    console.log(`destroy dropped-handoff counts: ${tawassul.destroys.map((row) => row.dropped).join(",")}`);
    console.log(`destroy save counts: ${tawassul.destroys.map((row) => row.saves).join(",")}`);
  }

  console.log("");
  console.log("== Session open (live sidecar API) ==");
  if (!live) {
    console.log(liveNote || "live API skipped");
  } else {
    console.log(`session list cold: ${ms(live.listCold.ms)} (${bytes(live.listCold.bytes)})`);
    console.log(`session list warm: ${ms(live.listWarm.ms)} (${bytes(live.listWarm.bytes)})`);
    printTiming("session metadata", live.metadata);
    printTiming("session messages", live.messages);
    printTiming("session open total", live.total);
  }

  console.log("");
  console.log("== Session first output (n2-auto.jsonl) ==");
  console.log(`records=${n2.records} sessions=${n2.sessions.size} samples=${n2.firstByProcess.length}`);
  printStats("plugin start -> first visible text (all)", n2.firstByProcess);
  printStats(`plugin start -> first visible text (<=${Math.round(n2WindowMs / 1000)}s)`, n2Window);
  console.log(
    `within 15s in window: ${n2Window.filter((value) => value <= 15000).length}/${n2Window.length}`,
  );
  if (host.sessionGets.length > 0) {
    printStats("historical GET /api/session/:id (200)", host.sessionGets.map((row) => row.ms));
  }
}

await main();
