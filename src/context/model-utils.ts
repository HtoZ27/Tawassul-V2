import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { logger } from "../utils/logger.ts";
import { globalConfigDir } from "../utils/path-resolver.ts";

let cachedPort: number | null = null;
let cachedPortTs = 0;
let cachedHost = "localhost";
const PORT_CACHE_TTL_MS = 300_000;

function setCachedPort(p: number, host = "localhost"): number {
  cachedPort = p;
  cachedPortTs = Date.now();
  cachedHost = host;
  return p;
}

let portCacheGen = 0;

export function getPortCacheGen(): number {
  return portCacheGen;
}

export function invalidatePortCache(): void {
  cachedPort = null;
  cachedPortTs = 0;
  cachedHost = "localhost";
  portCacheGen++;
}

async function probePort(port: number, host = "localhost"): Promise<boolean> {
  const paths = ["/global/health", "/health"];
  const results = await Promise.allSettled(
    paths.map(async (path) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 400);
      try {
        const resp = await fetch(`http://${host}:${port}${path}`, {
          signal: controller.signal,
          method: "HEAD",
        });
        return resp.ok || resp.status === 401;
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    }),
  );
  return results.some((r) => r.status === "fulfilled" && r.value);
}

async function detectOpenCodePort(serverUrl?: string): Promise<number> {
  if (cachedPort !== null && Date.now() - cachedPortTs < PORT_CACHE_TTL_MS) return cachedPort;

  let host = "localhost";

  if (serverUrl) {
    try {
      const url = new URL(serverUrl);
      const p = Number(url.port);
      host = url.hostname;
      if (Number.isInteger(p) && p > 0 && p < 65536) {
        return setCachedPort(p, host);
      }
    } catch (urlErr) {
      logger.debug("[tawassul] detectOpenCodePort: skipping unparseable URL", urlErr);
    }
  }

  const envPort = process.env.OPENCODE_SERVER_PORT || process.env.OPENCODE_PORT;
  if (envPort) {
    const parsed = Number(envPort);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
      return setCachedPort(parsed, host);
    }
  }

  try {
    const infoPath = resolve(globalConfigDir(), "opencode.json");
    if (existsSync(infoPath)) {
      const content = await readFile(infoPath, "utf-8");
      const info = JSON.parse(content);
      if (typeof info.port === "number" && Number.isFinite(info.port)) {
        return setCachedPort(info.port, host);
      }
    }
  } catch (e) {
    logger.debug("Failed to read port from opencode.json:", e);
  }

  const candidates = new Set<number>([4096, 3000, 8080, 4000, 5000]);
  const MAX_EXTRA_CANDIDATES = 15;
  const collectListeningPorts = async (cmd: string, args: string[], signal?: AbortSignal): Promise<void> => {
    try {
      const { stdout } = await execFileAsync(cmd, args, { encoding: "utf8", timeout: 3000, signal });
      for (const line of stdout.split("\n")) {
        if (candidates.size - 5 >= MAX_EXTRA_CANDIDATES) break;
        const m = line.match(/:(\d+)\s/);
        if (m?.[1]) {
          const p = parseInt(m[1], 10);
          if (p > 0 && p < 65536) candidates.add(p);
        }
      }
    } catch (e) {
      logger.debug(`${cmd} failed:`, e);
    }
  };
  const networkProbeSignal = AbortSignal.timeout(5000);
  await Promise.allSettled([
    collectListeningPorts("ss", ["-tln"], networkProbeSignal),
    collectListeningPorts("netstat", ["-tuln"], networkProbeSignal),
  ]);

  const probeResults = await Promise.allSettled(
    [...candidates].map(async (port) => {
      const ok = await probePort(port, host);
      return { port, ok };
    }),
  );
  const commonPorts = [4096, 3000, 8080, 4000, 5000];
  for (const r of probeResults) {
    if (r.status === "fulfilled" && r.value.ok && commonPorts.includes(r.value.port)) {
      return setCachedPort(r.value.port, host);
    }
  }
  for (const r of probeResults) {
    if (r.status === "fulfilled" && r.value.ok && !commonPorts.includes(r.value.port)) {
      return setCachedPort(r.value.port, host);
    }
  }

  return setCachedPort(4096, host);
}

export function getDefaultFreeModels(): Array<{ id: string; name: string; provider: string }> {
  return [
    { id: "opencode/big-pickle", name: "Big Pickle", provider: "opencode" },
    { id: "opencode/mimo-v2.6-flash-free", name: "MiMo V2.6 Flash Free", provider: "opencode" },
    { id: "nvidia/deepseek-ai/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash (NVIDIA)", provider: "nvidia" },
    { id: "nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b", name: "Nemotron 3.5 Super VL (NVIDIA)", provider: "nvidia" },
  ];
}

function addFromRecord(
  record: Record<string, string | { model: string; error: string }> | undefined,
  label: string,
  targetArray: Array<{ id: string; name: string; source: string; error?: string; provider?: string }>,
  removeFromArray?: Array<{ id: string; name: string; source: string; provider?: string }>,
): void {
  if (!record) return;
  for (const value of Object.values(record)) {
    if (typeof value === "object" && value !== null) {
      const failure = value as { model: string; error: string };
      const sourceArr = removeFromArray ?? targetArray;
      const idx = sourceArr.findIndex((m) => m.id === failure.model);
      if (idx !== -1) {
        const [removed] = sourceArr.splice(idx, 1);
        if (sourceArr !== targetArray) {
          targetArray.push({ ...removed!, error: failure.error });
        }
      }
    } else if (typeof value === "string") {
      const modelId = value;
      if (!targetArray.find((m) => m.id === modelId)) {
        targetArray.push({ id: modelId, name: modelId, source: label });
      }
    }
  }
}

export interface ModelSources {
  agentModelMap?: Record<string, string>;
  modelChoices?: Record<string, string>;
  failedModels?: Record<string, { model: string; error: string; failedAt: string }>;
}

export interface FetchResult {
  available: Array<{ id: string; name: string; source: string }>;
  needsSetup: Array<{ id: string; name: string; provider: string }>;
  failed: Array<{ id: string; name: string; source: string; error?: string; provider?: string }>;
  defaults: Record<string, string>;
  serverReachable: boolean;
}

export async function fetchAllAvailableModels(
  sources: ModelSources,
  serverUrl?: string,
  externalSignal?: AbortSignal,
): Promise<FetchResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    let response: Response;
    try {
      const port = await detectOpenCodePort(serverUrl);
      const headers: Record<string, string> = { Accept: "application/json" };
      const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
      const password = process.env.OPENCODE_SERVER_PASSWORD;
      if (password) {
        headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      }
      response = await fetch(`http://${cachedHost}:${port}/provider`, {
        signal: controller.signal,
        headers,
      });
    } finally {
      clearTimeout(timeout);
    }
    const parseReject: { reject: ((e: Error) => void) | null } = { reject: null };
    const parseDeadline = setTimeout(() => {
      parseReject.reject?.(new Error("JSON parse timeout"));
    }, 5000);
    if (parseDeadline?.unref) parseDeadline.unref();
    const data = await Promise.race([
      response.json(),
      new Promise<never>((_, reject) => {
        parseReject.reject = reject;
      }),
    ])
      .catch((e) => {
        response.body?.cancel?.().catch(() => {});
        throw e;
      })
      .finally(() => {
        clearTimeout(parseDeadline);
      }) as {
      all?: Array<{
        id: string;
        models?: Record<string, unknown>;
      }>;
      connected?: string[];
      default?: Record<string, string>;
    };

    const available: Array<{ id: string; name: string; source: string }> = [];
    const needsSetup: Array<{ id: string; name: string; provider: string }> = [];

    if (data.all) {
      for (const provider of data.all) {
        const isConnected = data.connected?.includes(provider.id) ?? false;
        if (provider.models) {
          for (const [modelId, model] of Object.entries(provider.models)) {
            const modelObj =
              typeof model === "object" && model !== null ? (model as Record<string, unknown>) : undefined;
            const entry = {
              id: `${provider.id}/${modelId}`,
              name: (modelObj?.name as string) || modelId,
              provider: provider.id,
            };
            if (provider.id === "opencode") {
              available.push({ ...entry, source: "free" });
            } else if (isConnected) {
              available.push({ ...entry, source: "connected provider" });
            } else {
              needsSetup.push(entry);
            }
          }
        }
      }
    }

    addFromRecord(sources.agentModelMap, "previously succeeded", available);
    addFromRecord(sources.modelChoices, "user preference", available);

    const failed: Array<{ id: string; name: string; source: string; error?: string; provider?: string }> = [];
    addFromRecord(sources.failedModels, "failed", failed, available);

    return { available, needsSetup, failed, defaults: data.default ?? {}, serverReachable: true };
  } catch (e) {
    const externallyAborted = externalSignal?.aborted === true;
    if (externallyAborted) {
      logger.debug("[tawassul] model fetch aborted by caller timeout — defaults served, port cache kept");
    } else {
      logger.warn("Could not reach local server — using default models only:", e);
      invalidatePortCache();
    }
    const available = getDefaultFreeModels().map((m) => ({ ...m, source: "free" }));
    addFromRecord(sources.agentModelMap, "previously succeeded", available);
    addFromRecord(sources.modelChoices, "user preference", available);
    const failed: Array<{ id: string; name: string; source: string; error?: string; provider?: string }> = [];
    addFromRecord(sources.failedModels, "failed", failed, available);
    return { available, needsSetup: [], failed, defaults: {}, serverReachable: false };
  }
}
