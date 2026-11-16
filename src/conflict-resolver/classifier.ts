import type { ClassifierInput, ClassifierOutput } from "./types.ts";

type TreeNode = {
  feature?: keyof ClassifierInput;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
  prediction?: ClassifierOutput["action"];
  confidence?: number;
};


export type ClassifierParams = {
  agentBusy: number;
  fileConflict: number;
  errorCount: number;
  activeHandoffs: number;
  capabilityMatch: number;
};

export const DEFAULT_CLASSIFIER_PARAMS: ClassifierParams = {
  agentBusy: 0.5,
  fileConflict: 0.5,
  errorCount: 3,
  activeHandoffs: 2,
  capabilityMatch: 0.5,
};

function buildTree(params: ClassifierParams): TreeNode {
  return {
    feature: "agentBusy",
    threshold: params.agentBusy,
    left: {
      feature: "fileConflict",
      threshold: params.fileConflict,
      left: {
        feature: "errorCount",
        threshold: params.errorCount,
        left: {
          feature: "capabilityMatch",
          threshold: params.capabilityMatch,
          left: { prediction: "allow", confidence: 0.9 },
          right: { prediction: "reroute", confidence: 0.75 },
        },
        right: { prediction: "reroute", confidence: 0.8 },
      },
      right: { prediction: "reroute", confidence: 0.85 },
    },
    right: {
      feature: "activeHandoffs",
      threshold: params.activeHandoffs,
      left: { prediction: "warn", confidence: 0.7 },
      right: { prediction: "block", confidence: 0.9 },
    },
  };
}


const _treeCache = new Map<string, TreeNode>();
function getCachedTree(params: ClassifierParams): TreeNode {
  const key = JSON.stringify(params);
  let t = _treeCache.get(key);
  if (!t) {
    t = buildTree(params);
    _treeCache.set(key, t);
    
    if (_treeCache.size > 32) {
      const first = _treeCache.keys().next().value!;
      _treeCache.delete(first);
    }
  }
  return t;
}

export function classify(input: ClassifierInput, params: Partial<ClassifierParams> = {}): ClassifierOutput {
  const merged: ClassifierParams = { ...DEFAULT_CLASSIFIER_PARAMS, ...params };
  let node = getCachedTree(merged);

  while (node.prediction === undefined) {
    if (node.feature === undefined || node.threshold === undefined) {
      return { action: "allow", confidence: 0.5 };
    }
    let value = input[node.feature];
    if (typeof value === "boolean") {
      value = value ? 1 : 0;
    }
    if (typeof value === "number" && value < node.threshold) {
      if (!node.left) return { action: "allow", confidence: 0.5 };
      node = node.left;
    } else {
      if (!node.right) return { action: "allow", confidence: 0.5 };
      node = node.right;
    }
  }

  return {
    action: node.prediction,
    confidence: node.confidence ?? 0.5,
  };
}
