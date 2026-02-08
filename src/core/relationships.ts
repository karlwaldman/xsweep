/**
 * Relationship analysis: mutual follows, non-mutual detection.
 * Ported from x-follow-extractor.js.
 */

import type { UserProfile, AuditCounts, AccountHealth } from "./types";

export function computeAuditCounts(
  users: UserProfile[],
  followerIds: Set<string>,
): AuditCounts {
  const followingUsers = users.filter((u) => u.isFollowing !== false);
  const followerOnlyUsers = users.filter((u) => u.isFollowing === false);

  return {
    total: followingUsers.length,
    active: followingUsers.filter((u) => u.status === "active").length,
    inactive: followingUsers.filter((u) => u.status === "inactive").length,
    suspended: followingUsers.filter((u) => u.status === "suspended").length,
    deactivated: followingUsers.filter((u) => u.status === "deactivated")
      .length,
    noTweets: followingUsers.filter((u) => u.status === "no_tweets").length,
    errors: followingUsers.filter((u) => u.status === "error").length,
    mutual: followingUsers.filter((u) => followerIds.has(u.userId)).length,
    notFollowingBack: followingUsers.filter((u) => !followerIds.has(u.userId))
      .length,
    notFollowedBack: followerOnlyUsers.length,
    followersOnly: followerOnlyUsers.length,
  };
}

export function computeAccountHealth(
  users: UserProfile[],
  totalFollowers: number,
  followerIds: Set<string>,
): AccountHealth {
  // Only consider users you follow for health scoring
  const followingUsers = users.filter((u) => u.isFollowing !== false);
  const total = followingUsers.length;
  if (total === 0) {
    return {
      score: 0,
      followRatio: 0,
      inactivePercent: 0,
      mutualPercent: 0,
      engagementPotential: 0,
    };
  }

  const inactive = followingUsers.filter(
    (u) =>
      u.status === "inactive" ||
      u.status === "suspended" ||
      u.status === "no_tweets",
  ).length;
  const mutual = followingUsers.filter((u) => followerIds.has(u.userId)).length;

  const followRatio = totalFollowers > 0 ? totalFollowers / total : 0;
  const inactivePercent = (inactive / total) * 100;
  const mutualPercent = (mutual / total) * 100;

  // Engagement potential: active users who follow back
  const activeMutual = followingUsers.filter(
    (u) => u.status === "active" && followerIds.has(u.userId),
  ).length;
  const engagementPotential = total > 0 ? (activeMutual / total) * 100 : 0;

  // Health score (0-100)
  let score = 50;
  // Follow ratio bonus (ideal is >1.0)
  if (followRatio >= 2.0) score += 20;
  else if (followRatio >= 1.0) score += 15;
  else if (followRatio >= 0.5) score += 5;
  else score -= 10;

  // Low inactive penalty
  if (inactivePercent < 5) score += 15;
  else if (inactivePercent < 15) score += 10;
  else if (inactivePercent < 30) score += 0;
  else score -= 15;

  // Mutual follow bonus
  if (mutualPercent > 60) score += 15;
  else if (mutualPercent > 40) score += 10;
  else if (mutualPercent > 20) score += 5;
  else score -= 5;

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    followRatio: Math.round(followRatio * 100) / 100,
    inactivePercent: Math.round(inactivePercent * 10) / 10,
    mutualPercent: Math.round(mutualPercent * 10) / 10,
    engagementPotential: Math.round(engagementPotential * 10) / 10,
  };
}

export function getMutualFollows(users: UserProfile[]): UserProfile[] {
  return users.filter((u) => u.isMutual);
}

export function getNotFollowingBack(users: UserProfile[]): UserProfile[] {
  return users.filter((u) => !u.isFollower);
}

export function getInactiveUsers(
  users: UserProfile[],
  whitelist: Set<string> = new Set(),
): UserProfile[] {
  return users.filter((u) => {
    if (whitelist.has(u.username.toLowerCase())) return false;
    return (
      u.status === "inactive" ||
      u.status === "suspended" ||
      u.status === "deactivated" ||
      u.status === "no_tweets"
    );
  });
}
