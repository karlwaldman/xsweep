/**
 * Categorizer: Local keyword matching (free) + Claude AI categorization (pro).
 */

import type { UserProfile, SmartList } from "./types";

/**
 * FREE: Local keyword matching against user bio and display name.
 */
export function categorizeByKeywords(
  user: UserProfile,
  lists: SmartList[],
): number[] {
  const text = `${user.bio} ${user.displayName}`.toLowerCase();
  return lists
    .filter(
      (l) =>
        l.type === "keyword" &&
        l.id !== undefined &&
        l.keywords.some((k) => text.includes(k.toLowerCase())),
    )
    .map((l) => l.id!);
}

/**
 * Batch categorize all users against all keyword lists.
 */
export function batchCategorizeByKeywords(
  users: UserProfile[],
  lists: SmartList[],
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  const keywordLists = lists.filter((l) => l.type === "keyword");

  for (const user of users) {
    const matchedIds = categorizeByKeywords(user, keywordLists);
    if (matchedIds.length > 0) {
      result.set(user.userId, matchedIds);
    }
  }

  return result;
}

/**
 * PRO: Claude API categorization. Batches users in groups of 50.
 * Runs in background worker context.
 */
export async function categorizeWithAI(
  users: UserProfile[],
  lists: SmartList[],
  apiKey: string,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  const batchSize = 50;

  const listDescriptions = lists
    .filter((l) => l.type === "ai" && l.id !== undefined)
    .map((l) => `- "${l.name}" (id: ${l.id}): ${l.description}`)
    .join("\n");

  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);

    const userDescriptions = batch
      .map(
        (u) =>
          `- @${u.username} (id: ${u.userId}): "${u.displayName}" - "${u.bio}"`,
      )
      .join("\n");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: `Categorize these X/Twitter users into the following lists based on their bio and display name. Each user can belong to multiple lists or none.

Lists:
${listDescriptions}

Users:
${userDescriptions}

Respond with ONLY a JSON object mapping user IDs to arrays of list IDs. Example:
{"123": [1, 3], "456": [2]}

If a user doesn't match any list, omit them. Be generous with matching - if someone's bio suggests relevance to a list topic, include them.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("[XSweep] Claude API error:", response.status);
      continue;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const mapping = JSON.parse(jsonMatch[0]) as Record<string, number[]>;
        for (const [userId, listIds] of Object.entries(mapping)) {
          result.set(userId, listIds);
        }
      } catch (e) {
        console.error("[XSweep] Failed to parse AI response:", e);
      }
    }
  }

  return result;
}
