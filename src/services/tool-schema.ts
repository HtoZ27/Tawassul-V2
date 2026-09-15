export interface StructuredField {
  key: string;
  label: string;
  value: string;
  type?: "code" | "text";
}

export interface StructuredToolResult {
  title?: string;
  summary?: string;
  fields?: StructuredField[];
  actions?: {
    label: string;
    description: string;
    tool: string;
    args: Record<string, unknown>;
  }[];
  metadata?: Record<string, unknown>;
}

export function toToolResult(input: string | StructuredToolResult): string {
  if (typeof input === "string") return input;
  const parts: string[] = [];
  if (input.title) parts.push(input.title);
  if (input.summary) parts.push(input.summary);
  if (input.fields?.length) {
    for (const f of input.fields) {
      parts.push(`${f.label}: ${f.value}`);
    }
  }
  if (input.actions?.length) {
    parts.push("Available actions:");
    for (const a of input.actions) {
      parts.push(`  - ${a.description} (/${a.tool})`);
    }
  }
  return parts.join("\n");
}
