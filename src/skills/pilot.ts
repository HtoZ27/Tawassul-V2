import { resolve } from "node:path";
import type { CommandInvocation } from "@opencode/plugin/promise/command";
import type { SkillEditor } from "@opencode/plugin/promise/skill";
import manifest from "../../skills/manifest.json";
import contextContinueBody from "../../skills/tawassul-context-continue/SKILL.md" with { type: "text" };
import goalReviewBody from "../../skills/tawassul-goal-review/SKILL.md" with { type: "text" };
import handoffTriageBody from "../../skills/tawassul-handoff-triage/SKILL.md" with { type: "text" };
import integrationEngineerBody from "../../skills/tawassul-integration-engineer/SKILL.md" with { type: "text" };
import adversarialReviewBody from "../../skills/tawassul-adversarial-review/SKILL.md" with { type: "text" };
import enrichTaskBody from "../../skills/tawassul-enrich-task/SKILL.md" with { type: "text" };
import stepBackBody from "../../skills/tawassul-step-back/SKILL.md" with { type: "text" };
import diagnosingBugsBody from "../../skills/tawassul-diagnosing-bugs/SKILL.md" with { type: "text" };
import verificationPlanningBody from "../../skills/tawassul-verification-planning/SKILL.md" with { type: "text" };
import codeExplorerBody from "../../skills/tawassul-code-explorer/SKILL.md" with { type: "text" };
import incidentResponseBody from "../../skills/tawassul-incident-response/SKILL.md" with { type: "text" };
import toTicketsBody from "../../skills/tawassul-to-tickets/SKILL.md" with { type: "text" };
import retroBody from "../../skills/tawassul-retro/SKILL.md" with { type: "text" };
import writingForAgentsBody from "../../skills/tawassul-writing-for-agents/SKILL.md" with { type: "text" };
import codebaseDesignBody from "../../skills/tawassul-codebase-design/SKILL.md" with { type: "text" };
import interfaceDesignBody from "../../skills/tawassul-interface-design/SKILL.md" with { type: "text" };
import { logger } from "../utils/logger.ts";
import type { V2Context, V2Registration } from "../v2/types.ts";

export type PilotSkill = {
  id: string;
  name: string;
  description: string;
  directory: string;
  content: string;
};

const BODIES: Record<string, string> = {
  "tawassul-goal-review": goalReviewBody,
  "tawassul-handoff-triage": handoffTriageBody,
  "tawassul-context-continue": contextContinueBody,
  "tawassul-integration-engineer": integrationEngineerBody,
  "tawassul-adversarial-review": adversarialReviewBody,
  "tawassul-enrich-task": enrichTaskBody,
  "tawassul-step-back": stepBackBody,
  "tawassul-diagnosing-bugs": diagnosingBugsBody,
  "tawassul-verification-planning": verificationPlanningBody,
  "tawassul-code-explorer": codeExplorerBody,
  "tawassul-incident-response": incidentResponseBody,
  "tawassul-to-tickets": toTicketsBody,
  "tawassul-retro": retroBody,
  "tawassul-writing-for-agents": writingForAgentsBody,
  "tawassul-codebase-design": codebaseDesignBody,
  "tawassul-interface-design": interfaceDesignBody,
};

export const PILOT_SKILLS: readonly PilotSkill[] = manifest.skills.flatMap((skill) => {
  const content = BODIES[skill.id];
  if (content === undefined) {
    logger.warn(`[tawassul] v2 skill body missing for ${skill.id}`);
    return [];
  }
  return [{ ...skill, content }];
});

export const PILOT_COMMAND = manifest.commands[0]?.name ?? "tawassul-goals";

export const PILOT_COMMAND_TEXT =
  "Follow the tawassul-goal-review skill procedure and report the board after the review.";

export type SkillAddResult = { added: string[]; skipped: string[] };

export function addPilotSkills(
  editor: Pick<SkillEditor, "add">,
  base: string,
  skills: readonly PilotSkill[] = PILOT_SKILLS,
): SkillAddResult {
  const added: string[] = [];
  const skipped: string[] = [];
  for (const skill of skills) {
    try {
      editor.add({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        path: resolve(base, skill.directory, "SKILL.md"),
        content: skill.content,
        autoinvoke: true,
      } as Parameters<SkillEditor["add"]>[0]);
      added.push(skill.id);
    } catch (e) {
      skipped.push(skill.id);
      logger.warn(
        `[tawassul] v2 skill skipped ${skill.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return { added, skipped };
}

export async function registerPilotSkills(ctx: V2Context): Promise<V2Registration[]> {
  const domain = ctx.skill;
  if (!domain?.transform) return [];
  const base = ctx.location?.directory?.trim() || process.cwd();
  try {
    const registration = await domain.transform((editor) => {
      const result = addPilotSkills(editor, base);
      logger.info(
        `[tawassul] skill-registration: shipped=${result.added.join(",") || "none"} skipped=${result.skipped.join(",") || "none"}`,
      );
    });
    return [registration];
  } catch (e) {
    logger.warn(
      `[tawassul] v2 skill registration failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}

export async function runPilotCommand(
  ctx: V2Context,
  invocation: CommandInvocation,
): Promise<void> {
  const typed = typeof invocation.prompt?.text === "string" ? invocation.prompt.text.trim() : "";
  const text =
    typed.length > 0
      ? `${typed}\n\nFollow the tawassul-goal-review skill procedure.`
      : PILOT_COMMAND_TEXT;
  await ctx.session.prompt({ sessionID: invocation.sessionID, text, delivery: "queue" });
}

export async function registerPilotCommand(ctx: V2Context): Promise<V2Registration | undefined> {
  const domain = ctx.command;
  if (!domain?.transform) return undefined;
  try {
    return await domain.transform((editor) => {
      editor.add({
        name: PILOT_COMMAND,
        description: manifest.commands[0]?.description ?? "Run the shipped goal review procedure.",
        execute: async (invocation) => {
          await runPilotCommand(ctx, invocation);
        },
      });
    });
  } catch (e) {
    logger.warn(
      `[tawassul] v2 command registration failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
}
