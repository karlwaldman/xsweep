/**
 * Unfollower: Rate-limited unfollow with safety limits.
 * Ported from x-follow-cleaner.js.
 */

import { getHeaders, getCSRFToken } from "./auth";
import { delay } from "../utils/rate-limiter";

const MAX_DAILY_LIMIT = 400;
const DEFAULT_DAILY_LIMIT = 200;

let abortController: AbortController | null = null;

interface UnfollowConfig {
  dailyLimit: number;
  delayMin: number;
  delayMax: number;
  dryRun: boolean;
}

const defaultConfig: UnfollowConfig = {
  dailyLimit: DEFAULT_DAILY_LIMIT,
  delayMin: 30,
  delayMax: 60,
  dryRun: true,
};

export function stopUnfollow(): void {
  abortController?.abort();
  abortController = null;
}

async function unfollowSingle(userId: string): Promise<boolean> {
  try {
    const headers = {
      ...getHeaders(),
      "content-type": "application/x-www-form-urlencoded",
    };

    const resp = await fetch(
      "https://x.com/i/api/1.1/friendships/destroy.json",
      {
        method: "POST",
        headers,
        credentials: "include",
        body: new URLSearchParams({ user_id: userId }),
        signal: abortController?.signal,
      },
    );

    if (resp.status === 429) {
      console.log("[XSweep] Rate limited on unfollow. Waiting 5 min...");
      await delay(300, 360);
      return unfollowSingle(userId);
    }

    return resp.ok;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return false;
    console.error("[XSweep] Unfollow error:", e);
    return false;
  }
}

export interface UnfollowResult {
  userId: string;
  username: string;
  success: boolean;
}

type ProgressCallback = (done: number, total: number, current: string) => void;

/**
 * Bulk unfollow with rate limiting and daily caps.
 */
export async function bulkUnfollow(
  users: Array<{ userId: string; username: string }>,
  config: Partial<UnfollowConfig> = {},
  onProgress?: ProgressCallback,
): Promise<UnfollowResult[]> {
  const cfg = { ...defaultConfig, ...config };
  cfg.dailyLimit = Math.min(cfg.dailyLimit, MAX_DAILY_LIMIT);

  abortController = new AbortController();
  const results: UnfollowResult[] = [];

  // Check daily limit from storage
  const today = new Date().toISOString().split("T")[0];
  const storageKey = `xsweep_unfollow_${today}`;
  const storedCount = parseInt(
    (await chrome.storage.local.get(storageKey))[storageKey] || "0",
    10,
  );

  const remaining = cfg.dailyLimit - storedCount;
  if (remaining <= 0) {
    console.log("[XSweep] Daily limit reached. Try again tomorrow.");
    return [];
  }

  const batch = users.slice(0, remaining);

  for (let i = 0; i < batch.length; i++) {
    if (!abortController || abortController.signal.aborted) break;

    const user = batch[i];
    onProgress?.(i, batch.length, user.username);

    if (cfg.dryRun) {
      results.push({
        userId: user.userId,
        username: user.username,
        success: true,
      });
    } else {
      const success = await unfollowSingle(user.userId);
      results.push({ userId: user.userId, username: user.username, success });

      if (success) {
        const newCount = storedCount + i + 1;
        await chrome.storage.local.set({ [storageKey]: String(newCount) });
      }
    }

    if (i < batch.length - 1) {
      await delay(cfg.delayMin, cfg.delayMax);
    }
  }

  onProgress?.(batch.length, batch.length, "done");
  return results;
}

export function getDailyLimit(): number {
  return DEFAULT_DAILY_LIMIT;
}

export async function getTodayUnfollowCount(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  const storageKey = `xsweep_unfollow_${today}`;
  const stored = await chrome.storage.local.get(storageKey);
  return parseInt(stored[storageKey] || "0", 10);
}
