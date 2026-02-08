export interface UserProfile {
  userId: string;
  username: string;
  displayName: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  tweetCount: number;
  lastTweetDate: string | null;
  daysSinceLastTweet: number | null;
  status: UserStatus;
  isFollower: boolean;
  isMutual: boolean;
  isVerified: boolean;
  listIds: number[];
  scannedAt: string;
  profileImageUrl: string;
}

export type UserStatus =
  | "active"
  | "inactive"
  | "suspended"
  | "deactivated"
  | "no_tweets"
  | "error";

export interface SmartList {
  id?: number;
  name: string;
  type: "keyword" | "ai" | "imported";
  keywords: string[];
  description: string;
  createdAt: string;
  updatedAt: string;
  xListId?: string; // linked X/Twitter list ID
}

export interface Snapshot {
  id?: number;
  date: string;
  totalFollowing: number;
  totalFollowers: number;
  mutualCount: number;
  inactiveCount: number;
  suspendedCount: number;
  userIds: string[];
}

export interface UnfollowEntry {
  id?: number;
  userId: string;
  username: string;
  date: string;
  reason: string;
}

export interface ScanProgress {
  phase:
    | "idle"
    | "collecting-ids"
    | "scanning-users"
    | "computing-relationships"
    | "complete"
    | "error";
  totalIds: number;
  scannedUsers: number;
  currentPage: number;
  error?: string;
}

export interface AuditCounts {
  total: number;
  active: number;
  inactive: number;
  suspended: number;
  deactivated: number;
  noTweets: number;
  errors: number;
  mutual: number;
  notFollowingBack: number;
  notFollowedBack: number;
}

export interface AccountHealth {
  score: number;
  followRatio: number;
  inactivePercent: number;
  mutualPercent: number;
  engagementPotential: number;
}

// Message types between content script, background, and side panel
export type MessageType =
  | { type: "START_SCAN" }
  | { type: "STOP_SCAN" }
  | { type: "START_UNFOLLOW"; userIds: string[]; dryRun: boolean }
  | { type: "STOP_UNFOLLOW" }
  | { type: "SCAN_PROGRESS"; data: ScanProgress }
  | { type: "SCAN_COMPLETE"; data: { totalUsers: number } }
  | { type: "SCAN_ERROR"; error: string }
  | {
      type: "UNFOLLOW_PROGRESS";
      data: { done: number; total: number; current: string };
    }
  | { type: "UNFOLLOW_STARTED"; data: { total: number; done: number } }
  | { type: "UNFOLLOW_COMPLETE"; data: { count: number } }
  | { type: "CATEGORIZE_AI"; listId: number; apiKey: string }
  | { type: "CATEGORIZE_AI_COMPLETE"; listId: number }
  | { type: "AUTH_STATUS"; authenticated: boolean }
  | { type: "GET_AUTH_STATUS" }
  | { type: "OPEN_SIDEPANEL" }
  | { type: "STORE_USERS_BATCH"; users: UserProfile[] }
  | {
      type: "FINALIZE_SCAN";
      followerIds: string[];
      followingIds: string[];
    }
  | { type: "FETCH_X_LISTS" }
  | { type: "FETCH_X_LIST_MEMBERS"; listId: string }
  | {
      type: "CREATE_X_LIST";
      name: string;
      description: string;
      mode: "public" | "private";
    }
  | { type: "ADD_X_LIST_MEMBER"; listId: string; userId: string };
