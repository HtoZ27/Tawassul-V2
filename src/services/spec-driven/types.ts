import crypto from "node:crypto";
import { z } from "zod";

export const TaskSpecSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  expectedOutputs: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  inputs: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  priority: z.number().int().min(1).max(5).default(3),
  estimatedDurationMs: z.number().int().min(0).optional(),
  estimatedCost: z.number().min(0).optional(),
  suggestedModel: z.string().optional(),
  status: z
    .enum([
      "draft",
      "approved",
      "in_progress",
      "completed",
      "failed",
      "cancelled",
    ])
    .default("draft"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.enum(["user", "agent", "system"]).default("user"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type TaskSpec = z.infer<typeof TaskSpecSchema>;

export const SpecTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  taskType: z.enum(["fix", "review", "test", "refactor", "analysis", "workflow", "doc", "implementation"]),
  template: z.string(),
  variables: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      required: z.boolean().default(true),
      defaultValue: z.string().optional(),
    }),
  ),
  source: z
    .enum([
      "built_in",
      "user_created",
      "learned",
    ])
    .default("built_in"),
  usageCount: z.number().int().min(0).default(0),
  createdAt: z.string().datetime(),
});

export type SpecTemplate = z.infer<typeof SpecTemplateSchema>;

export const SpecExecutionResultSchema = z.object({
  id: z.string().uuid(),
  specId: z.string().uuid(),
  success: z.boolean(),
  actualOutputs: z.array(z.string()),
  criteriaMet: z.array(z.boolean()),
  criteriaScore: z.number().min(0).max(1),
  actualCost: z.number().min(0),
  actualDurationMs: z.number().int().min(0),
  modelUsed: z.string(),
  attemptCount: z.number().int().min(1),
  errors: z.array(z.string()).default([]),
  feedback: z.string().optional(),
  executedAt: z.string().datetime(),
});

export type SpecExecutionResult = z.infer<typeof SpecExecutionResultSchema>;

export const SpecDrivenConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mandatory: z.boolean().default(false),
  maxTemplates: z.number().int().min(10).default(100),
  maxSpecs: z.number().int().min(10).default(500),
  storagePath: z.string().default("~/.config/tawassyl/state/spec-driven.json"),
  useCollectiveMemory: z.boolean().default(true),
  showDetailedErrors: z.boolean().default(true),
  minCriteriaScore: z.number().min(0).max(1).default(0.8),
});

export type SpecDrivenConfig = z.infer<typeof SpecDrivenConfigSchema>;

export const SpecQuerySchema = z.object({
  status: TaskSpecSchema.shape.status.optional(),
  minPriority: z.number().int().min(1).max(5).optional(),
  createdBy: TaskSpecSchema.shape.createdBy.optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  orderBy: z.enum(["priority", "recent", "status"]).optional(),
});

export type SpecQuery = z.infer<typeof SpecQuerySchema>;

export interface SpecEvent {
  type:
    | "spec_created"
    | "spec_approved"
    | "spec_started"
    | "spec_completed"
    | "spec_failed"
    | "spec_cancelled"
    | "template_created"
    | "template_used"
    | "execution_completed";
  payload: Record<string, unknown>;
  source: string;
  timestamp: string;
}

export function generateSpecId(): string {
  return crypto.randomUUID();
}

export function generateTemplateId(): string {
  return crypto.randomUUID();
}

export function generateExecutionId(): string {
  return crypto.randomUUID();
}

export function createSpecFromText(text: string): TaskSpec {
  const now = new Date().toISOString();

  return {
    id: generateSpecId(),
    title: text.slice(0, 100),
    description: text,
    expectedOutputs: ["Implementation matching the description"],
    acceptanceCriteria: ["Code compiles and passes tests"],
    inputs: [],
    constraints: [],
    priority: 3,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
  };
}

export function generateSpecFromTemplate(template: SpecTemplate, variables: Record<string, string>): TaskSpec {
  let content = template.template;

  for (const [name, value] of Object.entries(variables)) {
    content = content.split(`{{${name}}}`).join(value);
  }

  content = content.replace(/\{\{[^}]+\}\}/g, "");

  const now = new Date().toISOString();

  return {
    id: generateSpecId(),
    title: `From template: ${template.name}`,
    description: content,
    expectedOutputs: ["Implementation matching the template"],
    acceptanceCriteria: ["Code compiles and passes tests"],
    inputs: Object.values(variables),
    constraints: [],
    priority: 3,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    createdBy: "system",
    metadata: { templateId: template.id, templateName: template.name },
  };
}

export const BUILTIN_TEMPLATES: SpecTemplate[] = [
  {
    id: "ts-function",
    name: "TypeScript Function",
    description: "Template for creating a TypeScript function",
    taskType: "implementation",
    template: `Create a TypeScript function named {{name}} that:
- Takes parameters: {{parameters}}
- Returns: {{returnType}}
- Description: {{description}}
- Must include error handling
- Must include JSDoc comments`,
    variables: [
      { name: "name", description: "Function name", required: true },
      { name: "parameters", description: "Function parameters", required: true },
      { name: "returnType", description: "Return type", required: true },
      { name: "description", description: "Function description", required: true },
    ],
    source: "built_in",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "ts-class",
    name: "TypeScript Class",
    description: "Template for creating a TypeScript class",
    taskType: "implementation",
    template: `Create a TypeScript class named {{name}} that:
- Description: {{description}}
- Methods: {{methods}}
- Must include proper typing
- Must include error handling
- Must include JSDoc comments`,
    variables: [
      { name: "name", description: "Class name", required: true },
      { name: "description", description: "Class description", required: true },
      { name: "methods", description: "Class methods", required: false, defaultValue: "constructor, getters, setters" },
    ],
    source: "built_in",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "api-endpoint",
    name: "API Endpoint",
    description: "Template for creating an API endpoint",
    taskType: "implementation",
    template: `Create an API endpoint for {{path}} that:
- Method: {{method}}
- Description: {{description}}
- Request body: {{requestBody}}
- Response type: {{responseType}}
- Must include validation
- Must include error handling
- Must include authentication if needed`,
    variables: [
      { name: "path", description: "Endpoint path", required: true },
      { name: "method", description: "HTTP method", required: true, defaultValue: "GET" },
      { name: "description", description: "Endpoint description", required: true },
      { name: "requestBody", description: "Request body schema", required: false },
      { name: "responseType", description: "Response type", required: true },
    ],
    source: "built_in",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-bug-fix",
    name: "Bug Fix",
    description: "Template for fixing a bug with reproduction steps and acceptance criteria",
    taskType: "fix",
    template: `**Goal:** Fix {{issue}} in {{files}}
**Reproduction Steps:**
{{reproSteps}}

**Criteria:**
- {{acceptanceCriteria}}

**Out of Scope:**
- {{outOfScope}}`,
    variables: [
      { name: "issue", description: "Problem description", required: true },
      { name: "files", description: "Affected files (comma-separated)", required: true },
      { name: "reproSteps", description: "Steps to reproduce the problem", required: true },
      { name: "acceptanceCriteria", description: "Fix success criteria", required: true },
      { name: "outOfScope", description: "What the fix does not cover", required: false, defaultValue: "None" },
    ],
    source: "built_in",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-code-review",
    name: "Code Review",
    description: "Template for reviewing code with verdict, issues, and checklist",
    taskType: "review",
    template: `**Files:** {{files}}

**Verdict:** {{verdict}}

**Critical Issues:**
{{critical}}

**Warnings:**
{{warnings}}

**Suggestions:**
{{suggestions}}

**Checklist:**
{{checklist}}`,
    variables: [
      { name: "files", description: "Files to review", required: true },
      { name: "verdict", description: "APPROVED / CHANGES_REQUESTED / REJECTED", required: true },
      { name: "critical", description: "Critical issues (bulleted)", required: false, defaultValue: "—" },
      { name: "warnings", description: "Warnings (bulleted)", required: false, defaultValue: "—" },
      { name: "suggestions", description: "Improvement suggestions", required: false, defaultValue: "—" },
      { name: "checklist", description: "Criteria checklist", required: true },
    ],
    source: "built_in",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-test-writing",
    name: "Test Writing",
    description: "Template for writing tests with TDD cycle",
    taskType: "test",
    template: `**Module:** {{moduleName}}
**Test Type:** {{testType}}
**Coverage Target:** {{coverageTarget}}

**TDD Cycle:**
1. Write a failing test for {{scenario}}
2. Run: {{runCommand}}
3. Write minimal code
4. Run: {{runCommand}}
5. Refactor while keeping tests passing`,
    variables: [
      { name: "moduleName", description: "Module or component to test", required: true },
      {
        name: "testType",
        description: "unit / integration / e2e / smoke / contract / perf",
        required: false,
        defaultValue: "unit",
      },
      { name: "coverageTarget", description: "Required coverage percentage", required: false, defaultValue: "80%" },
      { name: "scenario", description: "Scenario to test", required: true },
      { name: "runCommand", description: "Test runner command", required: false, defaultValue: "npm test" },
    ],
    source: "built_in",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-refactoring",
    name: "Refactoring",
    description: "Template for refactoring code with principles and steps",
    taskType: "refactor",
    template: `**Goal:** {{goal}}

**Affected Files:**
- {{files}}

**Principles:** {{principles}}

**Work Steps:**
{{steps}}

**Criteria:**
- {{acceptanceCriteria}}`,
    variables: [
      { name: "goal", description: "Refactoring goal", required: true },
      { name: "files", description: "Affected files (full path per line)", required: true },
      {
        name: "principles",
        description: "Guiding principles (SOLID, DRY, KISS, Clean Code)",
        required: false,
        defaultValue: "Clean Code, SOLID",
      },
      { name: "steps", description: "Work steps (one per line)", required: true },
      { name: "acceptanceCriteria", description: "Refactoring success criteria", required: true },
    ],
    source: "built_in",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-investigation",
    name: "Investigation",
    description: "Template for investigating a problem with structured verdict",
    taskType: "analysis",
    template: `**Problem:** {{problem}}
**Context:** {{context}}

**Sources:**
{{sources}}

**What was tried:**
{{tried}}

**Final Report:**
- Verdict: {{verdict}}
- What worked: {{whatWorked}}
- What didn't: {{whatDidnt}}
- Surprises: {{surprises}}
- Recommendation: {{recommendation}}`,
    variables: [
      { name: "problem", description: "Problem to investigate", required: true },
      { name: "context", description: "Context and background", required: true },
      {
        name: "sources",
        description: "Available sources and tools",
        required: false,
        defaultValue: "Git history, logs, docs",
      },
      { name: "tried", description: "What was tried previously", required: false, defaultValue: "—" },
      { name: "verdict", description: "VALIDATED / PARTIAL / INVALIDATED", required: true },
      { name: "whatWorked", description: "What worked", required: true },
      { name: "whatDidnt", description: "What didn't work", required: true },
      { name: "surprises", description: "Unexpected findings", required: false, defaultValue: "—" },
      { name: "recommendation", description: "Final recommendation", required: true },
    ],
    source: "built_in",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-multi-step",
    name: "Multi-Step Workflow",
    description: "Template for multi-step workflows with dependencies",
    taskType: "workflow",
    template: `**Goal:** {{goal}}

**Tasks:**
{{tasks}}

**Notes:**
{{notes}}`,
    variables: [
      { name: "goal", description: "Overall workflow goal", required: true },
      {
        name: "tasks",
        description: "Tasks (one per line — use format: [Description] ← [Dependencies])",
        required: true,
      },
      { name: "notes", description: "Additional notes", required: false, defaultValue: "—" },
    ],
    source: "built_in",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "tpl-documentation",
    name: "Documentation",
    description: "Template for writing documentation",
    taskType: "doc",
    template: `**Topic:** {{topic}}
**Target Audience:** {{audience}}

**Required Outputs:**
{{outputs}}

**Key Points:**
{{keyPoints}}

**Additional Notes:**
{{notes}}`,
    variables: [
      { name: "topic", description: "Topic to document", required: true },
      {
        name: "audience",
        description: "Target audience (user / developer / contributor)",
        required: false,
        defaultValue: "developer",
      },
      { name: "outputs", description: "Required outputs (README, API docs, usage guide, etc.)", required: true },
      { name: "keyPoints", description: "Key points to cover", required: true },
      { name: "notes", description: "Additional notes", required: false, defaultValue: "—" },
    ],
    source: "built_in",
    usageCount: 0,
    createdAt: new Date().toISOString(),
  },
];
