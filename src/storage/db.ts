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

  constructor() {
    super("xsweep");
    this.version(1).stores({
      users: "userId, username, status, *listIds, scannedAt",
      snapshots: "++id, date",
      lists: "++id, name, type",
      unfollowLog: "++id, userId, date",
    });
  }
}

export const db = new XSweepDB();

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
