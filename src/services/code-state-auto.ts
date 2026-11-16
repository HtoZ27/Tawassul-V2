

import { CodeStateService } from "./code-state.ts";

const MUTATING_TOOLS = new Set(["bash", "write", "edit", "notebook", "apply_patch", "multi_edit"]);


const DEBOUNCE_MS = 500;

let cached: CodeStateService | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastTool = "";

function service(): CodeStateService | null {
  if (cached) return cached;
  try {
    cached = new CodeStateService(process.cwd());
  } catch {
    cached = null;
  }
  return cached;
}


export async function maybeAutoCapture(toolName: string, success: boolean): Promise<void> {
  try {
    if (process.env.TAWASSUL_CODE_STATE_AUTO !== "1") return;
    if (!success) return;
    if (!MUTATING_TOOLS.has(toolName)) return;
    const svc = service();
    if (!svc) return;
    lastTool = toolName;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      svc.capture(`auto:${lastTool}`).catch(() => {

      });
    }, DEBOUNCE_MS);
  } catch {

  }
}
