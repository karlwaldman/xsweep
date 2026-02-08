/**
 * Health recommendations engine.
 * Generates prioritized, actionable recommendations with estimated point gains.
 */

import type { AccountHealth, AuditCounts } from "./types";

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  estimatedGain: number;
  target: "audit" | "unfollow" | "lists";
  targetFilter?: string;
  priority: number; // lower = higher priority
}

export interface HealthGrade {
  letter: string;
  label: string;
  color: string;
}

export function getHealthGrade(score: number): HealthGrade {
  if (score >= 90)
    return { letter: "A+", label: "Excellent", color: "text-x-green" };
  if (score >= 80)
    return { letter: "A", label: "Great shape", color: "text-x-green" };
  if (score >= 70)
    return {
      letter: "B",
      label: "Good, room to improve",
      color: "text-x-green",
    };
  if (score >= 60)
    return { letter: "C", label: "Needs attention", color: "text-x-yellow" };
  if (score >= 40)
    return {
      letter: "D",
      label: "Significant cleanup needed",
      color: "text-x-orange",
    };
  return { letter: "F", label: "Major overhaul needed", color: "text-x-red" };
}

export function getRecommendations(
  health: AccountHealth,
  counts: AuditCounts,
): Recommendation[] {
  const recs: Recommendation[] = [];

  // Inactive accounts recommendation
  if (health.inactivePercent > 5 && counts.inactive > 0) {
    const gain =
      health.inactivePercent > 30 ? 15 : health.inactivePercent > 15 ? 10 : 5;
    recs.push({
      id: "clean-inactive",
      title: `Unfollow ${counts.inactive} inactive accounts`,
      description: `${health.inactivePercent}% of your following is inactive`,
      estimatedGain: gain,
      target: "unfollow",
      priority: 1,
    });
  }

  // Suspended accounts
  if (counts.suspended > 0) {
    recs.push({
      id: "clean-suspended",
      title: `Remove ${counts.suspended} suspended accounts`,
      description: "Suspended accounts add no value",
      estimatedGain: Math.min(10, counts.suspended),
      target: "audit",
      targetFilter: "suspended",
      priority: 0,
    });
  }

  // No tweets accounts
  if (counts.noTweets > 0) {
    recs.push({
      id: "clean-no-tweets",
      title: `Remove ${counts.noTweets} empty accounts`,
      description: "Accounts that never tweeted",
      estimatedGain: Math.min(5, counts.noTweets),
      target: "audit",
      targetFilter: "no_tweets",
      priority: 2,
    });
  }

  // Follow ratio
  if (health.followRatio < 1.0) {
    const gain = health.followRatio < 0.5 ? 15 : 10;
    recs.push({
      id: "improve-ratio",
      title: `Follow ratio is ${health.followRatio}x`,
      description: "Unfollow to improve your follower-to-following ratio",
      estimatedGain: gain,
      target: "unfollow",
      priority: 3,
    });
  }

  // Low mutual percentage
  if (health.mutualPercent < 40 && counts.notFollowingBack > 0) {
    const gain = health.mutualPercent < 20 ? 10 : 5;
    recs.push({
      id: "review-non-mutual",
      title: `Review ${counts.notFollowingBack} non-mutual follows`,
      description: `Only ${health.mutualPercent}% follow you back`,
      estimatedGain: gain,
      target: "audit",
      targetFilter: "non_mutual",
      priority: 4,
    });
  }

  // Sort by priority
  recs.sort((a, b) => a.priority - b.priority);

  return recs.slice(0, 3);
}
