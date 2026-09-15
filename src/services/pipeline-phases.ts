

import { PHASE_CONFIGS, PHASE_LABELS, EFFORT_LABELS, PIPELINE_MAP } from "./pipeline.ts";
import type { TaskPhase, PhaseConfig, PipelineDefinition } from "./pipeline.ts";
import type { ThinkingEffort } from "./effort-analyzer.ts";


export function getPhaseConfig(phase: TaskPhase): PhaseConfig {
  const config = PHASE_CONFIGS[phase];
  if (!config)
    return { phase, allowRead: true, allowWrite: false, mode: "sequential", maxAgents: 1, allowedAgentRoles: [] };
  return { ...config };
}


export function getPipeline(effort: ThinkingEffort): PipelineDefinition {
  const pipeline = PIPELINE_MAP[effort];
  if (!pipeline) {
    return {
      phases: ["analysis", "execution", "testing"],
      closurePhases: ["completed", "closed"],
      effort,
      description: `جهد غير معروف "${effort}" — استخدام moderate كافتراضي`,
    };
  }
  return { ...pipeline };
}


export function describePipeline(pipeline: PipelineDefinition): string {
  const effortLabel = EFFORT_LABELS[pipeline.effort] ?? pipeline.effort;
  const phases = pipeline.phases.map((p, i) => `  ${i + 1}. ${PHASE_LABELS[p] ?? p}`).join("\n");
  const closure = pipeline.closurePhases?.length
    ? "\n" + pipeline.closurePhases.map((p, i) => `  ${pipeline.phases.length + i + 1}. ${p}`).join("\n")
    : "";
  return `Pipeline (${effortLabel}, ${pipeline.phases.length + (pipeline.closurePhases?.length ?? 0)} phases):\n${phases}${closure}`;
}
