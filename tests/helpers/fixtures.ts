import type { UserProfile, SmartList, Snapshot } from "@/core/types";

export function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: "100",
    username: "testuser",
    displayName: "Test User",
    bio: "Just a test account",
    followerCount: 500,
    followingCount: 300,
    tweetCount: 1200,
    lastTweetDate: "2026-01-15T12:00:00.000Z",
    daysSinceLastTweet: 24,
    status: "active",
    isFollowing: true,
    isFollower: true,
    isMutual: true,
    isVerified: false,
    location: "",
    url: "",
    createdAt: "2025-01-01T00:00:00.000Z",
    isBlueVerified: false,
    listIds: [],
    scannedAt: "2026-02-08T10:00:00.000Z",
    profileImageUrl: "https://pbs.twimg.com/default.jpg",
    ...overrides,
  };
}

export function makeList(overrides: Partial<SmartList> = {}): SmartList {
  return {
    id: 1,
    name: "Tech",
    type: "keyword",
    keywords: ["developer", "engineer", "coding"],
    description: "Tech people",
    createdAt: "2026-02-08T10:00:00.000Z",
    updatedAt: "2026-02-08T10:00:00.000Z",
    ...overrides,
  };
}

export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    date: "2026-02-08T10:00:00.000Z",
    totalFollowing: 500,
    totalFollowers: 300,
    mutualCount: 200,
    inactiveCount: 50,
    suspendedCount: 10,
    userIds: ["100", "200", "300"],
    ...overrides,
  };
}
