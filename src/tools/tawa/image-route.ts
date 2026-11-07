import { tool } from "../../tool.ts";
import { t } from "../../translations.ts";
import type { ToolDefinition } from "../../tool.ts";
import type { ImageRouter } from "../../services/image-router/index.ts";

export function buildImageRouteTool(imageRouter: ImageRouter, getAgents: () => string[]): ToolDefinition {
  return tool({
    description:
      "Route an image or visual description to the most suitable agent (read-only suggestion, creates no handoffs).",
    args: {
      description: tool.schema.string().describe("Image or visual description"),
      filename: tool.schema.string().optional().describe("Image filename (optional)"),
      mimeType: tool.schema.string().optional().describe("Mime type (optional)"),
    },
    async execute(args) {
      const description = String(args.description || "").trim();
      if (!description) {
        return { title: "Image Route", output: t("twSpecifyImage") };
      }
      const agents = getAgents();
      const result = imageRouter.analyzeAndRoute(description, agents, {
        mimeType: args.mimeType,
        filename: args.filename,
      });

      const lines: string[] = [
        `## 🖼️ Image Route`,
        ``,
        `**Type:** ${result.analysis.type}`,
        `**Suggested agent:** ${result.suggestedAgent}`,
        `**Reason:** ${result.reason}`,
      ];
      if (result.fallbackAgent) lines.push(`**Fallback:** ${result.fallbackAgent}`);
      lines.push(
        `**Suitable:** ${result.suitable ? t("twYes") : t("twNo")}`,
        `**Confidence:** ${result.analysis.confidence.toFixed(2)}`,
      );
      if (result.analysis.confidence < 0.6) {
        lines.push("", t("twLowConfidence"));
      }

      return {
        title: "Image Route",
        output: lines.join("\n"),
        metadata: {
          suggestedAgent: result.suggestedAgent,
          fallbackAgent: result.fallbackAgent ?? null,
          type: result.analysis.type,
          confidence: result.analysis.confidence,
          suitable: result.suitable,
        },
      };
    },
  });
}
