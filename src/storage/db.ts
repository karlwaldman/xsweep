/**
 * IndexedDB storage via Dexie.js.
 * Shared between content script and side panel.
 */

import Dexie, { type Table } from "dexie";
import type {
  UserProfile,
  SmartList,
  Snapshot,
  UnfollowEntry,
} from "../core/types";

class XSweepDB extends Dexie {
  users!: Table<UserProfile>;
  snapshots!: Table<Snapshot>;
  lists!: Table<SmartList>;
  unfollowLog!: Table<UnfollowEntry>;

  constructor(name = "xsweep") {
    super(name);
    this.version(1).stores({
      users: "userId, username, status, *listIds, scannedAt",
      snapshots: "++id, date",
      lists: "++id, name, type",
      unfollowLog: "++id, userId, date",
    });
    this.version(2).stores({
      users: "userId, username, status, *listIds, scannedAt",
      snapshots: "++id, date",
      lists: "++id, name, type, xListId",
      unfollowLog: "++id, userId, date",
    });
  }
}

// DB instance — scoped per X user to prevent data mixing across accounts
let db = new XSweepDB();

/**
 * Switch the DB to a user-scoped instance.
 * Call this when the logged-in X user is identified.
 */
export async function switchToUserDb(userId: string): Promise<void> {
  const dbName = `xsweep_${userId}`;
  if (db.name === dbName) return;
  db.close();
  db = new XSweepDB(dbName);
  await chrome.storage.local.set({ xsweep_active_user: userId });
}

/**
 * Restore the user-scoped DB from storage on startup.
 */
export async function restoreUserDb(): Promise<void> {
  try {
    const data = await chrome.storage.local.get("xsweep_active_user");
    if (data.xsweep_active_user) {
      const dbName = `xsweep_${data.xsweep_active_user}`;
      if (db.name !== dbName) {
        db.close();
        db = new XSweepDB(dbName);
      }
    }
  } catch {
    // Not in extension context (tests)
  }
}

// ---- User operations ----

export async function upsertUsers(users: UserProfile[]): Promise<void> {
  await db.users.bulkPut(users);
}

export async function getAllUsers(): Promise<UserProfile[]> {
  return db.users.toArray();
}

export async function getUsersByStatus(status: string): Promise<UserProfile[]> {
  return db.users.where("status").equals(status).toArray();
}

export async function getUserCount(): Promise<number> {
  return db.users.count();
}

export async function deleteUser(userId: string): Promise<void> {
  await db.users.delete(userId);
}

export async function clearUsers(): Promise<void> {
  await db.users.clear();
}

export async function updateUserListIds(
  userId: string,
  listIds: number[],
): Promise<void> {
  await db.users.update(userId, { listIds });
}

export async function getUsersByListId(listId: number): Promise<UserProfile[]> {
  return db.users.where("listIds").equals(listId).toArray();
}

// ---- Smart List operations ----

export async function createList(list: Omit<SmartList, "id">): Promise<number> {
  return db.lists.add(list as SmartList) as Promise<number>;
}

export async function getAllLists(): Promise<SmartList[]> {
  return db.lists.toArray();
}

export async function updateList(
  id: number,
  updates: Partial<SmartList>,
): Promise<void> {
  await db.lists.update(id, updates);
}

export async function deleteList(id: number): Promise<void> {
  // Remove list from all users
  const users = await getUsersByListId(id);
  for (const user of users) {
    await updateUserListIds(
      user.userId,
      user.listIds.filter((lid) => lid !== id),
    );
  }
  await db.lists.delete(id);
}

export async function getListCount(): Promise<number> {
  return db.lists.count();
}

export async function getListByXListId(
  xListId: string,
): Promise<SmartList | undefined> {
  return db.lists.where("xListId").equals(xListId).first();
}

// ---- Snapshot operations ----

export async function createSnapshot(
  snapshot: Omit<Snapshot, "id">,
): Promise<number> {
  return db.snapshots.add(snapshot as Snapshot) as Promise<number>;
}

export async function getLatestSnapshot(): Promise<Snapshot | undefined> {
  return db.snapshots.orderBy("date").last();
}

export async function getAllSnapshots(): Promise<Snapshot[]> {
  return db.snapshots.orderBy("date").toArray();
}

// ---- Unfollow Log ----

export async function logUnfollow(
  entry: Omit<UnfollowEntry, "id">,
): Promise<void> {
  await db.unfollowLog.add(entry as UnfollowEntry);
}

export async function getUnfollowLog(): Promise<UnfollowEntry[]> {
  return db.unfollowLog.orderBy("date").reverse().toArray();
}

export async function getUnfollowCount(): Promise<number> {
  return db.unfollowLog.count();
}

// ---- Bulk operations ----

export async function clearAllData(): Promise<void> {
  await db.users.clear();
  await db.snapshots.clear();
  await db.lists.clear();
  await db.unfollowLog.clear();
}

// ---- Test helpers ----

/** Reset DB between tests. Only use in test environment. */
export async function resetTestDb(): Promise<void> {
  await db.delete();
  await db.open();
}
