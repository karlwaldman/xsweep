/**
 * Scanner: Collects following/follower IDs and hydrates user profiles.
 * Ported from x-follow-cleaner.js and x-follow-extractor.js.
 */

import { getHeaders, getMyUserId } from "./auth";
import { delay } from "../utils/rate-limiter";
import type { UserProfile, UserStatus, ScanProgress } from "./types";

export interface VerifiedFollowerResult {
  verified: number;
  total: number;
}

export interface OwnTweetsResult {
  impressions: number;
  impressionsAvailable: boolean;
  tweetsLast30: number;
  tweetsLast90: number;
  avgViews: number;
  topViews: number;
}

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
  console.log(`[XSweep] collectIds: starting ${endpoint} for user ${userId}`);

  while (true) {
    if (!abortController || abortController.signal.aborted) break;

    const params = new URLSearchParams({
      user_id: userId,
      count: "5000",
      cursor,
      stringify_ids: "true",
    });

    console.log(
      `[XSweep] collectIds: fetching page ${page + 1}, cursor=${cursor}`,
    );
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
      console.error(
        `[XSweep] collectIds error: ${resp.status} ${resp.statusText}`,
      );
      throw new Error(`${endpoint} error: ${resp.status}`);
    }

    const data = await resp.json();
    const ids: string[] = data.ids || [];
    allIds.push(...ids);
    page++;

    console.log(
      `[XSweep] collectIds: page ${page} returned ${ids.length} IDs (total: ${allIds.length})`,
    );

    onProgress?.({
      phase: "collecting-ids",
      totalIds: allIds.length,
      scannedUsers: 0,
      currentPage: page,
    });

    const nextCursor = data.next_cursor_str;
    if (!nextCursor || nextCursor === "0") break;
    cursor = nextCursor;

    await delay(3, 6);
  }

  console.log(
    `[XSweep] collectIds: done. ${allIds.length} total IDs from ${endpoint}`,
  );
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

  // Safety limit: friends/list.json is broken for large lists (>200 following)
  // It returns the same 200 users in an infinite loop. Cap at reasonable max.
  const MAX_PAGES = 50; // 50 pages * 200 users = 10,000 max

  abortController = new AbortController();
  console.log(
    `[XSweep] hydrateUsers: starting ${endpoint}, ${knownIds.size} known IDs`,
  );

  while (true) {
    if (!abortController || abortController.signal.aborted) break;
    if (page >= MAX_PAGES) {
      console.log(
        `[XSweep] hydrateUsers: reached max ${MAX_PAGES} pages. Stopping.`,
      );
      break;
    }

    const params = new URLSearchParams({
      user_id: userId,
      count: "200",
      cursor,
      skip_status: "false",
      include_user_entities: "false",
    });

    console.log(
      `[XSweep] hydrateUsers: fetching page ${page + 1}, cursor=${cursor}, unique users so far: ${seen.size}`,
    );
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
      console.error(
        `[XSweep] hydrateUsers error: ${resp.status} ${resp.statusText}`,
      );
      throw new Error(`${endpoint} error: ${resp.status}`);
    }

    const data = await resp.json();
    const users = data.users || [];

    if (users.length === 0) {
      console.log("[XSweep] hydrateUsers: empty page, done.");
      break;
    }

    // Loop detection
    let dupeCount = 0;
    for (const u of users) {
      const uid = String(u.id_str || u.id);
      if (seen.has(uid)) dupeCount++;
      seen.add(uid);
    }

    console.log(
      `[XSweep] hydrateUsers: page ${page + 1} returned ${users.length} users (${dupeCount} dupes, ${seen.size} unique total)`,
    );

    if (dupeCount === users.length) {
      consecutiveDupes++;
      console.log(
        `[XSweep] hydrateUsers: all dupes on page ${page + 1} (consecutive: ${consecutiveDupes}/3)`,
      );
      if (consecutiveDupes >= 3) {
        console.log(
          "[XSweep] Loop detected after 3 consecutive dupe pages. Stopping pagination.",
        );
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
        location: u.location || "",
        url: u.url || "",
        createdAt: u.created_at || "",
        isBlueVerified: u.is_blue_verified || false,
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

    await delay(3, 5);
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
        location: "",
        url: "",
        createdAt: "",
        isBlueVerified: false,
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
  const startTime = Date.now();
  console.log("[XSweep] === FULL SCAN STARTING ===");

  // Step 1: Collect following IDs
  console.log("[XSweep] Step 1/4: Collecting following IDs...");
  onProgress?.({
    phase: "collecting-ids",
    totalIds: 0,
    scannedUsers: 0,
    currentPage: 0,
  });
  const followingIds = await collectIds("friends/ids.json", onProgress);
  console.log(
    `[XSweep] Step 1 done: ${followingIds.length} following IDs (${((Date.now() - startTime) / 1000).toFixed(1)}s)`,
  );

  // Step 2: Collect follower IDs (for mutual detection)
  console.log("[XSweep] Step 2/4: Collecting follower IDs...");
  const followerIds = await collectIds("followers/ids.json", onProgress);
  console.log(
    `[XSweep] Step 2 done: ${followerIds.length} follower IDs (${((Date.now() - startTime) / 1000).toFixed(1)}s)`,
  );

  // Step 3: Hydrate following users
  console.log("[XSweep] Step 3/4: Hydrating user profiles...");
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
  console.log(
    `[XSweep] Step 3 done: ${users.length} users hydrated (${((Date.now() - startTime) / 1000).toFixed(1)}s)`,
  );

  // Step 4: Compute relationships
  console.log("[XSweep] Step 4/4: Computing relationships...");
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

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[XSweep] === FULL SCAN COMPLETE === ${users.length} users in ${elapsed}s`,
  );
  return { followingIds, followerIds, users };
}

let monetizationAbort: AbortController | null = null;

export function stopMonetizationScan(): void {
  monetizationAbort?.abort();
  monetizationAbort = null;
}

/**
 * Scan followers via followers/list.json and count verified users.
 * Paginates through all followers (200 per page).
 */
export async function scanVerifiedFollowers(
  onProgress?: (progress: { done: number; total: number }) => void,
): Promise<VerifiedFollowerResult> {
  const userId = getMyUserId();
  let cursor = "-1";
  let verified = 0;
  let total = 0;
  const seen = new Set<string>();
  let consecutiveDupes = 0;
  const MAX_PAGES = 250; // 250 * 200 = 50k max followers
  let page = 0;

  monetizationAbort = new AbortController();
  console.log("[XSweep] scanVerifiedFollowers: starting");

  while (true) {
    if (!monetizationAbort || monetizationAbort.signal.aborted) break;
    if (page >= MAX_PAGES) break;

    const params = new URLSearchParams({
      user_id: userId,
      count: "200",
      cursor,
      skip_status: "true",
      include_user_entities: "false",
    });

    const resp = await fetch(
      `https://x.com/i/api/1.1/followers/list.json?${params}`,
      {
        headers: getHeaders(),
        credentials: "include",
        signal: monetizationAbort.signal,
      },
    );

    if (resp.status === 429) {
      console.log("[XSweep] Rate limited on followers. Waiting 60s...");
      await delay(60, 90);
      continue;
    }

    if (!resp.ok) {
      throw new Error(`followers/list.json error: ${resp.status}`);
    }

    const data = await resp.json();
    const users = data.users || [];

    if (users.length === 0) break;

    // Loop detection
    let dupeCount = 0;
    for (const u of users) {
      const uid = String(u.id_str || u.id);
      if (seen.has(uid)) {
        dupeCount++;
        continue;
      }
      seen.add(uid);
      total++;
      if (u.verified || u.is_blue_verified) verified++;
    }

    if (dupeCount === users.length) {
      consecutiveDupes++;
      if (consecutiveDupes >= 3) {
        console.log("[XSweep] Loop detected in followers. Stopping.");
        break;
      }
    } else {
      consecutiveDupes = 0;
    }

    page++;
    onProgress?.({ done: total, total: total }); // total grows as we discover

    console.log(
      `[XSweep] scanVerifiedFollowers: page ${page}, ${verified} verified / ${total} total`,
    );

    const nextCursor = data.next_cursor_str;
    if (!nextCursor || nextCursor === "0") break;
    cursor = nextCursor;

    await delay(3, 5);
  }

  console.log(
    `[XSweep] scanVerifiedFollowers: done. ${verified} verified / ${total} total`,
  );
  return { verified, total };
}

/**
 * Scan own tweets via user_timeline.json.
 * Attempts to extract view counts from ext_views field.
 * Paginates back 90 days or 3200 tweets max.
 */
export async function scanOwnTweets(
  onProgress?: (progress: { done: number; total: number }) => void,
): Promise<OwnTweetsResult> {
  const userId = getMyUserId();
  let maxId: string | undefined;
  let impressions = 0;
  let impressionsAvailable = false;
  let tweetsLast30 = 0;
  let tweetsLast90 = 0;
  let totalViews = 0;
  let viewedTweets = 0;
  let topViews = 0;
  let totalFetched = 0;
  const MAX_TWEETS = 3200;

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 86400000;
  const ninetyDaysAgo = now - 90 * 86400000;

  if (!monetizationAbort) monetizationAbort = new AbortController();
  console.log("[XSweep] scanOwnTweets: starting");

  while (totalFetched < MAX_TWEETS) {
    if (!monetizationAbort || monetizationAbort.signal.aborted) break;

    const params = new URLSearchParams({
      user_id: userId,
      count: "200",
      trim_user: "true",
      include_rts: "false",
      tweet_mode: "extended",
    });
    if (maxId) params.set("max_id", maxId);

    const resp = await fetch(
      `https://x.com/i/api/1.1/statuses/user_timeline.json?${params}`,
      {
        headers: getHeaders(),
        credentials: "include",
        signal: monetizationAbort.signal,
      },
    );

    if (resp.status === 429) {
      console.log("[XSweep] Rate limited on timeline. Waiting 60s...");
      await delay(60, 90);
      continue;
    }

    if (!resp.ok) {
      throw new Error(`user_timeline.json error: ${resp.status}`);
    }

    const tweets = await resp.json();
    if (!Array.isArray(tweets) || tweets.length === 0) break;

    let reachedOldTweets = false;

    for (const tweet of tweets) {
      const tweetId = String(tweet.id_str || tweet.id);
      // Skip the maxId tweet on subsequent pages
      if (maxId && tweetId === maxId) continue;

      const createdAt = new Date(tweet.created_at).getTime();

      if (createdAt < ninetyDaysAgo) {
        reachedOldTweets = true;
        break;
      }

      tweetsLast90++;
      if (createdAt >= thirtyDaysAgo) tweetsLast30++;

      // Try to extract view count
      const views =
        tweet.ext_views?.count ??
        tweet.ext?.views?.count ??
        tweet.views?.count ??
        null;

      if (views !== null && views !== undefined) {
        impressionsAvailable = true;
        const viewCount = Number(views);
        impressions += viewCount;
        totalViews += viewCount;
        viewedTweets++;
        if (viewCount > topViews) topViews = viewCount;
      }
    }

    totalFetched += tweets.length;
    onProgress?.({ done: totalFetched, total: MAX_TWEETS });

    console.log(
      `[XSweep] scanOwnTweets: ${totalFetched} tweets fetched, ${tweetsLast90} in 90d, ${impressions} impressions`,
    );

    if (reachedOldTweets) break;

    // Set maxId to last tweet for pagination
    const lastTweet = tweets[tweets.length - 1];
    const lastId = String(lastTweet.id_str || lastTweet.id);
    if (lastId === maxId) break; // no progress
    maxId = lastId;

    await delay(2, 4);
  }

  const avgViews = viewedTweets > 0 ? Math.round(totalViews / viewedTweets) : 0;

  console.log(
    `[XSweep] scanOwnTweets: done. ${tweetsLast90} tweets, ${impressions} impressions, avg ${avgViews} views`,
  );

  return {
    impressions,
    impressionsAvailable,
    tweetsLast30,
    tweetsLast90,
    avgViews,
    topViews,
  };
}
