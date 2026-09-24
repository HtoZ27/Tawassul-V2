
import { getAllowedToolsForRole } from "../security-policy.ts";
import { resolveRole } from "../utils/agent.ts";
import type { AgentTemplate } from "./agent-data.ts";

export function escapeYamlValue(val: string): string {
  if (!val) return '""';
  if (/^(allow|deny|ask)$/.test(val)) return val;
  if (val.includes("\n")) {
    return `|\n${val
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n")}`;
  }
  if (/[:#[{"']/.test(val) || val.includes('"')) {
    if (val.includes('"')) {
      if (val.includes("'")) {
        return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      }
      return `'${val}'`;
    }
    return `"${val}"`;
  }
  return `"${val}"`;
}

export function buildAllowedToolsSection(role: string): string {
  const allowed = getAllowedToolsForRole(role);
  if (allowed.length === 0) return "";
  return `### Allowed tools (tawassul)\nOK ${allowed.join(", ")}\n\n`;
}

export const DISCLOSURE_SECTION = [
  "",
  "### Disclosure Rule (R-011)",
  "",
  "- Hide no error from the user: every failure in your tools or analysis must be stated explicitly with its cause.",
  "- Claim nothing you have not verified on disk: distinguish (disk-proven) from (inference).",
  "- When sources contradict, present the contradiction itself — never resolve it silently.",
  "- Disclose without disrupting: state errors and contradictions in your output and keep working — never turn disclosure into repeated questions; ask the user only when genuinely blocked.",
].join("\n");

export function generateAgentMd(template: AgentTemplate, model?: string): string {
  if (template.raw) return template.instructions;

  const quoteIfNeeded = (val: string): string => {
    if (/^(allow|deny|ask)$/.test(val)) return val;
    if (val.includes('"') && val.includes("'")) {
      return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    if (val.includes('"')) return `'${val}'`;
    return `"${val}"`;
  };

  const permissionLines: string[] = [];
  if (typeof template.permissions.edit === "string") {
    permissionLines.push(`edit: ${quoteIfNeeded(template.permissions.edit)}`);
  } else if (template.permissions.edit && typeof template.permissions.edit === "object") {
    const editLines = Object.entries(template.permissions.edit)
      .map(([k, v]) => `    ${JSON.stringify(k)}: ${v}`)
      .join("\n");
    permissionLines.push(`edit:\n${editLines}`);
  }
  if (typeof template.permissions.bash === "string") {
    permissionLines.push(`bash: ${quoteIfNeeded(template.permissions.bash)}`);
  } else if (template.permissions.bash && Object.keys(template.permissions.bash).length <= 2) {
    const bashLines = Object.entries(template.permissions.bash)
      .map(([k, v]) => `    ${JSON.stringify(k)}: ${v}`)
      .join("\n");
    permissionLines.push(`bash:\n${bashLines}`);
  }
  if (template.permissions.external_directory) {
    permissionLines.push(`external_directory: ${quoteIfNeeded(template.permissions.external_directory)}`);
  }
  if (template.permissions.webfetch) {
    permissionLines.push(`webfetch: ${quoteIfNeeded(template.permissions.webfetch)}`);
  }
  if (template.permissions.websearch) {
    permissionLines.push(`websearch: ${quoteIfNeeded(template.permissions.websearch)}`);
  }
  if (template.permissions.task) {
    if (typeof template.permissions.task === "object" && template.permissions.task !== null) {
      const taskLines = Object.entries(template.permissions.task)
        .map(([k, v]) => `    ${JSON.stringify(k)}: ${v}`)
        .join("\n");
      permissionLines.push(`task:\n${taskLines}`);
    } else {
      permissionLines.push(`task: ${quoteIfNeeded(template.permissions.task as string)}`);
    }
  }

  const responsibilitiesYaml = template.responsibilities?.length
    ? `\nresponsibilities:\n${template.responsibilities.map((r) => `  - ${escapeYamlValue(r)}`).join("\n")}`
    : "";

  const responsibilitiesSection = template.responsibilities?.length
    ? `\n### Responsibilities\n${template.responsibilities.map((r) => `- ${r}`).join("\n")}\n`
    : "";

  const allowedToolsSection = buildAllowedToolsSection(resolveRole(template.name) ?? template.name);

  return `---
name: ${escapeYamlValue(template.name)}
role: ${escapeYamlValue(template.role)}
capability: ${escapeYamlValue(template.capability)}
description: ${escapeYamlValue(template.description)}
mode: ${escapeYamlValue(template.mode)}${model ? `\nmodel: ${escapeYamlValue(model)}` : ""}
permission:
  ${permissionLines.join("\n  ")}${responsibilitiesYaml}
---
${responsibilitiesSection}
${allowedToolsSection}
${template.instructions}${DISCLOSURE_SECTION}`;
}
