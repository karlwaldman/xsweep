/**
 * X/Twitter Lists API operations.
 * Uses v1.1 REST endpoints (stable, no feature flags needed).
 */

import { getHeaders, getMyUserId } from "./auth";
import { delay } from "../utils/rate-limiter";

export interface XList {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  mode: "public" | "private";
}

export interface XListMember {
  userId: string;
  username: string;
  displayName: string;
  profileImageUrl: string;
}

/**
 * Fetch all lists owned by the authenticated user.
 */
export async function fetchMyLists(): Promise<XList[]> {
  const userId = getMyUserId();
  const params = new URLSearchParams({
    user_id: userId,
    reverse: "true",
  });

  const resp = await fetch(
    `https://x.com/i/api/1.1/lists/list.json?${params}`,
    { headers: getHeaders(), credentials: "include" },
  );

  if (!resp.ok) {
    throw new Error(`lists/list.json error: ${resp.status}`);
  }

  const data: Array<{
    id_str: string;
    name: string;
    description: string;
    member_count: number;
    mode: string;
    user: { id_str: string };
  }> = await resp.json();

  // Only return lists we own (not subscribed)
  return data
    .filter((l) => l.user.id_str === userId)
    .map((l) => ({
      id: l.id_str,
      name: l.name,
      description: l.description || "",
      memberCount: l.member_count,
      mode: l.mode === "private" ? "private" : "public",
    }));
}

/**
 * Fetch members of a specific list.
 */
export async function fetchListMembers(listId: string): Promise<XListMember[]> {
  const allMembers: XListMember[] = [];
  let cursor = "-1";

  while (true) {
    const params = new URLSearchParams({
      list_id: listId,
      count: "5000",
      cursor,
      skip_status: "true",
      include_entities: "false",
    });

    const resp = await fetch(
      `https://x.com/i/api/1.1/lists/members.json?${params}`,
      { headers: getHeaders(), credentials: "include" },
    );

    if (resp.status === 429) {
      await delay(60, 90);
      continue;
    }

    if (!resp.ok) {
      throw new Error(`lists/members.json error: ${resp.status}`);
    }

    const data = await resp.json();
    const users = data.users || [];

    for (const u of users) {
      allMembers.push({
        userId: String(u.id_str || u.id),
        username: u.screen_name || "",
        displayName: u.name || "",
        profileImageUrl: u.profile_image_url_https || "",
      });
    }

    const nextCursor = data.next_cursor_str;
    if (!nextCursor || nextCursor === "0") break;
    cursor = nextCursor;

    await delay(1, 2);
  }

  return allMembers;
}

/**
 * Create a new X list.
 */
export async function createXList(
  name: string,
  description: string,
  mode: "public" | "private" = "private",
): Promise<XList> {
  const params = new URLSearchParams({ name, description, mode });

  const resp = await fetch("https://x.com/i/api/1.1/lists/create.json", {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: params,
  });

  if (!resp.ok) {
    throw new Error(`lists/create.json error: ${resp.status}`);
  }

  const data = await resp.json();
  return {
    id: data.id_str,
    name: data.name,
    description: data.description || "",
    memberCount: data.member_count || 0,
    mode: data.mode === "private" ? "private" : "public",
  };
}

/**
 * Add a member to an X list.
 */
export async function addListMember(
  listId: string,
  userId: string,
): Promise<void> {
  const params = new URLSearchParams({ list_id: listId, user_id: userId });

  const resp = await fetch(
    "https://x.com/i/api/1.1/lists/members/create.json",
    {
      method: "POST",
      headers: getHeaders(),
      credentials: "include",
      body: params,
    },
  );

  if (resp.status === 429) {
    await delay(30, 60);
    // Retry once
    const retry = await fetch(
      "https://x.com/i/api/1.1/lists/members/create.json",
      {
        method: "POST",
        headers: getHeaders(),
        credentials: "include",
        body: params,
      },
    );
    if (!retry.ok) {
      throw new Error(`lists/members/create.json error: ${retry.status}`);
    }
    return;
  }

  if (!resp.ok) {
    throw new Error(`lists/members/create.json error: ${resp.status}`);
  }
}
