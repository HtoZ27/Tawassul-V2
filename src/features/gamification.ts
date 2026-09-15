import type { Achievement, AgentScore } from "../conflict-resolver/types.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { t } from "../translations.ts";

interface AgentMetrics {
  completedHandoffs: number;
  records: number;
  helpedAgents: number;
  averageRating: number;
}

const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first-handoff",
    get name() {
      return t("achFirstHandoffName");
    },
    get description() {
      return t("achFirstHandoffDesc");
    },
    icon: "🎯",
    category: "handoff",
    requirement: { type: "count", metric: "completedHandoffs", count: 1 },
    points: 10,
    rarity: "common",
  },
  {
    id: "10-handoffs",
    get name() {
      return t("ach10HandoffsName");
    },
    get description() {
      return t("ach10HandoffsDesc");
    },
    icon: "🏅",
    category: "handoff",
    requirement: { type: "count", metric: "completedHandoffs", count: 10 },
    points: 50,
    rarity: "uncommon",
  },
  {
    id: "50-handoffs",
    get name() {
      return t("ach50HandoffsName");
    },
    get description() {
      return t("ach50HandoffsDesc");
    },
    icon: "🏆",
    category: "handoff",
    requirement: { type: "count", metric: "completedHandoffs", count: 50 },
    points: 200,
    rarity: "rare",
  },
  {
    id: "first-record",
    get name() {
      return t("achFirstRecordName");
    },
    get description() {
      return t("achFirstRecordDesc");
    },
    icon: "📝",
    category: "record",
    requirement: { type: "count", metric: "records", count: 1 },
    points: 10,
    rarity: "common",
  },
  {
    id: "perfect-rating",
    get name() {
      return t("achPerfectRatingName");
    },
    get description() {
      return t("achPerfectRatingDesc");
    },
    icon: "⭐",
    category: "quality",
    requirement: { type: "rating", minRating: 90 },
    points: 100,
    rarity: "uncommon",
  },
  {
    id: "team-player",
    get name() {
      return t("achTeamPlayerName");
    },
    get description() {
      return t("achTeamPlayerDesc");
    },
    icon: "🤝",
    category: "collaboration",
    requirement: { type: "count", metric: "helpedAgents", count: 3 },
    points: 75,
    rarity: "uncommon",
  },
  {
    id: "7-day-streak",
    get name() {
      return t("ach7DayStreakName");
    },
    get description() {
      return t("ach7DayStreakDesc");
    },
    icon: "🔥",
    category: "special",
    requirement: { type: "streak", days: 7 },
    points: 150,
    rarity: "rare",
  },
  {
    id: "legend",
    get name() {
      return t("achLegendName");
    },
    get description() {
      return t("achLegendDesc");
    },
    icon: "👑",
    category: "special",
    requirement: { type: "count", metric: "completedHandoffs", count: 100 },
    points: 500,
    rarity: "legendary",
  },
];

export class GamificationManager {
  private scores: Map<string, AgentScore> = new Map();
  private metrics: Map<string, AgentMetrics> = new Map();
  private ratingCounts: Map<string, number> = new Map();

  recordAction(agent: string, metric: string, value: number = 1): Achievement[] {
    const key = normalizeName(agent);
    let score = this.scores.get(key);
    if (!score) {
      score = { agent: key, points: 0, level: 1, achievements: [], streak: 0, rank: "beginner" };
      this.scores.set(key, score);
    }

    let agentMetrics = this.metrics.get(key);
    if (!agentMetrics) {
      agentMetrics = { completedHandoffs: 0, records: 0, helpedAgents: 0, averageRating: 0 };
      this.metrics.set(key, agentMetrics);
    }

    if (metric === "rating") {
      
      
      const count = (this.ratingCounts.get(key) ?? 0) + 1;
      this.ratingCounts.set(key, count);
      agentMetrics.averageRating =
        (agentMetrics.averageRating * (count - 1) + Math.max(0, Math.min(100, value))) / count;
    } else if (metric in agentMetrics) {
      agentMetrics[metric as keyof AgentMetrics] += value;
      
      
      score.points += value * 10;
    }

    
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if (score.lastActiveDate === today) {
      // already active today — streak unchanged
    } else if (score.lastActiveDate === yesterday) {
      score.streak += 1;
    } else {
      score.streak = 1; 
    }
    score.lastActiveDate = today;

    score.level = Math.floor(score.points / 100) + 1;
    score.rank = this.calculateRank(score.level);

    const newAchievements: Achievement[] = [];
    for (const achievement of ACHIEVEMENTS) {
      if (score.achievements.find((a) => a.id === achievement.id)) continue;
      if (this.checkAchievement(achievement, score, agentMetrics)) {
        score.achievements.push(achievement);
        score.points += achievement.points;
        newAchievements.push(achievement);
      }
    }

    return newAchievements;
  }

  private checkAchievement(achievement: Achievement, score: AgentScore, metrics: AgentMetrics): boolean {
    switch (achievement.requirement.type) {
      case "count": {
        const metricValue = metrics[achievement.requirement.metric as keyof AgentMetrics] ?? 0;
        return metricValue >= achievement.requirement.count;
      }
      case "streak":
        return score.streak >= achievement.requirement.days;
      case "rating":
        return metrics.averageRating > 0 && metrics.averageRating >= achievement.requirement.minRating;
      default:
        return false;
    }
  }

  private calculateRank(level: number): AgentScore["rank"] {
    if (level >= 50) return "legendary";
    if (level >= 30) return "master";
    if (level >= 15) return "expert";
    if (level >= 5) return "intermediate";
    return "beginner";
  }

  getScore(agent: string): AgentScore | undefined {
    return this.scores.get(normalizeName(agent));
  }

  getMetrics(agent: string): AgentMetrics | undefined {
    return this.metrics.get(normalizeName(agent));
  }
}
