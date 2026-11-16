import { logger } from "../../utils/logger.ts";
import type { ProjectIndexService } from "../project-index/index.ts";
import { planTaskContext } from "./planner.ts";
import type { FeatureIndexLike } from "./planner.ts";
import { renderBundle } from "./render.ts";
import { TASK_CONTEXT_KILL_ENV } from "./types.ts";
import type { TaskContextBundle, TaskContextRequest } from "./types.ts";

export function taskContextEnabled(): boolean {
  const raw = process.env[TASK_CONTEXT_KILL_ENV]?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export type TaskContextOptions = {
  projectIndex: ProjectIndexService;
  featureIndex?: FeatureIndexLike;
  projectRoot?: string;
  enabled?: boolean;
  maxBytes?: number;
};

export type TaskContextStats = {
  bundlesBuilt: number;
  bundleBytes: number;
  enabled: boolean;
};

export class TaskContextService {
  readonly projectKey: string;
  readonly projectRoot: string;
  private readonly projectIndex: ProjectIndexService;
  private readonly featureIndex?: FeatureIndexLike;
  private readonly enabledFlag: boolean;
  private readonly maxBytes?: number;
  private built = 0;
  private bytes = 0;

  constructor(options: TaskContextOptions) {
    this.projectIndex = options.projectIndex;
    this.projectKey = options.projectIndex.projectKey;
    this.projectRoot = options.projectRoot ?? options.projectIndex.projectRoot;
    this.featureIndex = options.featureIndex;
    this.enabledFlag = options.enabled ?? taskContextEnabled();
    this.maxBytes = options.maxBytes;
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  stats(): TaskContextStats {
    return { bundlesBuilt: this.built, bundleBytes: this.bytes, enabled: this.enabledFlag };
  }

  build(request: TaskContextRequest): TaskContextBundle | null {
    if (!this.enabledFlag) return null;
    try {
      const plan = planTaskContext(
        {
          task: request.task,
          declaredFiles: request.declaredFiles ?? [],
          projectRoot: this.projectRoot,
        },
        { index: this.projectIndex, featureIndex: this.featureIndex },
      );
      const base: TaskContextBundle = {
        schemaVersion: 1,
        taskId: request.taskId,
        task: request.task,
        projectKey: this.projectKey,
        revision: this.projectIndex.snapshot().revision,
        items: plan.items,
        missing: plan.missing,
        bytes: 0,
        truncated: plan.truncated,
      };
      const rendered = renderBundle(base, this.maxBytes);
      const bundle: TaskContextBundle = {
        ...base,
        items: rendered.items,
        missing: rendered.missing,
        bytes: rendered.bytes,
        truncated: base.truncated || rendered.truncated,
      };
      this.built += 1;
      this.bytes += bundle.bytes;
      return bundle;
    } catch (e) {
      logger.warn("[tawassul] task context bundle failed:", e);
      return null;
    }
  }

  render(bundle: TaskContextBundle): string {
    if (!this.enabledFlag) return "";
    return renderBundle(bundle, this.maxBytes).text;
  }
}
