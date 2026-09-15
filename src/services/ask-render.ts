

export interface AskRenderEnvFlags {
  appendPromptEnabled: boolean;
  transcriptEnabled: boolean;
}


export function readAskRenderEnv(
  env: Record<string, string | undefined> = process?.env ?? ({} as NodeJS.ProcessEnv),
): AskRenderEnvFlags {
  const flag = (v: string | undefined, def: string): boolean => {
    const s = String(v ?? def)
      .trim()
      .toLowerCase();
    return s !== "0" && s !== "false";
  };
  return {
    appendPromptEnabled: flag(env.TAWASSUL_ASK_APPEND_PROMPT, "0"),
    transcriptEnabled: flag(env.TAWASSUL_ASK_TRANSCRIPT, "1"),
  };
}

export type AskRenderMode = "append" | "transcript" | "none";

export function resolveAskRenderer(opts: {
  appendPromptAvailable: boolean;
  appendPromptEnabled: boolean;
  transcriptEnabled: boolean;
}): AskRenderMode {
  if (opts.appendPromptAvailable && opts.appendPromptEnabled) return "append";
  if (opts.transcriptEnabled) return "transcript";
  return "none";
}
