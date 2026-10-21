
const DEBUG = process.env.TAWASSUL_DEBUG === "1";
const JSON_LOG = process.env.TAWASSUL_LOG_JSON === "1";

type LogData = Record<string, unknown>;
type LogLevel = "debug" | "info" | "warn" | "error";

let _globalLevel: LogLevel = DEBUG ? "debug" : "info";
const _secrets: Set<string> = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "auth",
  "authorization",
  "api_key",
  "apikey",
  "private_key",
  "bearer",
  "session_id",
]);
const _REDACTED = "[REDACTED]";

function setLevel(level: LogLevel): void {
  _globalLevel = level;
}

function addSecret(key: string): void {
  if (key) _secrets.add(key.toLowerCase());
}

function removeSecret(key: string): void {
  if (key) _secrets.delete(key.toLowerCase());
}

function isSecretKey(key: string): boolean {
  const lk = key.toLowerCase();
  if (_secrets.has(lk)) return true;
  for (const s of _secrets) {
    if (s.length >= 3 && lk.includes(s)) return true;
  }
  return false;
}

function redact(data: LogData, depth = 0, seen: WeakSet<object> = new WeakSet()): LogData {
  if (_secrets.size === 0 || !data) return data;
  if (depth > 5) return _REDACTED as unknown as LogData;
  if (seen.has(data)) return "[Circular]" as unknown as LogData;
  seen.add(data);
  const out: LogData = {};
  for (const [k, v] of Object.entries(data)) {
    if (isSecretKey(k)) {
      out[k] = _REDACTED;
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redact(v as LogData, depth + 1, seen);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item !== null && typeof item === "object" ? redact(item as LogData, depth + 1, seen) : item,
      );
    } else {
      out[k] = v;
    }
  }
  seen.delete(data);
  return out;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[_globalLevel];
}

function formatEntry(level: string, msg: string, data?: LogData): string {
  const safe = data ? redact(data) : undefined;
  const stringify = (v: unknown): string => {
    try {
      return JSON.stringify(v);
    } catch {
      return '"[Unserializable]"';
    }
  };
  if (JSON_LOG) {
    return stringify({ ts: new Date().toISOString(), level, msg, ...safe });
  }
  const suffix = safe && Object.keys(safe).length > 0 ? " " + stringify(safe) : "";
  return `[tawassul] ${msg}${suffix}`;
}






import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const LOG_FILE_ENV = process.env.TAWASSUL_LOG_FILE;

function defaultLogPath(): string {
  const home = process.env.HOME ?? "";
  if (!home || home === "/") return "";
  return `${home}/.local/share/tawassul/tawassul.log`;
}
const LOG_FILE_PATH = LOG_FILE_ENV === undefined ? defaultLogPath() : LOG_FILE_ENV;




let _sinkDirReady = false;
let _sinkDead = false;
let _sinkConsecutiveFails = 0;





let _sinkQueue: Promise<void> = Promise.resolve();

function writeToSink(line: string): void {
  if (!LOG_FILE_PATH || _sinkDead) return;
  const stamped = `${new Date().toISOString()} ${line}`;
  _sinkQueue = _sinkQueue
    .then(async () => {
      if (!_sinkDirReady) {
        await mkdir(dirname(LOG_FILE_PATH), { recursive: true });
        _sinkDirReady = true;
      }
      await appendFile(LOG_FILE_PATH, stamped + "\n", "utf-8");
      _sinkConsecutiveFails = 0; 
    })
    .catch((e) => {
      _sinkConsecutiveFails++;
      if (_sinkConsecutiveFails >= 3) {
        _sinkDead = true;
        try {
          console.error(
            `[tawassul] log file sink disabled after 3 consecutive failures (${LOG_FILE_PATH}):`,
            e instanceof Error ? e.message : e,
          );
        } catch {
          void 0;
        }
      }
    });
}

export type LoggerInstance = {
  debug: (msg: string, data?: unknown) => void;
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
  child: (context: LogData) => LoggerInstance;
  audit: (event: string, details?: LogData) => void;
  addSecret: (key: string) => void;
  removeSecret: (key: string) => void;
};

const _console = {
  debug: (msg: string) => console.error(msg),
  info: (msg: string) => console.error(msg),
  warn: (msg: string) => console.error(msg),
  error: (msg: string) => console.error(msg),
};

function createLogger(context?: LogData): LoggerInstance {
  const ctx = context ?? {};

  const log = (level: LogLevel, msg: string, data?: unknown): void => {
    if (!shouldLog(level) && level !== "error") return;
    const extra =
      typeof data === "object" && data !== null && !Array.isArray(data)
        ? (data as LogData)
        : data !== undefined
          ? { detail: data }
          : undefined;
    const merged = { ...ctx, ...extra };
    const line = formatEntry(level, msg, merged);
    _console[level](line);
    writeToSink(line);
  };

  return {
    debug: (msg: string, data?: unknown) => log("debug", msg, data),
    info: (msg: string, data?: unknown) => log("info", msg, data),
    warn: (msg: string, data?: unknown) => log("warn", msg, data),
    error: (msg: string, data?: unknown) => log("error", msg, data),

    child: (childCtx: LogData): LoggerInstance => createLogger({ ...ctx, ...childCtx }),

    audit: (event: string, details?: LogData) => {
      const merged = { ...ctx, ...details };
      if (shouldLog("info")) {
        const line = formatEntry("audit", event, merged);
        _console.info(line);
        writeToSink(line);
      }
      const eh = _eventHub as { emit?: (name: string, data: unknown) => void } | undefined;
      eh?.emit?.("LOGGER_AUDIT", { event, ...merged });
    },

    addSecret,
    removeSecret,
  };
}

let _eventHub: unknown = null;
export function setEventHub(hub: unknown): void {
  _eventHub = hub;
}

export const logger: LoggerInstance & {
  setLevel: typeof setLevel;
  addSecret: typeof addSecret;
  removeSecret: typeof removeSecret;
} = Object.assign(createLogger(), {
  setLevel,
  addSecret,
  removeSecret,
});
