







import type { HandoffEntry } from "../types.ts";
import type {
  TaskPhase,
  PipelineDefinition,
  PhaseConfig,
  TransitionPhase,
  ClosurePhase,
  PhaseResult,
  TransitionResult,
} from "../../services/pipeline.ts";
import { getPhaseConfig, describePipeline } from "../../services/pipeline-phases.ts";
import { canTransition, getNextPhase, buildTransitionContext } from "../../services/pipeline-transitions.ts";
import type { FeatureIndex } from "../../services/feature-index.ts";
import { summarizeResults, formatSummaryForUser } from "../../lib/result-summarizer.ts";
import type { AgentResult } from "../../lib/result-summarizer.ts";
import type { TaskUnit, CoordinationPlan, ConflictResolution } from "../../services/parallel-dispatcher.ts";
import { createCoordinationPlan, handleConflict } from "../../services/parallel-dispatcher.ts";
import type { TestOutput, TestClassification, TestPlan } from "../../services/pipeline.ts";
import {
  classifyTestResult,
  routeTestFailure,
  createTestPlan,
  summarizeTestResult,
  getRepairSuggestions,
} from "../../services/pipeline-test.ts";
import { normalizeName } from "../../utils/name-utils.ts";

export type PipelineStateManagerDeps = {
  handoffs?: Map<string, HandoffEntry>;
  featureIndex?: FeatureIndex;
};

export class PipelineStateManager {
  private pipeline: PipelineDefinition | null = null;
  private states: Partial<Record<TaskPhase, PhaseResult>> = {};
  private currentPhaseIndex = 0;
  private closurePhaseIndex = 0;
  private inClosurePhase = false;
  private taskId = "";
  private handoffsRef: HandoffEntry[] | null = null;
  private featureIndexRef: FeatureIndex | null = null;
  private featureId = "";
  private agentFailureCounts = new Map<string, number>();

  constructor(deps?: PipelineStateManagerDeps) {
    if (deps?.handoffs) {
      this.handoffsRef = [...deps.handoffs.values()];
    }
    if (deps?.featureIndex) {
      this.featureIndexRef = deps.featureIndex;
    }
  }

  private static readonly TOOLS_PER_PHASE: Record<TaskPhase, string[]> = {
    analysis: ["task", "read", "grep"],
    planning: ["task", "edit", "write"],
    execution: ["edit", "write", "bash", "task"],
    testing: ["bash", "read", "task"],
  };

  
  private static readonly TOOL_WEIGHTS: Record<string, number> = {
    edit: 0.4,
    write: 0.4,
    bash: 0.3,
    task: 0.35,
    read: 0.15,
    grep: 0.15,
    glob: 0.15,
  };

  

  setPipeline(p: PipelineDefinition | null, taskId?: string): void {
    if (
      this.pipeline &&
      p &&
      this.pipeline.effort === p.effort &&
      JSON.stringify(this.pipeline.phases) === JSON.stringify(p.phases)
    ) {
      return;
    }

    this.pipeline = p;
    this.taskId = taskId ?? `task-${Date.now()}`;
    this.currentPhaseIndex = 0;
    this.closurePhaseIndex = 0;
    this.inClosurePhase = false;
    this.states = {};

    if (p && p.phases.length > 0) {
      this.startPhase(p.phases[0]!);
    }
  }

  setHandoffsRef(ref: Map<string, HandoffEntry>): void {
    this.handoffsRef = [...ref.values()];
  }

  setFeatureIndex(index: FeatureIndex): void {
    this.featureIndexRef = index;
  }

  setFeatureId(id: string): void {
    this.featureId = id;
  }

  private startPhase(phase: TaskPhase): void {
    if (!this.pipeline) return;
    this.states[phase] = {
      phase,
      status: "in-progress",
      completeness: 0,
      startedAt: new Date().toISOString(),
    };
  }

  getCurrentPhase(): TransitionPhase | null {
    if (!this.pipeline) return null;
    if (!this.inClosurePhase) {
      if (this.currentPhaseIndex >= this.pipeline.phases.length) {
        
        if (this.pipeline.closurePhases?.length && this.closurePhaseIndex < this.pipeline.closurePhases.length) {
          return this.pipeline.closurePhases[this.closurePhaseIndex]!;
        }
        return null;
      }
      return this.pipeline.phases[this.currentPhaseIndex] ?? null;
    }
    
    if (this.pipeline.closurePhases && this.closurePhaseIndex < this.pipeline.closurePhases.length) {
      return this.pipeline.closurePhases[this.closurePhaseIndex]!;
    }
    return null;
  }

  getCurrentPhaseConfig(): PhaseConfig | null {
    const phase = this.getCurrentPhase();
    if (!phase || phase === "completed" || phase === "closed") return null;
    return getPhaseConfig(phase as TaskPhase);
  }

  getPhaseConfig(phase: TaskPhase): PhaseConfig {
    return getPhaseConfig(phase);
  }

  canAdvance(): TransitionResult {
    if (!this.pipeline) {
      return { allowed: false, reason: "No pipeline set", requiredActions: ["Set pipeline first"] };
    }
    const currentPhase = this.getCurrentPhase();
    if (!currentPhase) {
      return { allowed: false, reason: "Pipeline is complete", requiredActions: [] };
    }
    const nextPhase = getNextPhase(currentPhase, this.pipeline);
    if (!nextPhase) {
      return { allowed: false, reason: "No next phase — pipeline complete", requiredActions: [] };
    }

    const ctx = buildTransitionContext({
      pipeline: this.pipeline,
      phaseResults: this.states,
      taskId: this.taskId,
      handoffs: this.handoffsRef ?? [],
    });
    ctx.featureId = this.featureId;
    ctx.featureIndex = this.featureIndexRef ?? undefined;

    return canTransition(currentPhase, nextPhase, ctx);
  }

  advancePhase(): TransitionResult {
    const result = this.canAdvance();
    if (!result.allowed) return result;

    const currentPhase = this.getCurrentPhase();
    if (!currentPhase) return result;

    if (!this.inClosurePhase) {
      
      if (currentPhase !== "completed" && currentPhase !== "closed") {
        const currentResult = this.states[currentPhase as TaskPhase];
        if (currentResult) {
          currentResult.status = "completed";
          currentResult.completeness = 1;
          currentResult.completedAt = new Date().toISOString();
          if (currentResult.startedAt) {
            currentResult.duration =
              new Date(currentResult.completedAt).getTime() - new Date(currentResult.startedAt).getTime();
          }
        }
      }
    }

    const nextPhase = getNextPhase(currentPhase, this.pipeline!);
    if (!nextPhase) return result;

    
    if (!this.inClosurePhase && (nextPhase === "completed" || nextPhase === "closed")) {
      this.inClosurePhase = true;
      this.closurePhaseIndex = this.pipeline!.closurePhases?.indexOf(nextPhase as ClosurePhase) ?? 0;
      
      if (nextPhase === "completed" && this.featureIndexRef && this.featureId) {
        this.featureIndexRef.transitionTo(this.featureId, "completed");
      }
    } else if (this.inClosurePhase) {
      this.closurePhaseIndex++;
    } else {
      this.currentPhaseIndex++;
    }

    
    if (nextPhase !== "completed" && nextPhase !== "closed") {
      this.startPhase(nextPhase as TaskPhase);
    }

    return { allowed: true, reason: `Advanced from "${currentPhase}" to "${nextPhase}"`, requiredActions: [] };
  }

  recordPhaseResult(result: PhaseResult): void {
    this.states[result.phase] = result;
  }

  recordToolResult(tool: string, success: boolean): TransitionResult | null {
    const currentPhase = this.getCurrentPhase();
    if (!currentPhase) return null;

    if (currentPhase === "completed" || currentPhase === "closed") {
      if (success && currentPhase === "completed") {
        return this.advancePhase();
      }
      return null;
    }

    const allowed = PipelineStateManager.TOOLS_PER_PHASE[currentPhase as TaskPhase];
    if (!allowed?.includes(tool)) return null;

    const current = this.states[currentPhase as TaskPhase];
    if (!current) return null;

    if (success) {
      
      const weight = PipelineStateManager.TOOL_WEIGHTS[tool] ?? 0.25;
      current.completeness = Math.min(1, (current.completeness ?? 0) + weight);
      if (current.completeness >= 1 && current.status === "in-progress") {
        
        
        
        current.status = "completed";
        current.completedAt = new Date().toISOString();
        if (current.startedAt) {
          current.duration = new Date(current.completedAt).getTime() - new Date(current.startedAt).getTime();
        }
        if (!current.output) {
          current.output = { status: "pass", passed: 1, failed: 0, total: 1 };
        } else {
          (current.output as Record<string, unknown>).status = "pass";
        }
        return this.advancePhase();
      }
    }
    return null;
  }

  

  createPlan(tasks: TaskUnit[], _activeHandoffs: HandoffEntry[]): CoordinationPlan {
    return createCoordinationPlan((this.getCurrentPhase() ?? "execution") as TaskPhase, tasks, this.agentFailureCounts);
  }

  resolveConflict(agents: string[], files: string[], activeHandoffs: HandoffEntry[]): ConflictResolution {
    return handleConflict(agents, files, activeHandoffs, this.agentFailureCounts);
  }

  recordAgentFailure(agent: string): void {
    const key = normalizeName(agent);
    this.agentFailureCounts.set(key, (this.agentFailureCounts.get(key) ?? 0) + 1);
  }

  recordAgentSuccess(agent: string): void {
    this.agentFailureCounts.set(normalizeName(agent), 0);
  }

  

  classifyTestResult(testOutput: TestOutput): TestClassification {
    return classifyTestResult(testOutput);
  }

  handleTestResults(
    testOutput: TestOutput,
    pipeline: PipelineDefinition,
  ): { classification: TestClassification; handoff: HandoffEntry | null } {
    const classification = classifyTestResult(testOutput);
    const handoff = routeTestFailure(classification, pipeline);
    return { classification, handoff };
  }

  createTestPlan(executionResult: { filesChanged: string[]; specializations?: string[]; errors?: string[] }): TestPlan {
    return createTestPlan(executionResult);
  }

  summarizeTestResult(classification: TestClassification): string {
    return summarizeTestResult(classification);
  }

  getRepairSuggestions(classification: TestClassification): string[] {
    return getRepairSuggestions(classification);
  }

  getCompletionSummary(): string {
    const results: AgentResult[] = [];
    for (const [phase, state] of Object.entries(this.states)) {
      if (state && state.status === "completed") {
        results.push({
          agent: phase,
          role: phase,
          status: "success",
          output: state.output ? JSON.stringify(state.output) : "",
          filesChanged: [],
          warnings: [],
        });
      } else if (state && state.status !== "in-progress") {
        results.push({
          agent: phase,
          role: phase,
          status: "failure",
          output: "",
          filesChanged: [],
          warnings: [],
        });
      }
    }
    if (results.length === 0) return "";
    return formatSummaryForUser(summarizeResults(results));
  }

  

  isComplete(): boolean {
    if (!this.pipeline) return false;
    
    const pipelineDone = this.currentPhaseIndex >= this.pipeline.phases.length;
    if (!pipelineDone) return false;
    if (!this.pipeline.closurePhases?.length) return pipelineDone;
    return this.closurePhaseIndex >= this.pipeline.closurePhases.length;
  }

  canCloseFeature(): boolean {
    if (!this.pipeline) return false;
    const pipelineDone = this.currentPhaseIndex >= this.pipeline.phases.length;
    if (!pipelineDone) return false;
    if (!this.featureIndexRef || !this.featureId) return false;
    const ctx = buildTransitionContext({
      pipeline: this.pipeline,
      phaseResults: this.states,
      taskId: this.taskId,
      handoffs: this.handoffsRef ?? [],
    });
    ctx.featureId = this.featureId;
    ctx.featureIndex = this.featureIndexRef;
    return canTransition("completed" as TransitionPhase, "closed" as TransitionPhase, ctx).allowed;
  }

  describe(): string {
    if (!this.pipeline) return "No pipeline active";
    const phase = this.getCurrentPhase();
    const totalPhases = this.pipeline.phases.length + (this.pipeline.closurePhases?.length ?? 0);
    let phaseLabel: string;
    if (!phase) {
      phaseLabel = "\nPipeline complete";
    } else if (this.inClosurePhase) {
      phaseLabel = `\nCurrent phase: ${phase} (closure ${this.closurePhaseIndex + 1}/${this.pipeline.closurePhases?.length ?? 0})`;
    } else {
      phaseLabel = `\nCurrent phase: ${phase} (index ${this.currentPhaseIndex + 1}/${totalPhases})`;
    }
    return `${describePipeline(this.pipeline)}${phaseLabel}`;
  }

  getStates(): Partial<Record<TaskPhase, PhaseResult>> {
    return { ...this.states };
  }

  getPipeline(): PipelineDefinition | null {
    return this.pipeline ? { ...this.pipeline } : null;
  }

  getCurrentPhaseIndex(): number {
    return this.currentPhaseIndex;
  }

  setTaskId(id: string): void {
    this.taskId = id;
  }

  getFeatureId(): string {
    return this.featureId;
  }

  

  reset(): void {
    this.pipeline = null;
    this.states = {};
    this.currentPhaseIndex = 0;
    this.closurePhaseIndex = 0;
    this.inClosurePhase = false;
    this.taskId = "";
    this.featureId = "";
    this.featureIndexRef = null;
  }
}
