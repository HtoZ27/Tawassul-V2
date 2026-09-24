import { z } from 'zod';

export const ImageTypeSchema = z.enum([
  'screenshot',
  'diagram',
  'ui_mockup',
  'architecture',
  'code_snippet',
  'error_message',
  'chart',
  'photo',
  'unknown',
]);

export type ImageType = z.infer<typeof ImageTypeSchema>;

export const ImageAnalysisSchema = z.object({
  type: ImageTypeSchema,
  description: z.string(),
  keywords: z.array(z.string()),
  containsCode: z.boolean().default(false),
  containsError: z.boolean().default(false),
  containsUI: z.boolean().default(false),
  containsDiagram: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
});

export type ImageAnalysis = z.infer<typeof ImageAnalysisSchema>;

export const ImageRoutingResultSchema = z.object({
  suggestedAgent: z.string(),
  fallbackAgent: z.string().optional(),
  reason: z.string(),
  analysis: ImageAnalysisSchema,
  suitable: z.boolean(),
});

export type ImageRoutingResult = z.infer<typeof ImageRoutingResultSchema>;

export class ImageRouter {
  analyzeImage(
    _imageData: string | Buffer,
    metadata?: { mimeType?: string; filename?: string }
  ): ImageAnalysis {
    const filename = metadata?.filename?.toLowerCase() || '';
    const mimeType = metadata?.mimeType || '';

    let type: ImageType = 'unknown';
    let containsCode = false;
    let containsError = false;
    let containsUI = false;
    let containsDiagram = false;

    if (filename.includes('screenshot') || filename.includes('screen')) {
      type = 'screenshot';
    } else if (filename.includes('diagram') || filename.includes('chart')) {
      type = 'diagram';
      containsDiagram = true;
    } else if (filename.includes('ui') || filename.includes('mockup')) {
      type = 'ui_mockup';
      containsUI = true;
    } else if (filename.includes('arch') || filename.includes('structure')) {
      type = 'architecture';
      containsDiagram = true;
    } else if (filename.includes('code') || filename.includes('snippet')) {
      type = 'code_snippet';
      containsCode = true;
    } else if (filename.includes('error') || filename.includes('bug')) {
      type = 'error_message';
      containsError = true;
    } else if (filename.includes('chart') || filename.includes('graph')) {
      type = 'chart';
      containsDiagram = true;
    }

    if (mimeType.startsWith('image/')) {
      if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
      }
    }

    return {
      type,
      description: `Image analysis for ${metadata?.filename || 'unknown'}`,
      keywords: filename.split(/[._-]/).filter(Boolean),
      containsCode,
      containsError,
      containsUI,
      containsDiagram,
      confidence: 0.5,
    };
  }

  routeImage(
    analysis: ImageAnalysis,
    availableAgents: string[]
  ): ImageRoutingResult {
    const agentMap: Record<ImageType, string[]> = {
      screenshot: ['@designer', '@reviewer'],
      diagram: ['@architect', '@analyst'],
      ui_mockup: ['@designer', '@reviewer'],
      architecture: ['@architect', '@analyst'],
      code_snippet: ['@dev', '@reviewer'],
      error_message: ['@dev', '@analyst'],
      chart: ['@analyst', '@doc'],
      photo: ['@designer'],
      unknown: ['@analyst', '@dev'],
    };

    const preferredAgents = agentMap[analysis.type] || ['@analyst'];

    let suggestedAgent = preferredAgents[0] || '@analyst';
    let fallbackAgent: string | undefined;

    for (const agent of preferredAgents) {
      if (availableAgents.includes(agent)) {
        suggestedAgent = agent;
        break;
      }
    }

    for (const agent of preferredAgents) {
      if (agent !== suggestedAgent && availableAgents.includes(agent)) {
        fallbackAgent = agent;
        break;
      }
    }
    if (!fallbackAgent) {
      for (const agent of availableAgents) {
        if (agent !== suggestedAgent) {
          fallbackAgent = agent;
          break;
        }
      }
    }

    return {
      suggestedAgent,
      fallbackAgent,
      reason: `Image type "${analysis.type}" suggests agent "${suggestedAgent}"`,
      analysis,
      suitable: availableAgents.includes(suggestedAgent),
    };
  }

  analyzeAndRoute(
    imageData: string | Buffer,
    availableAgents: string[],
    metadata?: { mimeType?: string; filename?: string }
  ): ImageRoutingResult {
    const analysis = this.analyzeImage(imageData, metadata);
    return this.routeImage(analysis, availableAgents);
  }
}

let instance: ImageRouter | null = null;

export function getImageRouter(): ImageRouter {
  if (!instance) {
    instance = new ImageRouter();
  }
  return instance;
}

export function resetImageRouter(): void {
  instance = null;
}