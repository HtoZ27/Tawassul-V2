import type { ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveSafePath } from "../utils/path.ts";
import { homedir } from "node:os";
import { withTimeout } from "../utils/with-timeout.ts";
import { getSecret } from "../services/keyring.ts";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const CODEX_REQUEST_TIMEOUT_MS = 60_000;
const TOKEN_REFRESH_BUFFER_MS = 60_000;

let cachedAccessToken: string | null = null;

function codexResponsesUrl(baseUrl: string | undefined): string {
  const raw = (baseUrl || DEFAULT_CODEX_BASE_URL).trim().replace(/\/+$/, "");
  if (raw.endsWith("/codex/responses")) return raw;
  if (raw.endsWith("/codex")) return `${raw}/responses`;
  return `${raw}/codex/responses`;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const normalized = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function extractAccountId(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  const authSection = payload?.["https://api.openai.com/auth"] as { chatgpt_account_id?: string } | undefined;
  return authSection?.chatgpt_account_id;
}

function shouldRefreshToken(exp: number): boolean {
  return Date.now() > exp * 1000 - TOKEN_REFRESH_BUFFER_MS;
}

async function refreshAndUpdateToken(): Promise<string> {
  const refreshToken = await getSecret("OPENAI_CODEX_REFRESH_TOKEN");
  if (!refreshToken) {
    throw new Error(
      "OPENAI_CODEX_ACCESS_TOKEN expired — renew it (or set OPENAI_CODEX_REFRESH_TOKEN for auto-refresh)",
    );
  }
  const base = (process.env.PI_IMAGE_GEN_BASE_URL || DEFAULT_CODEX_BASE_URL).trim().replace(/\/+$/, "");
  const response = await fetch(`${base}/token/refresh`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      originator: "tawassul-image-gen",
      "User-Agent": "tawassul-image-gen/1.0",
      "OpenAI-Beta": "responses=experimental",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    throw new Error("OPENAI_CODEX_ACCESS_TOKEN expired and refresh failed — renew it");
  }
  const payload: unknown = await response.json().catch(() => null);
  const accessToken = (payload as { access_token?: string } | null)?.access_token;
  if (!accessToken) {
    throw new Error("OPENAI_CODEX_ACCESS_TOKEN expired and refresh returned no token — renew it");
  }
  cachedAccessToken = accessToken;
  return accessToken;
}

async function currentAccessToken(): Promise<string> {
  const token = cachedAccessToken || process.env.OPENAI_CODEX_ACCESS_TOKEN || process.env.PI_OPENAI_CODEX_ACCESS_TOKEN;
  if (!token) throw new Error("Missing OPENAI_CODEX_ACCESS_TOKEN (or PI_OPENAI_CODEX_ACCESS_TOKEN).");
  const exp = decodeJwtPayload(token)?.exp as number | undefined;
  if (typeof exp === "number" && shouldRefreshToken(exp)) {
    return refreshAndUpdateToken();
  }
  return token;
}

function outputDir(): string {
  return process.env.PI_IMAGE_GEN_OUTPUT_DIR || join(homedir(), ".tawassul", "generated_images");
}

function sanitize(value: string): string {
  const s = value.replace(/[^a-zA-Z0-9_-]/g, "_");
  return s.length ? s : "image";
}

async function saveImage(toolCallId: string, b64: string): Promise<string> {
  const dir = join(outputDir(), new Date().toISOString().slice(0, 10));
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${sanitize(toolCallId)}.png`);
  await writeFile(filePath, Buffer.from(b64.trim(), "base64"));
  return filePath;
}

function buildHeaders(token: string, accountId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    originator: "tawassul-image-gen",
    "User-Agent": "tawassul-image-gen/1.0",
    "OpenAI-Beta": "responses=experimental",
    accept: "text/event-stream",
    "content-type": "application/json",
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;
  return headers;
}

function requestBody(params: {
  prompt: string;
  action: "generate" | "edit";
  imageB64?: string;
  model: string;
}): string {
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: params.prompt }];
  if (params.action === "edit") {
    if (!params.imageB64) throw new Error("edit requires an imagePath to a local image.");
    content.push({ type: "input_image", image_url: `data:image/png;base64,${params.imageB64}`, detail: "auto" });
  }
  return JSON.stringify({
    model: params.model,
    store: false,
    stream: true,
    instructions: "Generate or edit the requested image. Do not add explanatory text.",
    input: [{ role: "user", content }],
    tools: [{ type: "image_generation", output_format: "png" }],
    tool_choice: "auto",
    parallel_tool_calls: true,
  });
}

async function streamImage(response: Response): Promise<{ b64: string; revisedPrompt?: string }> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body!) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const payload = JSON.parse(data);
          const item = payload.item;
          if (item?.type === "image_generation_call" && item.result) {
            return { b64: item.result, revisedPrompt: item.revised_prompt };
          }
        } catch {
          void 0;
        }
      }
    }
  }
  throw new Error("image_generation returned no image data");
}

async function callCodex(params: {
  prompt: string;
  action: "generate" | "edit";
  imageB64?: string;
  model: string;
  signal?: AbortSignal;
}): Promise<{ b64: string; revisedPrompt?: string }> {
  const token = await currentAccessToken();
  const url = codexResponsesUrl(process.env.PI_IMAGE_GEN_BASE_URL);

  const attempt = (accessToken: string): Promise<Response> =>
    withTimeout(
      (signal) =>
        fetch(url, {
          method: "POST",
          signal,
          headers: buildHeaders(accessToken, extractAccountId(accessToken)),
          body: requestBody(params),
        }),
      { timeoutMs: CODEX_REQUEST_TIMEOUT_MS, signal: params.signal },
    );

  let response = await attempt(token);
  if (response.status === 401) {
    const refreshed = await refreshAndUpdateToken();
    response = await attempt(refreshed);
  }
  if (response.status === 401) {
    throw new Error("image_generation failed (401) — access token rejected; renew OPENAI_CODEX_ACCESS_TOKEN");
  }
  if (!response.ok || !response.body) {
    throw new Error(`image_generation failed (${response.status})`);
  }
  return streamImage(response);
}

export function buildImageGenTool() {
  return tool({
    description:
      "Generate or edit images via OpenAI Codex image API (set OPENAI_CODEX_ACCESS_TOKEN). Saved PNG path is returned.",
    args: {
      action: tool.schema.enum(["generate", "edit"]).describe("generate a new image or edit an existing one"),
      prompt: tool.schema.string().describe("Detailed image generation or edit prompt"),
      imagePath: tool.schema.string().optional().describe("Local image path for action=edit"),
      model: tool.schema.string().optional().describe("Model override (default gpt-image-2)"),
    },
    async execute(
      args: { action: "generate" | "edit"; prompt: string; imagePath?: string; model?: string },
      cctx: ToolContext,
    ) {
      try {
        let imageB64: string | undefined;
        if (args.action === "edit") {
          if (!args.imagePath) return { output: "❌ edit requires imagePath" };
          const safe = await resolveSafePath(args.imagePath, cctx.directory);
          if (!safe) return { output: `❌ imagePath is outside the project — rejected for security` };
          imageB64 = (await readFile(safe)).toString("base64");
        }
        const model = args.model || process.env.PI_IMAGE_GEN_MODEL || DEFAULT_IMAGE_MODEL;
        const result = await callCodex({
          prompt: args.prompt,
          action: args.action,
          imageB64,
          model,
          signal: cctx.abort,
        });
        const saved = await saveImage(cctx.messageID || "img", result.b64);
        const revised = result.revisedPrompt ? `\nRevised prompt: ${result.revisedPrompt}` : "";
        return { title: "🖼️ Image Gen", output: `Image saved to ${saved}${revised}` };
      } catch (e) {
        return { title: "❌ Image Gen", output: `Error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });
}