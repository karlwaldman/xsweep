import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  categorizeByKeywords,
  batchCategorizeByKeywords,
  categorizeWithAI,
} from "@/core/categorizer";
import { makeUser, makeList } from "../helpers/fixtures";

describe("categorizeByKeywords", () => {
  it("matches keyword in bio (case-insensitive)", () => {
    const user = makeUser({
      bio: "Full-stack Developer and open source enthusiast",
    });
    const lists = [makeList({ id: 1, keywords: ["developer", "engineer"] })];

    const result = categorizeByKeywords(user, lists);
    expect(result).toEqual([1]);
  });

  it("matches keyword in displayName", () => {
    const user = makeUser({
      bio: "I like cats",
      displayName: "Senior Engineer",
    });
    const lists = [makeList({ id: 1, keywords: ["engineer"] })];

    const result = categorizeByKeywords(user, lists);
    expect(result).toEqual([1]);
  });

  it("skips AI-type lists", () => {
    const user = makeUser({ bio: "developer" });
    const lists = [
      makeList({ id: 1, type: "ai", keywords: ["developer"] }),
      makeList({ id: 2, type: "keyword", keywords: ["developer"] }),
    ];

    const result = categorizeByKeywords(user, lists);
    expect(result).toEqual([2]);
  });

  it("skips lists without id", () => {
    const user = makeUser({ bio: "developer" });
    const lists = [makeList({ id: undefined, keywords: ["developer"] })];

    const result = categorizeByKeywords(user, lists);
    expect(result).toEqual([]);
  });

  it("returns empty array when no match", () => {
    const user = makeUser({ bio: "I love cooking", displayName: "Chef" });
    const lists = [makeList({ id: 1, keywords: ["developer", "engineer"] })];

    const result = categorizeByKeywords(user, lists);
    expect(result).toEqual([]);
  });

  it("matches multiple lists", () => {
    const user = makeUser({ bio: "Developer who loves crypto and AI" });
    const lists = [
      makeList({ id: 1, keywords: ["developer"] }),
      makeList({ id: 2, keywords: ["crypto", "bitcoin"] }),
      makeList({ id: 3, keywords: ["painting", "art"] }),
    ];

    const result = categorizeByKeywords(user, lists);
    expect(result).toEqual([1, 2]);
  });
});

describe("batchCategorizeByKeywords", () => {
  it("maps userId to matched listIds", () => {
    const users = [
      makeUser({ userId: "1", bio: "Developer building cool stuff" }),
      makeUser({ userId: "2", bio: "Crypto trader and investor" }),
      makeUser({ userId: "3", bio: "I love cooking" }),
    ];
    const lists = [
      makeList({ id: 10, keywords: ["developer"] }),
      makeList({ id: 20, keywords: ["crypto"] }),
    ];

    const result = batchCategorizeByKeywords(users, lists);

    expect(result.get("1")).toEqual([10]);
    expect(result.get("2")).toEqual([20]);
  });

  it("omits users with no matches", () => {
    const users = [
      makeUser({ userId: "1", bio: "nothing relevant" }),
      makeUser({ userId: "2", bio: "developer" }),
    ];
    const lists = [makeList({ id: 1, keywords: ["developer"] })];

    const result = batchCategorizeByKeywords(users, lists);

    expect(result.has("1")).toBe(false);
    expect(result.get("2")).toEqual([1]);
    expect(result.size).toBe(1);
  });
});

describe("categorizeWithAI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct request to Claude API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ text: '{"100": [1]}' }],
        }),
    });
    globalThis.fetch = mockFetch;

    const users = [makeUser({ userId: "100", bio: "Developer" })];
    const lists = [makeList({ id: 1, type: "ai", description: "Tech folks" })];

    await categorizeWithAI(users, lists, "sk-test-key");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(opts.method).toBe("POST");
    expect(opts.headers["x-api-key"]).toBe("sk-test-key");
    expect(opts.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    expect(body.messages[0].content).toContain("@testuser");
  });

  it("parses JSON response and returns mapping", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ text: '{"100": [1, 2], "200": [3]}' }],
        }),
    });

    const users = [makeUser({ userId: "100" }), makeUser({ userId: "200" })];
    const lists = [
      makeList({ id: 1, type: "ai" }),
      makeList({ id: 2, type: "ai" }),
      makeList({ id: 3, type: "ai" }),
    ];

    const result = await categorizeWithAI(users, lists, "key");

    expect(result.get("100")).toEqual([1, 2]);
    expect(result.get("200")).toEqual([3]);
  });

  it("handles API error gracefully (continues)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const users = [makeUser({ userId: "100" })];
    const lists = [makeList({ id: 1, type: "ai" })];

    const result = await categorizeWithAI(users, lists, "key");
    expect(result.size).toBe(0);
  });

  it("handles malformed JSON in response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ text: "This is not valid JSON at all" }],
        }),
    });

    const users = [makeUser({ userId: "100" })];
    const lists = [makeList({ id: 1, type: "ai" })];

    const result = await categorizeWithAI(users, lists, "key");
    expect(result.size).toBe(0);
  });

  it("batches users in groups of 50", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ text: "{}" }],
        }),
    });
    globalThis.fetch = mockFetch;

    // 120 users => 3 batches (50, 50, 20)
    const users = Array.from({ length: 120 }, (_, i) =>
      makeUser({ userId: String(i) }),
    );
    const lists = [makeList({ id: 1, type: "ai" })];

    await categorizeWithAI(users, lists, "key");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
