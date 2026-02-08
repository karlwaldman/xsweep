import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock auth module before importing lists-api
vi.mock("@/core/auth", () => ({
  getHeaders: () => ({
    authorization: "Bearer AAAA_test_token",
    "x-csrf-token": "test-csrf",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
  }),
  getMyUserId: () => "12345",
}));

// Mock delay to avoid waiting in tests
vi.mock("@/utils/rate-limiter", () => ({
  delay: () => Promise.resolve(),
}));

import {
  fetchMyLists,
  fetchListMembers,
  createXList,
  addListMember,
} from "@/core/lists-api";

describe("lists-api", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("fetchMyLists", () => {
    it("returns owned lists only with correct field mapping", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id_str: "111",
              name: "My List",
              description: "Test",
              member_count: 5,
              mode: "private",
              user: { id_str: "12345" },
            },
            {
              id_str: "222",
              name: "Other List",
              description: "",
              member_count: 10,
              mode: "public",
              user: { id_str: "99999" },
            },
          ]),
      });

      const lists = await fetchMyLists();
      expect(lists).toHaveLength(1);
      expect(lists[0]).toEqual({
        id: "111",
        name: "My List",
        description: "Test",
        memberCount: 5,
        mode: "private",
      });
    });

    it("throws on non-ok response", async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });
      await expect(fetchMyLists()).rejects.toThrow("lists/list.json error: 500");
    });
  });

  describe("fetchListMembers", () => {
    it("paginates and returns all members", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            users: [
              {
                id_str: "a1",
                screen_name: "alice",
                name: "Alice",
                profile_image_url_https: "https://img/a.jpg",
              },
            ],
            next_cursor_str: "cursor2",
          }),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            users: [
              {
                id_str: "b2",
                screen_name: "bob",
                name: "Bob",
                profile_image_url_https: "",
              },
            ],
            next_cursor_str: "0",
          }),
      });

      const members = await fetchListMembers("list123");
      expect(members).toHaveLength(2);
      expect(members[0].username).toBe("alice");
      expect(members[1].userId).toBe("b2");
    });

    it("retries on 429 rate limit", async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 429 });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            users: [
              {
                id_str: "c3",
                screen_name: "carol",
                name: "Carol",
                profile_image_url_https: "",
              },
            ],
            next_cursor_str: "0",
          }),
      });

      const members = await fetchListMembers("list456");
      expect(members).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("createXList", () => {
    it("sends correct POST params and maps response", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id_str: "newlist1",
            name: "Biking",
            description: "Cycling folks",
            member_count: 0,
            mode: "private",
          }),
      });

      const result = await createXList("Biking", "Cycling folks", "private");
      expect(result).toEqual({
        id: "newlist1",
        name: "Biking",
        description: "Cycling folks",
        memberCount: 0,
        mode: "private",
      });

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://x.com/i/api/1.1/lists/create.json");
      expect(opts.method).toBe("POST");
    });
  });

  describe("addListMember", () => {
    it("sends POST with list_id and user_id", async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true });

      await addListMember("list1", "user1");
      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.method).toBe("POST");
      expect(opts.body.get("list_id")).toBe("list1");
      expect(opts.body.get("user_id")).toBe("user1");
    });

    it("retries once on 429", async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 429 });
      fetchSpy.mockResolvedValueOnce({ ok: true });

      await addListMember("list1", "user1");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("throws if retry also fails", async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 429 });
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(addListMember("list1", "user1")).rejects.toThrow(
        "lists/members/create.json error: 500",
      );
    });
  });
});
