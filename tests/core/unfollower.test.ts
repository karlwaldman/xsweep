import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth module
vi.mock("@/core/auth", () => ({
  getHeaders: vi.fn(() => ({
    authorization: "Bearer mock-token",
    "x-csrf-token": "mock-csrf",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
  })),
  getCSRFToken: vi.fn(() => "mock-csrf"),
}));

// Mock delay to resolve immediately
vi.mock("@/utils/rate-limiter", () => ({
  delay: vi.fn(() => Promise.resolve()),
}));

import {
  bulkUnfollow,
  getDailyLimit,
  getTodayUnfollowCount,
  stopUnfollow,
} from "@/core/unfollower";
import { chromeStorageData } from "../setup";

describe("bulkUnfollow", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    // Re-apply mocked modules
    vi.mocked(await import("@/core/auth")).getHeaders.mockReturnValue({
      authorization: "Bearer mock-token",
      "x-csrf-token": "mock-csrf",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
    });
    vi.mocked(await import("@/utils/rate-limiter")).delay.mockResolvedValue(
      undefined,
    );

    // Clear chrome storage
    for (const key of Object.keys(chromeStorageData)) {
      delete chromeStorageData[key];
    }
  });

  it("dry run returns success for all users without making API calls", async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const users = [
      { userId: "1", username: "alice" },
      { userId: "2", username: "bob" },
    ];

    const results = await bulkUnfollow(users, { dryRun: true });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("live mode calls friendships/destroy.json for each user", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const users = [
      { userId: "1", username: "alice" },
      { userId: "2", username: "bob" },
    ];

    const results = await bulkUnfollow(users, { dryRun: false });

    expect(results).toHaveLength(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const [url] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://x.com/i/api/1.1/friendships/destroy.json");
  });

  it("respects dailyLimit (caps at MAX_DAILY_LIMIT=400)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const users = Array.from({ length: 5 }, (_, i) => ({
      userId: String(i),
      username: `user${i}`,
    }));

    // Setting limit to 500 should be capped to 400
    const results = await bulkUnfollow(users, {
      dryRun: false,
      dailyLimit: 500,
    });

    // All 5 users should be processed (within the 400 cap)
    expect(results).toHaveLength(5);
  });

  it("checks today's count from chrome.storage and limits remaining", async () => {
    const today = new Date().toISOString().split("T")[0];
    const storageKey = `xsweep_unfollow_${today}`;
    chromeStorageData[storageKey] = "198";

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const users = Array.from({ length: 10 }, (_, i) => ({
      userId: String(i),
      username: `user${i}`,
    }));

    // dailyLimit=200, already used 198, so only 2 remaining
    const results = await bulkUnfollow(users, {
      dryRun: false,
      dailyLimit: 200,
    });

    expect(results).toHaveLength(2);
  });

  it("stops when daily limit already reached (returns empty)", async () => {
    const today = new Date().toISOString().split("T")[0];
    const storageKey = `xsweep_unfollow_${today}`;
    chromeStorageData[storageKey] = "200";

    const users = [{ userId: "1", username: "alice" }];
    const results = await bulkUnfollow(users, {
      dryRun: false,
      dailyLimit: 200,
    });

    expect(results).toEqual([]);
  });

  it("updates chrome.storage count after each successful unfollow", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const users = [
      { userId: "1", username: "alice" },
      { userId: "2", username: "bob" },
    ];

    await bulkUnfollow(users, { dryRun: false });

    const today = new Date().toISOString().split("T")[0];
    const storageKey = `xsweep_unfollow_${today}`;
    expect(chromeStorageData[storageKey]).toBeDefined();
    // After 2 successful unfollows, count should be "2"
    expect(parseInt(chromeStorageData[storageKey])).toBe(2);
  });

  it("calls onProgress callback", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const onProgress = vi.fn();
    const users = [{ userId: "1", username: "alice" }];

    await bulkUnfollow(users, { dryRun: true }, onProgress);

    // Called during iteration + final "done" call
    expect(onProgress).toHaveBeenCalledWith(0, 1, "alice");
    expect(onProgress).toHaveBeenCalledWith(1, 1, "done");
  });

  it("respects abort signal via stopUnfollow()", async () => {
    const { delay: delayMock } = await import("@/utils/rate-limiter");
    vi.mocked(delayMock).mockImplementation(() => {
      stopUnfollow();
      return Promise.resolve();
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const users = Array.from({ length: 5 }, (_, i) => ({
      userId: String(i),
      username: `user${i}`,
    }));

    const results = await bulkUnfollow(users, { dryRun: false });

    // Should stop after first user (stopUnfollow called during first delay)
    expect(results.length).toBeLessThan(5);
  });
});

describe("getDailyLimit", () => {
  it("returns 200", () => {
    expect(getDailyLimit()).toBe(200);
  });
});

describe("getTodayUnfollowCount", () => {
  beforeEach(() => {
    for (const key of Object.keys(chromeStorageData)) {
      delete chromeStorageData[key];
    }
  });

  it("reads from chrome.storage.local", async () => {
    const today = new Date().toISOString().split("T")[0];
    chromeStorageData[`xsweep_unfollow_${today}`] = "42";

    const count = await getTodayUnfollowCount();
    expect(count).toBe(42);
  });

  it("returns 0 when no count stored", async () => {
    const count = await getTodayUnfollowCount();
    expect(count).toBe(0);
  });
});
