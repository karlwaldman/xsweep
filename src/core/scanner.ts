/**
 * Scanner: Collects following/follower IDs and hydrates user profiles.
 * Ported from x-follow-cleaner.js and x-follow-extractor.js.
 */

import { getHeaders, getMyUserId } from "./auth";
import { delay } from "../utils/rate-limiter";
import type { UserProfile, UserStatus, ScanProgress } from "./types";

const INACTIVE_DAYS = 365;

type ProgressCallback = (progress: ScanProgress) => void;

let abortController: AbortController | null = null;

export function stopScan(): void {
  abortController?.abort();
  abortController = null;
}

/**
 * Collect all following or follower IDs using friends/ids or followers/ids endpoint.
 * Returns up to 5000 IDs per page with cursor pagination.
 */
export async function collectIds(
  endpoint: "friends/ids.json" | "followers/ids.json",
  onProgress?: ProgressCallback,
): Promise<string[]> {
  const userId = getMyUserId();
  const allIds: string[] = [];
  let cursor = "-1";
  let page = 0;

  abortController = new AbortController();

  while (true) {
    if (abortController.signal.aborted) break;

    const params = new URLSearchParams({
      user_id: userId,
      count: "5000",
      cursor,
      stringify_ids: "true",
    });

    const resp = await fetch(`https://x.com/i/api/1.1/${endpoint}?${params}`, {
      headers: getHeaders(),
      credentials: "include",
      signal: abortController.signal,
    });

    if (resp.status === 429) {
      console.log("[XSweep] Rate limited on IDs. Waiting 60s...");
      await delay(60, 90);
      continue;
    }

    if (!resp.ok) {
      throw new Error(`${endpoint} error: ${resp.status}`);
    }

    const data = await resp.json();
    const ids: string[] = data.ids || [];
    allIds.push(...ids);
    page++;

    onProgress?.({
      phase: "collecting-ids",
      totalIds: allIds.length,
      scannedUsers: 0,
      currentPage: page,
    });

    const nextCursor = data.next_cursor_str;
    if (!nextCursor || nextCursor === "0") break;
    cursor = nextCursor;

    await delay(2, 4);
  }

  return allIds;
}

/**
 * Hydrate user profiles using friends/list.json or followers/list.json.
 * Includes loop detection for the known friends/list.json bug.
 */
export async function hydrateUsers(
  endpoint: "friends/list.json" | "followers/list.json",
  knownIds: Set<string>,
  onProgress?: ProgressCallback,
  onBatch?: (users: UserProfile[]) => Promise<void>,
): Promise<UserProfile[]> {
  const userId = getMyUserId();
  const allUsers: UserProfile[] = [];
  let cursor = "-1";
  let page = 0;
  const seen = new Set<string>();
  let consecutiveDupes = 0;

  abortController = new AbortController();

  while (true) {
    if (abortController.signal.aborted) break;

    const params = new URLSearchParams({
      user_id: userId,
      count: "200",
      cursor,
      skip_status: "false",
      include_user_entities: "false",
    });

    const resp = await fetch(`https://x.com/i/api/1.1/${endpoint}?${params}`, {
      headers: getHeaders(),
      credentials: "include",
      signal: abortController.signal,
    });

    if (resp.status === 429) {
      console.log("[XSweep] Rate limited on list. Waiting 60s...");
      await delay(60, 90);
      continue;
    }

    if (!resp.ok) {
      throw new Error(`${endpoint} error: ${resp.status}`);
    }

    const data = await resp.json();
    const users = data.users || [];

    if (users.length === 0) break;

    // Loop detection
    let dupeCount = 0;
    for (const u of users) {
      const uid = String(u.id_str || u.id);
      if (seen.has(uid)) dupeCount++;
      seen.add(uid);
    }

    if (dupeCount === users.length) {
      consecutiveDupes++;
      if (consecutiveDupes >= 3) {
        console.log("[XSweep] Loop detected. Stopping pagination.");
        break;
      }
    } else {
      consecutiveDupes = 0;
    }

    // Process batch
    const batch: UserProfile[] = [];
    for (const u of users) {
      const uid = String(u.id_str || u.id);
      const lastTweet = u.status?.created_at
        ? new Date(u.status.created_at)
        : null;
      const daysSince = lastTweet
        ? Math.floor((Date.now() - lastTweet.getTime()) / 86400000)
        : null;

      let status: UserStatus;
      if (u.suspended) status = "suspended";
      else if (!lastTweet && (u.statuses_count || 0) === 0)
        status = "no_tweets";
      else if (!lastTweet) status = "no_tweets";
      else if (daysSince !== null && daysSince > INACTIVE_DAYS)
        status = "inactive";
      else status = "active";

      batch.push({
        userId: uid,
        username: u.screen_name || "[unknown]",
        displayName: u.name || "[unknown]",
        bio: (u.description || "").substring(0, 200),
        followerCount: u.followers_count || 0,
        followingCount: u.friends_count || 0,
        tweetCount: u.statuses_count || 0,
        lastTweetDate: lastTweet ? lastTweet.toISOString() : null,
        daysSinceLastTweet: daysSince,
        status,
        isFollower: false, // computed later in relationships
        isMutual: false, // computed later in relationships
        isVerified: u.verified || false,
        listIds: [],
        scannedAt: new Date().toISOString(),
        profileImageUrl: u.profile_image_url_https || "",
      });
    }

    allUsers.push(...batch);
    await onBatch?.(batch);

    page++;
    onProgress?.({
      phase: "scanning-users",
      totalIds: knownIds.size,
      scannedUsers: allUsers.length,
      currentPage: page,
    });

    const nextCursor = data.next_cursor_str;
    if (!nextCursor || nextCursor === "0") break;
    cursor = nextCursor;

    await delay(2, 4);
  }

  // Mark IDs not returned by list endpoint
  for (const id of knownIds) {
    if (!seen.has(id)) {
      const placeholder: UserProfile = {
        userId: id,
        username: "[not_returned]",
        displayName: "[not_returned]",
        bio: "",
        followerCount: 0,
        followingCount: 0,
        tweetCount: 0,
        lastTweetDate: null,
        daysSinceLastTweet: null,
        status: "no_tweets",
        isFollower: false,
        isMutual: false,
        isVerified: false,
        listIds: [],
        scannedAt: new Date().toISOString(),
        profileImageUrl: "",
      };
      allUsers.push(placeholder);
      await onBatch?.([placeholder]);
    }
  }

  return allUsers;
}

/**
 * Full scan: collect IDs + hydrate profiles for following.
 */
export async function fullScan(
  onProgress?: ProgressCallback,
  onBatch?: (users: UserProfile[]) => Promise<void>,
): Promise<{
  followingIds: string[];
  followerIds: string[];
  users: UserProfile[];
}> {
  // Step 1: Collect following IDs
  onProgress?.({
    phase: "collecting-ids",
    totalIds: 0,
    scannedUsers: 0,
    currentPage: 0,
  });
  const followingIds = await collectIds("friends/ids.json", onProgress);

  // Step 2: Collect follower IDs (for mutual detection)
  const followerIds = await collectIds("followers/ids.json", onProgress);

  // Step 3: Hydrate following users
  onProgress?.({
    phase: "scanning-users",
    totalIds: followingIds.length,
    scannedUsers: 0,
    currentPage: 0,
  });
  const knownIds = new Set(followingIds.map(String));
  const users = await hydrateUsers(
    "friends/list.json",
    knownIds,
    onProgress,
    onBatch,
  );

  // Step 4: Compute relationships
  onProgress?.({
    phase: "computing-relationships",
    totalIds: followingIds.length,
    scannedUsers: users.length,
    currentPage: 0,
  });
  const followerSet = new Set(followerIds.map(String));
  for (const user of users) {
    user.isFollower = followerSet.has(user.userId);
    user.isMutual = followerSet.has(user.userId);
  }

  onProgress?.({
    phase: "complete",
    totalIds: followingIds.length,
    scannedUsers: users.length,
    currentPage: 0,
  });

  return { followingIds, followerIds, users };
}
