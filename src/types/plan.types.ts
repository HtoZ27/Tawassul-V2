export interface SubTask {
  id: string
  description: string
  files: string[]
  agent: string
  dependencies: string[]
  successCriteria: string[]
  status: 'pending' | 'running' | 'done' | 'failed' | 'blocked'
}

export interface ExecutionReport {
  taskId: string
  subtasks: SubTask[]
  results: AgentResult[]
  startTime: number
  endTime: number
  status: 'success' | 'partial' | 'failed'
}

export interface AgentResult {
  agentId: string
  output: string
  files: string[]
  metrics: Record<string, number>
  error?: string
}

export interface MergedReport {
  summary: string
  findings: Finding[]
  recommendations: string[]
  qualityScore: number
}

export interface Finding {
  file: string
  line?: number
  message: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export interface HealResult {
  success: boolean
  reason?: string
  action?: string
  fallback?: string
}

export interface ValidationResult {
  valid: boolean
  confidence: number
  conflicts: string[]
}
