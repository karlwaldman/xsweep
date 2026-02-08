import { describe, it, expect, vi, beforeEach } from "vitest";
import { getHeaders, getMyUserId } from "@/core/auth";
import { delay } from "@/utils/rate-limiter";

// Mock auth module
vi.mock("@/core/auth", () => ({
  getHeaders: vi.fn(() => ({
    authorization: "Bearer mock-token",
    "x-csrf-token": "mock-csrf",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
  })),
  getMyUserId: vi.fn(() => "12345"),
}));

// Mock delay to resolve immediately
vi.mock("@/utils/rate-limiter", () => ({
  delay: vi.fn(() => Promise.resolve()),
}));

import { collectIds, hydrateUsers, fullScan, stopScan } from "@/core/scanner";

/** Create a mock Response with both .json() and .text() */
function mockResponse(body: unknown, status = 200, ok = true) {
  const json = JSON.stringify(body);
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(json),
  } as Response;
}

describe("collectIds", () => {
  beforeEach(() => {
    vi.mocked(getHeaders).mockReturnValue({
      authorization: "Bearer mock-token",
      "x-csrf-token": "mock-csrf",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
    });
    vi.mocked(getMyUserId).mockReturnValue("12345");
    vi.mocked(delay).mockResolvedValue(undefined);
  });

  it("paginates through cursor, collects all IDs", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          mockResponse({ ids: ["1", "2", "3"], next_cursor_str: "abc" }),
        );
      }
      return Promise.resolve(
        mockResponse({ ids: ["4", "5"], next_cursor_str: "0" }),
      );
    });

    const ids = await collectIds("friends/ids.json");
    expect(ids).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("handles rate limit (429) by waiting and retrying", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
        } as Response);
      }
      return Promise.resolve(
        mockResponse({ ids: ["1"], next_cursor_str: "0" }),
      );
    });

    const ids = await collectIds("friends/ids.json");

    expect(ids).toEqual(["1"]);
    expect(delay).toHaveBeenCalledWith(60, 90);
  });

  it("stops when next_cursor_str is '0'", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ ids: ["1", "2"], next_cursor_str: "0" }),
      );

    const ids = await collectIds("friends/ids.json");
    expect(ids).toEqual(["1", "2"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("calls onProgress callback with correct phase", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse({ ids: ["1"], next_cursor_str: "0" }));

    const onProgress = vi.fn();
    await collectIds("friends/ids.json", onProgress);

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "collecting-ids",
        totalIds: 1,
        currentPage: 1,
      }),
    );
  });

  it("respects abort signal via stopScan()", async () => {
    // Make delay trigger abort after first page
    vi.mocked(delay).mockImplementation(() => {
      stopScan();
      return Promise.resolve();
    });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse({ ids: ["1"], next_cursor_str: "abc" }));

    const ids = await collectIds("friends/ids.json");
    // Only first page collected before abort kicks in
    expect(ids).toEqual(["1"]);
  });
});

describe("hydrateUsers", () => {
  beforeEach(() => {
    vi.mocked(getHeaders).mockReturnValue({
      authorization: "Bearer mock-token",
      "x-csrf-token": "mock-csrf",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
    });
    vi.mocked(getMyUserId).mockReturnValue("12345");
    vi.mocked(delay).mockResolvedValue(undefined);
  });

  it("processes users and creates UserProfile objects", async () => {
    const recentDate = new Date(Date.now() - 86400000 * 5).toUTCString(); // 5 days ago
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        users: [
          {
            id_str: "1",
            screen_name: "alice",
            name: "Alice",
            description: "Hello world",
            followers_count: 100,
            friends_count: 50,
            statuses_count: 500,
            status: { created_at: recentDate },
            verified: false,
            profile_image_url_https: "https://img.com/alice.jpg",
          },
        ],
        next_cursor_str: "0",
      }),
    );

    const users = await hydrateUsers("friends/list.json", new Set(["1"]));

    expect(users).toHaveLength(1);
    expect(users[0].userId).toBe("1");
    expect(users[0].username).toBe("alice");
    expect(users[0].status).toBe("active");
    expect(users[0].followerCount).toBe(100);
  });

  it("detects loop (3 consecutive all-dupe pages) and stops", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(() => {
      callCount++;
      return Promise.resolve(
        mockResponse({
          users: [
            {
              id_str: "1",
              screen_name: "same",
              name: "Same User",
              description: "",
              followers_count: 0,
              friends_count: 0,
              statuses_count: 0,
            },
          ],
          next_cursor_str: String(callCount + 1),
        }),
      );
    });

    await hydrateUsers("friends/list.json", new Set(["1"]));

    // First page: new user. Pages 2, 3, 4: all dupes => stops at page 4
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it("respects MAX_PAGES limit (50)", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(() => {
      callCount++;
      return Promise.resolve(
        mockResponse({
          users: [
            {
              id_str: String(callCount * 100),
              screen_name: `user${callCount}`,
              name: `User ${callCount}`,
              description: "",
              followers_count: 0,
              friends_count: 0,
              statuses_count: 0,
            },
          ],
          next_cursor_str: String(callCount + 1),
        }),
      );
    });

    await hydrateUsers("friends/list.json", new Set());

    expect(globalThis.fetch).toHaveBeenCalledTimes(50);
  });

  it("creates placeholder profiles for IDs not returned by API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        users: [
          {
            id_str: "1",
            screen_name: "alice",
            name: "Alice",
            description: "",
            followers_count: 0,
            friends_count: 0,
            statuses_count: 0,
          },
        ],
        next_cursor_str: "0",
      }),
    );

    const users = await hydrateUsers(
      "friends/list.json",
      new Set(["1", "999"]),
    );

    expect(users).toHaveLength(2);
    const placeholder = users.find((u) => u.userId === "999");
    expect(placeholder).toBeDefined();
    expect(placeholder!.username).toBe("[not_returned]");
    expect(placeholder!.status).toBe("no_tweets");
  });

  it("correctly determines user status", async () => {
    const oldDate = new Date(Date.now() - 86400000 * 400).toUTCString();
    const recentDate = new Date(Date.now() - 86400000 * 5).toUTCString();

    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        users: [
          {
            id_str: "1",
            screen_name: "active_user",
            name: "Active",
            description: "",
            followers_count: 0,
            friends_count: 0,
            statuses_count: 100,
            status: { created_at: recentDate },
          },
          {
            id_str: "2",
            screen_name: "inactive_user",
            name: "Inactive",
            description: "",
            followers_count: 0,
            friends_count: 0,
            statuses_count: 100,
            status: { created_at: oldDate },
          },
          {
            id_str: "3",
            screen_name: "suspended_user",
            name: "Suspended",
            description: "",
            followers_count: 0,
            friends_count: 0,
            statuses_count: 0,
            suspended: true,
          },
          {
            id_str: "4",
            screen_name: "no_tweets_user",
            name: "NoTweets",
            description: "",
            followers_count: 0,
            friends_count: 0,
            statuses_count: 0,
          },
        ],
        next_cursor_str: "0",
      }),
    );

    const users = await hydrateUsers(
      "friends/list.json",
      new Set(["1", "2", "3", "4"]),
    );

    expect(users.find((u) => u.userId === "1")!.status).toBe("active");
    expect(users.find((u) => u.userId === "2")!.status).toBe("inactive");
    expect(users.find((u) => u.userId === "3")!.status).toBe("suspended");
    expect(users.find((u) => u.userId === "4")!.status).toBe("no_tweets");
  });

  it("calls onBatch callback with each batch", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        users: [
          {
            id_str: "1",
            screen_name: "alice",
            name: "Alice",
            description: "",
            followers_count: 0,
            friends_count: 0,
            statuses_count: 0,
          },
        ],
        next_cursor_str: "0",
      }),
    );

    const onBatch = vi.fn();
    await hydrateUsers("friends/list.json", new Set(["1"]), undefined, onBatch);

    expect(onBatch).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ userId: "1" })]),
    );
  });
});

describe("fullScan", () => {
  beforeEach(() => {
    vi.mocked(getHeaders).mockReturnValue({
      authorization: "Bearer mock-token",
      "x-csrf-token": "mock-csrf",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
    });
    vi.mocked(getMyUserId).mockReturnValue("12345");
    vi.mocked(delay).mockResolvedValue(undefined);
  });

  it("orchestrates collectIds + hydrateUsers + relationship computation", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve(
          mockResponse({ ids: ["1", "2"], next_cursor_str: "0" }),
        );
      }
      return Promise.resolve(
        mockResponse({
          users: [
            {
              id_str: "1",
              screen_name: "alice",
              name: "Alice",
              description: "",
              followers_count: 10,
              friends_count: 5,
              statuses_count: 100,
              status: { created_at: new Date().toUTCString() },
            },
            {
              id_str: "2",
              screen_name: "bob",
              name: "Bob",
              description: "",
              followers_count: 20,
              friends_count: 10,
              statuses_count: 200,
              status: { created_at: new Date().toUTCString() },
            },
          ],
          next_cursor_str: "0",
        }),
      );
    });

    const result = await fullScan();

    expect(result.followingIds).toEqual(["1", "2"]);
    expect(result.followerIds).toEqual(["1", "2"]);
    expect(result.users).toHaveLength(2);
  });

  it("sets isFollower/isMutual based on follower set", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          mockResponse({ ids: ["1", "2"], next_cursor_str: "0" }),
        );
      }
      if (callCount === 2) {
        return Promise.resolve(
          mockResponse({ ids: ["1"], next_cursor_str: "0" }),
        );
      }
      return Promise.resolve(
        mockResponse({
          users: [
            {
              id_str: "1",
              screen_name: "alice",
              name: "Alice",
              description: "",
              followers_count: 0,
              friends_count: 0,
              statuses_count: 10,
              status: { created_at: new Date().toUTCString() },
            },
            {
              id_str: "2",
              screen_name: "bob",
              name: "Bob",
              description: "",
              followers_count: 0,
              friends_count: 0,
              statuses_count: 10,
              status: { created_at: new Date().toUTCString() },
            },
          ],
          next_cursor_str: "0",
        }),
      );
    });

    const result = await fullScan();

    const alice = result.users.find((u) => u.userId === "1")!;
    const bob = result.users.find((u) => u.userId === "2")!;

    expect(alice.isFollower).toBe(true);
    expect(alice.isMutual).toBe(true);
    expect(bob.isFollower).toBe(false);
    expect(bob.isMutual).toBe(false);
  });
});

describe("stopScan", () => {
  beforeEach(() => {
    vi.mocked(getHeaders).mockReturnValue({
      authorization: "Bearer mock-token",
      "x-csrf-token": "mock-csrf",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
    });
    vi.mocked(getMyUserId).mockReturnValue("12345");
  });

  it("aborts in-progress scan via delay", async () => {
    vi.mocked(delay).mockImplementation(() => {
      stopScan();
      return Promise.resolve();
    });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse({ ids: ["1"], next_cursor_str: "abc" }));

    const ids = await collectIds("friends/ids.json");
    expect(ids).toEqual(["1"]);
  });

  it("does not throw when called with no active scan", () => {
    expect(() => stopScan()).not.toThrow();
  });
});

describe("safeParseJson (via collectIds)", () => {
  beforeEach(() => {
    vi.mocked(getHeaders).mockReturnValue({
      authorization: "Bearer mock-token",
      "x-csrf-token": "mock-csrf",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
    });
    vi.mocked(getMyUserId).mockReturnValue("12345");
    vi.mocked(delay).mockResolvedValue(undefined);
  });

  it("throws descriptive error on invalid JSON response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("{invalid json!!!"),
    } as Response);

    await expect(collectIds("friends/ids.json")).rejects.toThrow(
      "returned invalid JSON",
    );
  });

  it("stops gracefully on empty response body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    } as Response);

    const ids = await collectIds("friends/ids.json");
    expect(ids).toEqual([]);
  });
});

describe("fullScan follower-only filtering", () => {
  beforeEach(() => {
    vi.mocked(getHeaders).mockReturnValue({
      authorization: "Bearer mock-token",
      "x-csrf-token": "mock-csrf",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
    });
    vi.mocked(getMyUserId).mockReturnValue("12345");
    vi.mocked(delay).mockResolvedValue(undefined);
  });

  it("filters follower-only users and does not duplicate mutuals", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(() => {
      callCount++;
      // Call 1: friends/ids — following [1, 2]
      if (callCount === 1) {
        return Promise.resolve(
          mockResponse({ ids: ["1", "2"], next_cursor_str: "0" }),
        );
      }
      // Call 2: followers/ids — followers [1, 3] (1 is mutual, 3 is follower-only)
      if (callCount === 2) {
        return Promise.resolve(
          mockResponse({ ids: ["1", "3"], next_cursor_str: "0" }),
        );
      }
      // Call 3: friends/list — hydrate following
      if (callCount === 3) {
        return Promise.resolve(
          mockResponse({
            users: [
              {
                id_str: "1",
                screen_name: "mutual",
                name: "Mutual",
                description: "",
                followers_count: 100,
                friends_count: 50,
                statuses_count: 10,
                status: { created_at: new Date().toUTCString() },
              },
              {
                id_str: "2",
                screen_name: "following_only",
                name: "Following Only",
                description: "",
                followers_count: 50,
                friends_count: 25,
                statuses_count: 5,
                status: { created_at: new Date().toUTCString() },
              },
            ],
            next_cursor_str: "0",
          }),
        );
      }
      // Call 4: followers/list — returns ALL followers (1 + 3), but only 3 should be kept
      return Promise.resolve(
        mockResponse({
          users: [
            {
              id_str: "1",
              screen_name: "mutual",
              name: "Mutual",
              description: "",
              followers_count: 100,
              friends_count: 50,
              statuses_count: 10,
              status: { created_at: new Date().toUTCString() },
            },
            {
              id_str: "3",
              screen_name: "follower_only",
              name: "Follower Only",
              description: "",
              followers_count: 200,
              friends_count: 75,
              statuses_count: 20,
              status: { created_at: new Date().toUTCString() },
            },
          ],
          next_cursor_str: "0",
        }),
      );
    });

    const result = await fullScan();

    // Should have 3 unique users, not 4 (mutual should NOT be duplicated)
    expect(result.users).toHaveLength(3);

    const mutual = result.users.find((u) => u.userId === "1")!;
    const followingOnly = result.users.find((u) => u.userId === "2")!;
    const followerOnly = result.users.find((u) => u.userId === "3")!;

    // Mutual: following + follower + mutual
    expect(mutual.isFollowing).toBe(true);
    expect(mutual.isFollower).toBe(true);
    expect(mutual.isMutual).toBe(true);

    // Following-only: following but not follower
    expect(followingOnly.isFollowing).toBe(true);
    expect(followingOnly.isFollower).toBe(false);
    expect(followingOnly.isMutual).toBe(false);

    // Follower-only: follower but not following
    expect(followerOnly.isFollowing).toBe(false);
    expect(followerOnly.isFollower).toBe(true);
    expect(followerOnly.isMutual).toBe(false);
  });

  it("onBatch only receives follower-only users in step 3.5", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          mockResponse({ ids: ["1"], next_cursor_str: "0" }),
        );
      }
      if (callCount === 2) {
        return Promise.resolve(
          mockResponse({ ids: ["1", "3"], next_cursor_str: "0" }),
        );
      }
      if (callCount === 3) {
        return Promise.resolve(
          mockResponse({
            users: [
              {
                id_str: "1",
                screen_name: "mutual",
                name: "Mutual",
                description: "",
                followers_count: 0,
                friends_count: 0,
                statuses_count: 10,
                status: { created_at: new Date().toUTCString() },
              },
            ],
            next_cursor_str: "0",
          }),
        );
      }
      // followers/list returns both mutual (1) and follower-only (3)
      return Promise.resolve(
        mockResponse({
          users: [
            {
              id_str: "1",
              screen_name: "mutual",
              name: "Mutual",
              description: "",
              followers_count: 0,
              friends_count: 0,
              statuses_count: 10,
              status: { created_at: new Date().toUTCString() },
            },
            {
              id_str: "3",
              screen_name: "follower_only",
              name: "Follower Only",
              description: "",
              followers_count: 0,
              friends_count: 0,
              statuses_count: 10,
              status: { created_at: new Date().toUTCString() },
            },
          ],
          next_cursor_str: "0",
        }),
      );
    });

    const batchedUserIds: string[] = [];
    const onBatch = vi.fn(async (users) => {
      for (const u of users) batchedUserIds.push(u.userId);
    });

    await fullScan(undefined, onBatch);

    // User "1" should appear in batches from step 3 (following)
    // User "3" should appear in batches from step 3.5 (follower-only)
    // User "1" should NOT appear again from step 3.5 (filtered out)
    const countUser1 = batchedUserIds.filter((id) => id === "1").length;
    const countUser3 = batchedUserIds.filter((id) => id === "3").length;

    expect(countUser1).toBe(1); // Only from step 3, NOT duplicated from step 3.5
    expect(countUser3).toBe(1); // From step 3.5
  });
});
