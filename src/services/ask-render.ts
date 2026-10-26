

export interface AskRenderEnvFlags {
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
    transcriptEnabled: flag(env.TAWASSUL_ASK_TRANSCRIPT, "1"),
  };
}

export type AskRenderMode = "transcript" | "none";

export function resolveAskRenderer(opts: { transcriptEnabled: boolean }): AskRenderMode {
  return opts.transcriptEnabled ? "transcript" : "none";
}
