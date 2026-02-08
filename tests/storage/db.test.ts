import { describe, it, expect, beforeEach } from "vitest";
import {
  db,
  upsertUsers,
  getAllUsers,
  getUsersByStatus,
  getUserCount,
  clearUsers,
  updateUserListIds,
  getUsersByListId,
  createList,
  getAllLists,
  updateList,
  deleteList,
  getListCount,
  createSnapshot,
  getLatestSnapshot,
  getAllSnapshots,
  logUnfollow,
  getUnfollowLog,
  getUnfollowCount,
  clearAllData,
} from "@/storage/db";
import { makeUser, makeList, makeSnapshot } from "../helpers/fixtures";

describe("db", () => {
  beforeEach(async () => {
    // Reset DB between tests
    await db.delete();
    await db.open();
  });

  // ---- User operations ----

  describe("upsertUsers + getAllUsers", () => {
    it("round-trip store and retrieve", async () => {
      const users = [
        makeUser({ userId: "1", username: "alice" }),
        makeUser({ userId: "2", username: "bob" }),
      ];

      await upsertUsers(users);
      const result = await getAllUsers();

      expect(result).toHaveLength(2);
      expect(result.map((u) => u.username).sort()).toEqual(["alice", "bob"]);
    });
  });

  describe("upsertUsers", () => {
    it("updates existing user (upsert by userId)", async () => {
      await upsertUsers([makeUser({ userId: "1", username: "old_name" })]);
      await upsertUsers([makeUser({ userId: "1", username: "new_name" })]);

      const users = await getAllUsers();
      expect(users).toHaveLength(1);
      expect(users[0].username).toBe("new_name");
    });
  });

  describe("getUsersByStatus", () => {
    it("filters correctly", async () => {
      await upsertUsers([
        makeUser({ userId: "1", status: "active" }),
        makeUser({ userId: "2", status: "inactive" }),
        makeUser({ userId: "3", status: "active" }),
      ]);

      const inactive = await getUsersByStatus("inactive");
      expect(inactive).toHaveLength(1);
      expect(inactive[0].userId).toBe("2");
    });
  });

  describe("getUserCount", () => {
    it("returns correct count", async () => {
      await upsertUsers([
        makeUser({ userId: "1" }),
        makeUser({ userId: "2" }),
        makeUser({ userId: "3" }),
      ]);

      const count = await getUserCount();
      expect(count).toBe(3);
    });
  });

  describe("clearUsers", () => {
    it("empties the users table", async () => {
      await upsertUsers([makeUser({ userId: "1" }), makeUser({ userId: "2" })]);
      await clearUsers();

      const count = await getUserCount();
      expect(count).toBe(0);
    });
  });

  describe("updateUserListIds + getUsersByListId", () => {
    it("assigns and queries by list membership", async () => {
      await upsertUsers([
        makeUser({ userId: "1", listIds: [] }),
        makeUser({ userId: "2", listIds: [] }),
      ]);

      await updateUserListIds("1", [10, 20]);
      await updateUserListIds("2", [20, 30]);

      const list20 = await getUsersByListId(20);
      expect(list20).toHaveLength(2);

      const list10 = await getUsersByListId(10);
      expect(list10).toHaveLength(1);
      expect(list10[0].userId).toBe("1");
    });
  });

  // ---- Smart List operations ----

  describe("createList + getAllLists", () => {
    it("CRUD for smart lists", async () => {
      const id = await createList({
        name: "Tech",
        type: "keyword",
        keywords: ["dev"],
        description: "Tech people",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      });

      expect(typeof id).toBe("number");

      const lists = await getAllLists();
      expect(lists).toHaveLength(1);
      expect(lists[0].name).toBe("Tech");
      expect(lists[0].id).toBe(id);
    });
  });

  describe("updateList", () => {
    it("partial update", async () => {
      const id = await createList({
        name: "Old Name",
        type: "keyword",
        keywords: ["old"],
        description: "old desc",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      });

      await updateList(id, { name: "New Name", keywords: ["new", "updated"] });

      const lists = await getAllLists();
      expect(lists[0].name).toBe("New Name");
      expect(lists[0].keywords).toEqual(["new", "updated"]);
      // Description should be unchanged
      expect(lists[0].description).toBe("old desc");
    });
  });

  describe("deleteList", () => {
    it("removes list and cleans up user listIds", async () => {
      const listId = await createList({
        name: "ToDelete",
        type: "keyword",
        keywords: ["x"],
        description: "",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      });

      await upsertUsers([makeUser({ userId: "1", listIds: [listId, 99] })]);

      await deleteList(listId);

      const lists = await getAllLists();
      expect(lists).toHaveLength(0);

      const users = await getAllUsers();
      expect(users[0].listIds).toEqual([99]);
    });
  });

  describe("getListCount", () => {
    it("returns correct count", async () => {
      await createList({
        name: "A",
        type: "keyword",
        keywords: [],
        description: "",
        createdAt: "",
        updatedAt: "",
      });
      await createList({
        name: "B",
        type: "ai",
        keywords: [],
        description: "",
        createdAt: "",
        updatedAt: "",
      });

      const count = await getListCount();
      expect(count).toBe(2);
    });
  });

  // ---- Snapshot operations ----

  describe("createSnapshot + getLatestSnapshot", () => {
    it("stores and retrieves by date order", async () => {
      await createSnapshot(makeSnapshot({ date: "2026-01-01" }));
      await createSnapshot(makeSnapshot({ date: "2026-02-08" }));

      const latest = await getLatestSnapshot();
      expect(latest).toBeDefined();
      expect(latest!.date).toBe("2026-02-08");
    });
  });

  describe("getAllSnapshots", () => {
    it("returns in date order", async () => {
      await createSnapshot(makeSnapshot({ date: "2026-02-08" }));
      await createSnapshot(makeSnapshot({ date: "2026-01-01" }));
      await createSnapshot(makeSnapshot({ date: "2026-01-15" }));

      const all = await getAllSnapshots();
      expect(all).toHaveLength(3);
      expect(all.map((s) => s.date)).toEqual([
        "2026-01-01",
        "2026-01-15",
        "2026-02-08",
      ]);
    });
  });

  // ---- Unfollow Log ----

  describe("logUnfollow + getUnfollowLog", () => {
    it("stores and retrieves in reverse date order", async () => {
      await logUnfollow({
        userId: "1",
        username: "alice",
        date: "2026-01-01",
        reason: "inactive",
      });
      await logUnfollow({
        userId: "2",
        username: "bob",
        date: "2026-02-08",
        reason: "suspended",
      });

      const log = await getUnfollowLog();
      expect(log).toHaveLength(2);
      // Reverse order: newest first
      expect(log[0].username).toBe("bob");
      expect(log[1].username).toBe("alice");
    });
  });

  describe("getUnfollowCount", () => {
    it("returns correct count", async () => {
      await logUnfollow({ userId: "1", username: "a", date: "", reason: "" });
      await logUnfollow({ userId: "2", username: "b", date: "", reason: "" });
      await logUnfollow({ userId: "3", username: "c", date: "", reason: "" });

      const count = await getUnfollowCount();
      expect(count).toBe(3);
    });
  });

  // ---- Bulk operations ----

  describe("clearAllData", () => {
    it("empties all tables", async () => {
      await upsertUsers([makeUser({ userId: "1" })]);
      await createList({
        name: "X",
        type: "keyword",
        keywords: [],
        description: "",
        createdAt: "",
        updatedAt: "",
      });
      await createSnapshot(makeSnapshot());
      await logUnfollow({ userId: "1", username: "a", date: "", reason: "" });

      await clearAllData();

      expect(await getUserCount()).toBe(0);
      expect(await getListCount()).toBe(0);
      expect(await getUnfollowCount()).toBe(0);
      const snapshots = await getAllSnapshots();
      expect(snapshots).toHaveLength(0);
    });
  });
});
