

export interface TaskContext {
  description: string;
  files: string[];
  role: string;
}

export function scoreComplexity(task: TaskContext): "simple" | "medium" | "complex" {
  let score = 0;

  if (task.files.length > 10) score += 3;
  else if (task.files.length >= 3) score += 2;
  else score += 1;

  const wordCount = task.description.split(/\s+/).length;
  if (wordCount > 50) score += 3;
  else if (wordCount > 20) score += 2;

  const complexKw = ['refactor', 'architecture', 'migration', 'concurrent', 'security'];
  for (const kw of complexKw) {
    if (task.description.toLowerCase().includes(kw)) score += 2;
  }

  if (score >= 6) return "complex";
  if (score >= 2) return "medium";
  return "simple";
}
