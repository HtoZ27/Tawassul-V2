import { randomUUID } from "node:crypto";

export interface EvaluationSession {
  sessionId: string;
  featureId: string;
  startedAt: string;
  completedAt?: string;
  totalRounds: number;
  totalIssues: number;
  resolvedIssues: number;
  status: "active" | "completed" | "abandoned";
}

export class EvaluationSessionManager {
  private sessions = new Map<string, EvaluationSession>();
  private readonly MAX_SESSIONS = 100;

  startSession(featureId: string): EvaluationSession {
    this.evictStale();

    const sessionId = `eval-sess-${randomUUID().slice(0, 8)}`;
    const session: EvaluationSession = {
      sessionId,
      featureId,
      startedAt: new Date().toISOString(),
      totalRounds: 0,
      totalIssues: 0,
      resolvedIssues: 0,
      status: "active",
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): EvaluationSession | undefined {
    return this.sessions.get(sessionId);
  }

  getActiveSessions(featureId?: string): EvaluationSession[] {
    const active = [...this.sessions.values()].filter((s) => s.status === "active");
    return featureId ? active.filter((s) => s.featureId === featureId) : active;
  }

  updateSession(
    sessionId: string,
    delta: {
      totalRounds?: number;
      totalIssues?: number;
      resolvedIssues?: number;
      addResolvedIssues?: number;
      status?: EvaluationSession["status"];
    },
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (delta.totalRounds !== undefined) session.totalRounds = delta.totalRounds;
    if (delta.totalIssues !== undefined) session.totalIssues = delta.totalIssues;
    if (delta.resolvedIssues !== undefined) session.resolvedIssues = delta.resolvedIssues;
    if (delta.addResolvedIssues !== undefined) session.resolvedIssues += delta.addResolvedIssues;
    if (delta.status === "completed" || delta.status === "abandoned") {
      session.status = delta.status;
      session.completedAt = new Date().toISOString();
    }

    return true;
  }

  completeSession(sessionId: string): boolean {
    return this.updateSession(sessionId, { status: "completed" });
  }

  getSessionSummary(featureId: string): string {
    const sessions = [...this.sessions.values()].filter((s) => s.featureId === featureId);
    if (sessions.length === 0) return `لا توجد جلسات تقييم للميزة ${featureId}`;

    const totalRounds = sessions.reduce((sum, s) => sum + s.totalRounds, 0);
    const totalIssues = sessions.reduce((sum, s) => sum + s.totalIssues, 0);
    const resolvedIssues = sessions.reduce((sum, s) => sum + s.resolvedIssues, 0);

    return [
      `## جلسات تقييم: ${featureId}`,
      `- الجلسات: ${sessions.length}`,
      `- إجمالي الجولات: ${totalRounds}`,
      `- إجمالي المشكلات: ${totalIssues}`,
      `- محلولة: ${resolvedIssues}`,
      `- متبقية: ${totalIssues - resolvedIssues}`,
    ].join("\n");
  }

  get totalSessionCount(): number {
    return this.sessions.size;
  }

  toJSON(): EvaluationSession[] {
    return [...this.sessions.values()];
  }

  fromJSON(data: EvaluationSession[]): void {
    this.sessions.clear();
    for (const s of data) {
      this.sessions.set(s.sessionId, s);
    }
    this.evictStale();
  }

  evictStale(): void {
    if (this.sessions.size < this.MAX_SESSIONS) return;

    const sorted = [...this.sessions.entries()]
      .filter(([, s]) => s.status === "completed" || s.status === "abandoned")
      .sort(([, a], [, b]) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    const excess = this.sessions.size - this.MAX_SESSIONS;
    for (let i = 0; i < Math.min(excess, sorted.length); i++) {
      this.sessions.delete(sorted[i]![0]);
    }
  }
}
