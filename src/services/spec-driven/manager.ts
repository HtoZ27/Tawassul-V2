

import { unlink } from "node:fs/promises";
import { logger } from "../../utils/logger.ts";
import { BaseInnovationService, createSingleton } from "../base-innovation-service.ts";
import type { TaskSpec, SpecTemplate, SpecExecutionResult, SpecDrivenConfig, SpecEvent, SpecQuery } from "./types.js";
import {
  SpecDrivenConfigSchema,
  TaskSpecSchema,
  SpecTemplateSchema,
  SpecExecutionResultSchema,
  generateSpecId,
  generateTemplateId,
  generateExecutionId,
  createSpecFromText,
  generateSpecFromTemplate,
  BUILTIN_TEMPLATES,
} from "./types.js";



export class SpecDrivenManager extends BaseInnovationService<SpecDrivenConfig, SpecEvent> {
  private specs: Map<string, TaskSpec> = new Map();
  private templates: Map<string, SpecTemplate> = new Map();
  private executions: Map<string, SpecExecutionResult> = new Map();
  constructor(config?: Partial<SpecDrivenConfig>) {
    super(config, SpecDrivenConfigSchema);

    
    for (const template of BUILTIN_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  
  createSpec(
    title: string,
    description: string,
    options?: {
      expectedOutputs?: string[];
      acceptanceCriteria?: string[];
      inputs?: string[];
      constraints?: string[];
      priority?: number;
      estimatedDurationMs?: number;
      estimatedCost?: number;
      suggestedModel?: string;
      createdBy?: "user" | "agent" | "system";
      metadata?: Record<string, unknown>;
    },
  ): TaskSpec {
    const now = new Date().toISOString();

    const spec: TaskSpec = {
      id: generateSpecId(),
      title,
      description,
      expectedOutputs: options?.expectedOutputs || ["Implementation matching the description"],
      acceptanceCriteria: options?.acceptanceCriteria || ["Code compiles and passes tests"],
      inputs: options?.inputs || [],
      constraints: options?.constraints || [],
      priority: options?.priority || 3,
      estimatedDurationMs: options?.estimatedDurationMs,
      estimatedCost: options?.estimatedCost,
      suggestedModel: options?.suggestedModel,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      createdBy: options?.createdBy || "user",
      metadata: options?.metadata,
    };

    this.specs.set(spec.id, spec);
    this.trimSpecs();

    this.emitEvent({
      type: "spec_created",
      payload: { specId: spec.id, title: spec.title },
      source: "spec-driven",
      timestamp: now,
    });

    return spec;
  }

  
  createSpecFromText(text: string): TaskSpec {
    const spec = createSpecFromText(text);
    this.specs.set(spec.id, spec);
    this.trimSpecs();

    this.emitEvent({
      type: "spec_created",
      payload: { specId: spec.id, title: spec.title, quickMode: true },
      source: "spec-driven",
      timestamp: new Date().toISOString(),
    });

    return spec;
  }

  
  createSpecFromTemplate(templateId: string, variables: Record<string, string>): TaskSpec | null {
    const template = this.templates.get(templateId);
    if (!template) return null;

    const merged: Record<string, string> = { ...variables };
    for (const v of template.variables) {
      const val = merged[v.name];
      if (v.required && (val === undefined || val === null || val === "")) {
        logger.warn(`Required variable "${v.name}" missing for template "${templateId}"`);
        return null;
      }
      if ((val === undefined || val === null) && v.defaultValue !== undefined) {
        merged[v.name] = v.defaultValue;
      }
    }

    let spec: TaskSpec;
    try {
      spec = generateSpecFromTemplate(template, merged);
    } catch (err) {
      logger.error(`Template rendering failed for "${templateId}": ${err}`);
      return null;
    }
    this.specs.set(spec.id, spec);
    this.trimSpecs();

    
    template.usageCount++;

    this.emitEvent({
      type: "template_used",
      payload: { specId: spec.id, templateId, templateName: template.name },
      source: "spec-driven",
      timestamp: new Date().toISOString(),
    });

    this.emitEvent({
      type: "spec_created",
      payload: { specId: spec.id, title: spec.title, fromTemplate: true },
      source: "spec-driven",
      timestamp: new Date().toISOString(),
    });

    return spec;
  }

  
  approveSpec(specId: string): boolean {
    const spec = this.specs.get(specId);
    if (!spec || spec.status !== "draft") return false;

    spec.status = "approved";
    spec.updatedAt = new Date().toISOString();

    this.emitEvent({
      type: "spec_approved",
      payload: { specId, title: spec.title },
      source: "spec-driven",
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  
  startSpec(specId: string): boolean {
    const spec = this.specs.get(specId);
    if (!spec || spec.status !== "approved") return false;

    spec.status = "in_progress";
    spec.updatedAt = new Date().toISOString();

    this.emitEvent({
      type: "spec_started",
      payload: { specId, title: spec.title },
      source: "spec-driven",
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  
  completeSpec(
    specId: string,
    result: Omit<SpecExecutionResult, "id" | "specId" | "executedAt">,
  ): SpecExecutionResult | null {
    const spec = this.specs.get(specId);
    if (!spec || spec.status !== "in_progress") return null;

    const now = new Date().toISOString();

    const execution: SpecExecutionResult = {
      id: generateExecutionId(),
      specId,
      success: result.success,
      actualOutputs: result.actualOutputs,
      criteriaMet: result.criteriaMet,
      criteriaScore: result.criteriaScore,
      actualCost: result.actualCost,
      actualDurationMs: result.actualDurationMs,
      modelUsed: result.modelUsed,
      attemptCount: result.attemptCount,
      errors: result.errors,
      feedback: result.feedback,
      executedAt: now,
    };

    this.executions.set(execution.id, execution);
    this.trimExecutions();

    
    spec.status = result.success ? "completed" : "failed";
    spec.updatedAt = now;

    this.emitEvent({
      type: result.success ? "spec_completed" : "spec_failed",
      payload: { specId, executionId: execution.id, success: result.success },
      source: "spec-driven",
      timestamp: now,
    });

    return execution;
  }

  
  cancelSpec(specId: string): boolean {
    const spec = this.specs.get(specId);
    if (!spec) return false;

    spec.status = "cancelled";
    spec.updatedAt = new Date().toISOString();

    this.emitEvent({
      type: "spec_cancelled",
      payload: { specId, title: spec.title },
      source: "spec-driven",
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  
  createTemplate(
    name: string,
    description: string,
    taskType: SpecTemplate["taskType"],
    template: string,
    variables: SpecTemplate["variables"],
  ): SpecTemplate {
    const now = new Date().toISOString();

    const newTemplate: SpecTemplate = {
      id: generateTemplateId(),
      name,
      description,
      taskType,
      template,
      variables,
      source: "user_created",
      usageCount: 0,
      createdAt: now,
    };

    this.templates.set(newTemplate.id, newTemplate);
    this.trimTemplates();

    this.emitEvent({
      type: "template_created",
      payload: { templateId: newTemplate.id, name: newTemplate.name },
      source: "spec-driven",
      timestamp: now,
    });

    return newTemplate;
  }

  
  getSpec(specId: string): TaskSpec | null {
    return this.specs.get(specId) || null;
  }

  
  getAllSpecs(): TaskSpec[] {
    return Array.from(this.specs.values());
  }

  
  querySpecs(query: SpecQuery): TaskSpec[] {
    let specs = Array.from(this.specs.values());

    if (query.status) {
      specs = specs.filter((s) => s.status === query.status);
    }

    if (query.minPriority) {
      specs = specs.filter((s) => s.priority >= query.minPriority!);
    }

    if (query.createdBy) {
      specs = specs.filter((s) => s.createdBy === query.createdBy);
    }

    if (query.since) {
      const since = new Date(query.since);
      specs = specs.filter((s) => new Date(s.createdAt) >= since);
    }

    if (query.until) {
      const until = new Date(query.until);
      specs = specs.filter((s) => new Date(s.createdAt) <= until);
    }

    
    const orderBy = query.orderBy || "priority";
    if (orderBy === "priority") {
      specs.sort((a, b) => b.priority - a.priority);
    } else if (orderBy === "recent") {
      specs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (orderBy === "status") {
      const statusOrder = { draft: 0, approved: 1, in_progress: 2, completed: 3, failed: 4, cancelled: 5 };
      specs.sort((a, b) => (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0));
    }

    
    const limit = query.limit || 50;
    return specs.slice(0, limit);
  }

  
  getTemplate(templateId: string): SpecTemplate | null {
    return this.templates.get(templateId) || null;
  }

  
  getAllTemplates(): SpecTemplate[] {
    return Array.from(this.templates.values());
  }

  
  getExecution(executionId: string): SpecExecutionResult | null {
    return this.executions.get(executionId) || null;
  }

  
  getSpecExecutions(specId: string): SpecExecutionResult[] {
    return Array.from(this.executions.values()).filter((e) => e.specId === specId);
  }

  
  private trimSpecs(): void {
    if (this.specs.size <= this.config.maxSpecs) return;

    const sorted = Array.from(this.specs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const toKeep = sorted.slice(0, this.config.maxSpecs);
    this.specs.clear();
    for (const spec of toKeep) {
      this.specs.set(spec.id, spec);
    }
  }

  
  private trimExecutions(): void {
    if (this.executions.size <= this.config.maxSpecs * 2) return;

    const sorted = Array.from(this.executions.values()).sort(
      (a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime(),
    );

    const toKeep = sorted.slice(0, this.config.maxSpecs * 2);
    this.executions.clear();
    for (const ex of toKeep) {
      this.executions.set(ex.id, ex);
    }
  }

  
  private trimTemplates(): void {
    if (this.templates.size <= this.config.maxTemplates) return;

    const userCreated = Array.from(this.templates.values())
      .filter((t) => t.source !== "built_in")
      .sort((a, b) => b.usageCount - a.usageCount);

    const builtIn = Array.from(this.templates.values()).filter((t) => t.source === "built_in");

    const keepSlots = Math.max(0, this.config.maxTemplates - builtIn.length);
    const toKeep = [...builtIn, ...userCreated.slice(0, keepSlots)];
    this.templates.clear();
    for (const template of toKeep) {
      this.templates.set(template.id, template);
    }
  }

  
  async persist(): Promise<void> {
    this.persistToDisk("spec-driven", () => ({
      specs: Array.from(this.specs.values()),
      templates: Array.from(this.templates.values()),
      executions: Array.from(this.executions.values()),
    }));
  }

  
  async load(): Promise<void> {
    const data = await this.readFromDisk<{
      version: string;
      persistedAt: string;
      specs: unknown[];
      templates: unknown[];
      executions: unknown[];
    }>();

    if (!data) return;

    const maxArrayLen = Math.max(this.config.maxSpecs, this.config.maxTemplates) * 3;

    if (Array.isArray(data.specs)) {
      const limited = data.specs.slice(0, maxArrayLen);
      for (const item of limited) {
        const parsed = TaskSpecSchema.safeParse(item);
        if (parsed.success) {
          this.specs.set(parsed.data.id, parsed.data);
        }
      }
    }

    if (Array.isArray(data.templates)) {
      const limited = data.templates.slice(0, maxArrayLen);
      for (const item of limited) {
        const parsed = SpecTemplateSchema.safeParse(item);
        if (parsed.success && !this.templates.has(parsed.data.id)) {
          this.templates.set(parsed.data.id, parsed.data);
        }
      }
    }

    if (Array.isArray(data.executions)) {
      const limited = data.executions.slice(0, maxArrayLen);
      for (const item of limited) {
        const parsed = SpecExecutionResultSchema.safeParse(item);
        if (parsed.success) {
          this.executions.set(parsed.data.id, parsed.data);
        }
      }
    }

    logger.info(`Loaded ${this.specs.size} specs, ${this.templates.size} templates`);
  }

  

  
  getStats(): {
    totalSpecs: number;
    totalTemplates: number;
    totalExecutions: number;
    specsByStatus: Record<TaskSpec["status"], number>;
    successRate: number;
  } {
    const specs = Array.from(this.specs.values());
    const executions = Array.from(this.executions.values());

    const specsByStatus: Record<TaskSpec["status"], number> = {
      draft: 0,
      approved: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const spec of specs) {
      specsByStatus[spec.status]++;
    }

    const successfulExecutions = executions.filter((e) => e.success).length;

    return {
      totalSpecs: specs.length,
      totalTemplates: this.templates.size,
      totalExecutions: executions.length,
      specsByStatus,
      successRate: executions.length > 0 ? successfulExecutions / executions.length : 0,
    };
  }

  
  async clear(): Promise<void> {
    this.specs.clear();
    this.executions.clear();
    try {
      await unlink(this.storagePath);
    } catch {

    }
  }

  
  isEnabled(): boolean {
    return this.config.enabled;
  }

  
  isMandatory(): boolean {
    return this.config.mandatory;
  }
}



export const { get: getSpecDrivenManager, reset: resetSpecDrivenManager } = createSingleton<SpecDrivenManager>(
  (config) => new SpecDrivenManager(config as Partial<SpecDrivenConfig> | undefined),
);
