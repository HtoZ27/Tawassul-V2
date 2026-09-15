import { access, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { t } from "../translations.ts";
import type { HandoffEntry } from "../context/types.ts";
import { normalizeName } from "./name-utils.ts";

export function sanitizeFilePath(filePath: string): { safe: true; decoded: string } | { safe: false; reason: string } {
  let decoded: string;
  try {
    decoded = decodeURIComponent(filePath);
  } catch {
    return { safe: false, reason: "invalid URL encoding" };
  }

  const lowerDecoded = decoded.toLowerCase();
  if (lowerDecoded.includes("%2e") || lowerDecoded.includes("%2f") || lowerDecoded.includes("%5c")) {
    return { safe: false, reason: "double-encoding detected" };
  }

  if (decoded.includes("..") || decoded.startsWith("/") || decoded.includes("\\")) {
    return { safe: false, reason: "path traversal detected" };
  }

  const nfkd = decoded.normalize("NFKD");
  if (nfkd.includes("../") || nfkd.includes("..\\")) {
    return { safe: false, reason: "unicode homoglyph traversal detected" };
  }

  if (decoded.includes("\0") || decoded.includes("%00")) {
    return { safe: false, reason: "null byte injection" };
  }

  return { safe: true, decoded };
}

export async function safeResolve(baseDir: string, filePath: string): Promise<string | null> {
  const sanitized = sanitizeFilePath(filePath);
  if (!sanitized.safe) return null;
  const resolved = resolve(baseDir, sanitized.decoded);
  const realBase = resolve(baseDir);
  if (resolved !== realBase && !resolved.startsWith(realBase + "/")) {
    return null;
  }
  try {
    await access(resolved);
    const realResolved = await realpath(resolved);
    if (realResolved !== realBase && !realResolved.startsWith(realBase + "/")) {
      return null;
    }
  } catch {
  }
  return resolved;
}

export type ValidationFeedback = {
  level: "info" | "warn" | "error";
  message: string;
};

export async function validateHandoffInput(
  agent: string,
  to: string,
  task: string,
  context: string,
  files: string[] | undefined,
  baseDir: string,
  allHandoffs: HandoffEntry[],
  suggestedHandoffs: Record<string, string[]>,
): Promise<ValidationFeedback[]> {
  const feedback: ValidationFeedback[] = [];

  const ctxWords = context?.split(/\s+/).filter(Boolean).length ?? 0;
  if (ctxWords < 5) {
    feedback.push({
      level: "error",
      message: t("contextTooShortError", { words: String(ctxWords) }),
    });
  } else if (ctxWords < 10) {
    feedback.push({
      level: "warn",
      message: t("contextShortWarn", { words: String(ctxWords) }),
    });
  }

  const taskWords = task?.split(/\s+/).filter(Boolean).length ?? 0;
  if (taskWords < 3) {
    feedback.push({
      level: "error",
      message: t("taskUnclearError", { words: String(taskWords) }),
    });
  } else if (taskWords < 5) {
    feedback.push({
      level: "warn",
      message: t("taskShortWarn", { words: String(taskWords) }),
    });
  }

  if (files && files.length > 0) {
    for (const f of files) {
      const sanitized = sanitizeFilePath(f);
      if (!sanitized.safe) {
        feedback.push({
          level: "error",
          message: t("fileNotFound", { file: f }),
        });
        continue;
      }

      const abs = await safeResolve(baseDir, f);
      if (abs === null) {
        feedback.push({
          level: "error",
          message: t("fileNotFound", { file: f }),
        });
        continue;
      }

      try {
        await access(abs);
      } catch {
        feedback.push({
          level: "warn",
          message: t("fileNotFound", { file: f }),
        });
      }
    }
  }

  if (agent === to) {
    feedback.push({
      level: "warn",
      message: t("selfHandoff", { agent: to }),
    });
  }

  const suggested = suggestedHandoffs[agent] ?? suggestedHandoffs[`@${agent}`];
  if (suggested && !suggested.includes(to)) {
    feedback.push({
      level: "info",
      message: t("suggestedFlow", { agent, suggested: suggested.join(", "), to }),
    });
  }

  const hanging = allHandoffs.find((h) => normalizeName(h.from) === normalizeName(agent) && h.status === "accepted");
  if (hanging) {
    feedback.push({
      level: "info",
      message: t("hangingHandoff", { id: hanging.id, to: hanging.to }),
    });
  }

  return feedback;
}
