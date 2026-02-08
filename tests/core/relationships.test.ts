import { describe, it, expect } from "vitest";
import {
  computeAuditCounts,
  computeAccountHealth,
  getMutualFollows,
  getNotFollowingBack,
  getInactiveUsers,
} from "@/core/relationships";
import { makeUser } from "../helpers/fixtures";

describe("computeAuditCounts", () => {
  it("counts users by status and relationship", () => {
    const users = [
      makeUser({ userId: "1", status: "active" }),
      makeUser({ userId: "2", status: "active" }),
      makeUser({ userId: "3", status: "inactive" }),
      makeUser({ userId: "4", status: "suspended" }),
      makeUser({ userId: "5", status: "deactivated" }),
      makeUser({ userId: "6", status: "no_tweets" }),
      makeUser({ userId: "7", status: "error" }),
    ];
    // Followers: 1, 3, 5 follow us back
    const followerIds = new Set(["1", "3", "5"]);

    const counts = computeAuditCounts(users, followerIds);

    expect(counts.total).toBe(7);
    expect(counts.active).toBe(2);
    expect(counts.inactive).toBe(1);
    expect(counts.suspended).toBe(1);
    expect(counts.deactivated).toBe(1);
    expect(counts.noTweets).toBe(1);
    expect(counts.errors).toBe(1);
    expect(counts.mutual).toBe(3);
    expect(counts.notFollowingBack).toBe(4);
    // notFollowedBack: followerIds not in our following list = none here since all 3 are in users
    expect(counts.notFollowedBack).toBe(0);
  });

  it("handles empty users array", () => {
    const counts = computeAuditCounts([], new Set());
    expect(counts.total).toBe(0);
    expect(counts.active).toBe(0);
    expect(counts.mutual).toBe(0);
    expect(counts.notFollowingBack).toBe(0);
    expect(counts.notFollowedBack).toBe(0);
  });

  it("counts notFollowedBack for followers not in following list", () => {
    const users = [makeUser({ userId: "1" })];
    // Follower "99" is not in our following list
    const followerIds = new Set(["1", "99"]);

    const counts = computeAuditCounts(users, followerIds);
    expect(counts.notFollowedBack).toBe(1);
  });
});

describe("computeAccountHealth", () => {
  it("returns 0 score for empty users", () => {
    const health = computeAccountHealth([], 0, new Set());
    expect(health.score).toBe(0);
    expect(health.followRatio).toBe(0);
    expect(health.inactivePercent).toBe(0);
    expect(health.mutualPercent).toBe(0);
    expect(health.engagementPotential).toBe(0);
  });

  it("calculates high health score scenario", () => {
    // 10 active users, all mutual, high follower ratio
    const users = Array.from({ length: 10 }, (_, i) =>
      makeUser({ userId: String(i), status: "active" }),
    );
    const followerIds = new Set(users.map((u) => u.userId));

    const health = computeAccountHealth(users, 25, followerIds);

    // followRatio = 25/10 = 2.5 => +20
    // inactivePercent = 0% => +15
    // mutualPercent = 100% => +15
    // score = 50 + 20 + 15 + 15 = 100
    expect(health.score).toBe(100);
    expect(health.followRatio).toBe(2.5);
    expect(health.inactivePercent).toBe(0);
    expect(health.mutualPercent).toBe(100);
    expect(health.engagementPotential).toBe(100);
  });

  it("calculates low health score scenario", () => {
    // 10 users: 3 active, 7 inactive, low follower ratio, no mutuals
    const users = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeUser({ userId: String(i), status: "active" }),
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        makeUser({ userId: String(i + 3), status: "inactive" }),
      ),
    ];
    const followerIds = new Set<string>(); // nobody follows back

    const health = computeAccountHealth(users, 2, followerIds);

    // followRatio = 2/10 = 0.2 => -10
    // inactivePercent = 70% => -15
    // mutualPercent = 0% => -5
    // score = 50 - 10 - 15 - 5 = 20
    expect(health.score).toBe(20);
    expect(health.followRatio).toBe(0.2);
    expect(health.inactivePercent).toBe(70);
    expect(health.mutualPercent).toBe(0);
    expect(health.engagementPotential).toBe(0);
  });

  it("clamps score to 0-100 range", () => {
    // Worst case scenario: should not go below 0
    const users = Array.from({ length: 10 }, (_, i) =>
      makeUser({ userId: String(i), status: "suspended" }),
    );
    const health = computeAccountHealth(users, 0, new Set());
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
  });

  it("rounds followRatio, inactivePercent, mutualPercent correctly", () => {
    const users = Array.from({ length: 3 }, (_, i) =>
      makeUser({ userId: String(i), status: "active" }),
    );
    const followerIds = new Set(["0"]);

    const health = computeAccountHealth(users, 1, followerIds);

    // followRatio = 1/3 = 0.333... => 0.33
    expect(health.followRatio).toBe(0.33);
    // mutualPercent = 1/3 * 100 = 33.333... => 33.3
    expect(health.mutualPercent).toBe(33.3);
  });
});

describe("getMutualFollows", () => {
  it("filters users where isMutual is true", () => {
    const users = [
      makeUser({ userId: "1", isMutual: true }),
      makeUser({ userId: "2", isMutual: false }),
      makeUser({ userId: "3", isMutual: true }),
    ];

    const mutuals = getMutualFollows(users);
    expect(mutuals).toHaveLength(2);
    expect(mutuals.map((u) => u.userId)).toEqual(["1", "3"]);
  });
});

describe("getNotFollowingBack", () => {
  it("filters users where isFollower is false", () => {
    const users = [
      makeUser({ userId: "1", isFollower: true }),
      makeUser({ userId: "2", isFollower: false }),
      makeUser({ userId: "3", isFollower: false }),
    ];

    const result = getNotFollowingBack(users);
    expect(result).toHaveLength(2);
    expect(result.map((u) => u.userId)).toEqual(["2", "3"]);
  });
});

describe("getInactiveUsers", () => {
  it("returns inactive, suspended, deactivated, and no_tweets users", () => {
    const users = [
      makeUser({ userId: "1", status: "active" }),
      makeUser({ userId: "2", status: "inactive" }),
      makeUser({ userId: "3", status: "suspended" }),
      makeUser({ userId: "4", status: "deactivated" }),
      makeUser({ userId: "5", status: "no_tweets" }),
      makeUser({ userId: "6", status: "error" }),
    ];

    const inactive = getInactiveUsers(users);
    expect(inactive).toHaveLength(4);
    expect(inactive.map((u) => u.userId)).toEqual(["2", "3", "4", "5"]);
  });

  it("respects whitelist with case-insensitive username match", () => {
    const users = [
      makeUser({ userId: "1", username: "ImportantBot", status: "inactive" }),
      makeUser({ userId: "2", username: "deadaccount", status: "inactive" }),
      makeUser({
        userId: "3",
        username: "SuspendedFriend",
        status: "suspended",
      }),
    ];

    const whitelist = new Set(["importantbot", "suspendedfriend"]);
    const inactive = getInactiveUsers(users, whitelist);

    expect(inactive).toHaveLength(1);
    expect(inactive[0].userId).toBe("2");
  });
});
