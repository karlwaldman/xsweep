/**
 * AI-powered review engine: two-phase taxonomy + classification.
 * Phase A: Sample users → Sonnet generates taxonomy (10-15 categories)
 * Phase B: Classify all users against taxonomy in batches (Haiku)
 */

import type { UserProfile } from "./types";

export interface ReviewCategory {
  id: string;
  name: string;
  description: string;
  suggestion: "keep" | "review" | "unfollow";
  reason: string;
  userIds: string[];
}

export interface ReviewSession {
  id: string;
  createdAt: string;
  status: "generating-taxonomy" | "classifying" | "complete" | "error";
  progress: { done: number; total: number };
  taxonomy: string[];
  categories: ReviewCategory[];
  uncategorized: string[];
  error?: string;
}

const STORAGE_KEY = "xsweep_review_session";
const TAXONOMY_SAMPLE_SIZE = 300;
const CLASSIFY_BATCH_SIZE = 200;

export async function saveSession(session: ReviewSession): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: session });
}

export async function loadSession(): Promise<ReviewSession | null> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] ?? null;
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/**
 * Phase A: Sample users and generate a taxonomy of 10-15 categories.
 * Uses Sonnet for higher quality taxonomy generation.
 */
async function generateTaxonomy(
  users: UserProfile[],
  apiKey: string,
): Promise<ReviewCategory[]> {
  // Sample up to TAXONOMY_SAMPLE_SIZE users, preferring diversity
  const sample = sampleUsers(users, TAXONOMY_SAMPLE_SIZE);

  const userDescriptions = sample
    .map((u) => {
      const parts = [`@${u.username}`];
      if (u.bio) parts.push(`bio: "${u.bio}"`);
      parts.push(`${u.followerCount} followers`);
      if (u.status !== "active") parts.push(`(${u.status})`);
      return parts.join(" | ");
    })
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
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are analyzing a Twitter/X following list to help the user decide who to keep following.

Here are ${sample.length} accounts (username | bio | followers | status):
${userDescriptions}

Create 10-15 topic categories that meaningfully group these accounts.
For each category provide:
- id: short slug (e.g. "ai-ml", "crypto-defi", "news-media")
- name: human-readable name (e.g. "AI & Machine Learning")
- description: 1 sentence describing what accounts in this category are about
- suggestion: "keep" (high value, worth following), "review" (mixed value, user should decide), or "unfollow" (low value, likely not worth following)
- reason: 1 sentence explaining why you suggest this

Also create a "spam-bots" category for accounts that look like spam, bots, or crypto scams.

Think about: professional topics, hobbies, political leanings, content types (news vs memes vs personal), engagement quality, whether accounts are real people vs brands vs bots.

Return ONLY a JSON array of category objects. No other text.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Taxonomy API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "";

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Failed to parse taxonomy response — no JSON array found");
  }

  const categories = JSON.parse(jsonMatch[0]) as Array<{
    id: string;
    name: string;
    description: string;
    suggestion: "keep" | "review" | "unfollow";
    reason: string;
  }>;

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    suggestion: c.suggestion,
    reason: c.reason,
    userIds: [],
  }));
}

/**
 * Phase B: Classify a batch of users against the established taxonomy.
 * Uses Haiku for speed and cost efficiency.
 * Returns mapping of userId → categoryId[].
 */
async function classifyBatch(
  users: UserProfile[],
  taxonomy: ReviewCategory[],
  apiKey: string,
): Promise<Map<string, string[]>> {
  const categoryList = taxonomy
    .map((c) => `- "${c.id}": ${c.name} — ${c.description}`)
    .join("\n");

  const userDescriptions = users
    .map((u) => {
      const parts = [`${u.userId}: @${u.username}`];
      if (u.bio) parts.push(`"${u.bio}"`);
      parts.push(`${u.followerCount} followers`);
      if (u.status !== "active") parts.push(`(${u.status})`);
      return parts.join(" | ");
    })
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
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Classify these Twitter/X accounts into the provided categories.

Categories:
${categoryList}

Accounts (id: @username | bio | followers):
${userDescriptions}

Rules:
- Each account belongs to 1-2 categories max
- If no category fits, use "uncategorized"
- Accounts with no bio and few followers that look like bots → "spam-bots"

Return ONLY a JSON object mapping user IDs to arrays of category IDs.
Example: {"123": ["ai-ml"], "456": ["crypto-defi", "news-media"], "789": ["uncategorized"]}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error("[XSweep] Classify batch API error:", response.status);
    return new Map();
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[XSweep] Failed to parse classify response");
    return new Map();
  }

  try {
    const mapping = JSON.parse(jsonMatch[0]) as Record<string, string[]>;
    const result = new Map<string, string[]>();
    for (const [userId, cats] of Object.entries(mapping)) {
      result.set(userId, Array.isArray(cats) ? cats : [cats]);
    }
    return result;
  } catch (e) {
    console.error("[XSweep] JSON parse error in classify:", e);
    return new Map();
  }
}

/**
 * Full review orchestrator. Runs both phases and updates session state.
 */
export async function runFullReview(
  allUsers: UserProfile[],
  apiKey: string,
  onProgress: (session: ReviewSession) => void,
): Promise<ReviewSession> {
  const session: ReviewSession = {
    id: `review-${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: "generating-taxonomy",
    progress: { done: 0, total: allUsers.length },
    taxonomy: [],
    categories: [],
    uncategorized: [],
  };

  onProgress(session);
  await saveSession(session);

  try {
    // Phase A: Generate taxonomy
    const categories = await generateTaxonomy(allUsers, apiKey);
    session.categories = categories;
    session.taxonomy = categories.map((c) => c.id);
    session.status = "classifying";
    onProgress(session);
    await saveSession(session);

    // Phase B: Classify all users in batches
    for (let i = 0; i < allUsers.length; i += CLASSIFY_BATCH_SIZE) {
      const batch = allUsers.slice(i, i + CLASSIFY_BATCH_SIZE);
      const mapping = await classifyBatch(batch, categories, apiKey);

      for (const [userId, categoryIds] of mapping) {
        let placed = false;
        for (const catId of categoryIds) {
          if (catId === "uncategorized") {
            session.uncategorized.push(userId);
            placed = true;
          } else {
            const cat = session.categories.find((c) => c.id === catId);
            if (cat) {
              cat.userIds.push(userId);
              placed = true;
            }
          }
        }
        if (!placed) {
          session.uncategorized.push(userId);
        }
      }

      // Users not in mapping at all → uncategorized
      for (const user of batch) {
        if (!mapping.has(user.userId)) {
          session.uncategorized.push(user.userId);
        }
      }

      session.progress.done = Math.min(
        i + CLASSIFY_BATCH_SIZE,
        allUsers.length,
      );
      onProgress(session);
      await saveSession(session);
    }

    // Deduplicate uncategorized
    session.uncategorized = [...new Set(session.uncategorized)];

    // Sort categories by user count descending
    session.categories.sort((a, b) => b.userIds.length - a.userIds.length);

    session.status = "complete";
    onProgress(session);
    await saveSession(session);

    return session;
  } catch (error) {
    session.status = "error";
    session.error =
      error instanceof Error ? error.message : "Unknown error occurred";
    onProgress(session);
    await saveSession(session);
    return session;
  }
}

/**
 * Sample users for taxonomy generation.
 * Takes a diverse sample across follower tiers to get good category coverage.
 */
function sampleUsers(users: UserProfile[], size: number): UserProfile[] {
  if (users.length <= size) return [...users];

  // Split into tiers and sample proportionally
  const tiers = [
    users.filter((u) => u.followerCount >= 100000),
    users.filter((u) => u.followerCount >= 10000 && u.followerCount < 100000),
    users.filter((u) => u.followerCount >= 1000 && u.followerCount < 10000),
    users.filter((u) => u.followerCount >= 100 && u.followerCount < 1000),
    users.filter((u) => u.followerCount < 100),
  ];

  const result: UserProfile[] = [];
  const perTier = Math.floor(size / tiers.length);

  for (const tier of tiers) {
    const shuffled = [...tier].sort(() => Math.random() - 0.5);
    result.push(...shuffled.slice(0, perTier));
  }

  // Fill remaining slots from shuffled full list
  if (result.length < size) {
    const usedIds = new Set(result.map((u) => u.userId));
    const remaining = users
      .filter((u) => !usedIds.has(u.userId))
      .sort(() => Math.random() - 0.5);
    result.push(...remaining.slice(0, size - result.length));
  }

  return result;
}

/**
 * Compute quick stats from users (no AI needed).
 */
export interface QuickStats {
  total: number;
  tiers: {
    mega: number; // 100K+
    large: number; // 10K-100K
    mid: number; // 1K-10K
    small: number; // 100-1K
    micro: number; // <100
  };
  activity: {
    active: number;
    inactive: number; // 1y+
    ghost: number; // no tweets
    suspended: number;
  };
}

export function computeQuickStats(users: UserProfile[]): QuickStats {
  const stats: QuickStats = {
    total: users.length,
    tiers: { mega: 0, large: 0, mid: 0, small: 0, micro: 0 },
    activity: { active: 0, inactive: 0, ghost: 0, suspended: 0 },
  };

  for (const u of users) {
    // Follower tiers
    if (u.followerCount >= 100000) stats.tiers.mega++;
    else if (u.followerCount >= 10000) stats.tiers.large++;
    else if (u.followerCount >= 1000) stats.tiers.mid++;
    else if (u.followerCount >= 100) stats.tiers.small++;
    else stats.tiers.micro++;

    // Activity
    if (u.status === "suspended" || u.status === "deactivated") {
      stats.activity.suspended++;
    } else if (u.status === "no_tweets" || u.daysSinceLastTweet === null) {
      stats.activity.ghost++;
    } else if (u.daysSinceLastTweet > 365) {
      stats.activity.inactive++;
    } else {
      stats.activity.active++;
    }
  }

  return stats;
}
