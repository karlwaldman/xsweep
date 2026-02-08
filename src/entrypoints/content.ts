/**
 * Content script: Injected on x.com pages.
 * Handles auth extraction, scanning, and unfollowing.
 * Communicates with side panel via chrome.runtime messages.
 */

import { extractBearerToken, isAuthenticated } from "../core/auth";
import { fullScan, stopScan } from "../core/scanner";
import { bulkUnfollow, stopUnfollow } from "../core/unfollower";
import { upsertUsers } from "../storage/db";
import type { MessageType, ScanProgress } from "../core/types";

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  runAt: "document_idle",

  async main() {
    console.log("[XSweep] Content script loaded on", location.href);

    // Try to extract bearer token on load
    try {
      await extractBearerToken();
      sendMessage({ type: "AUTH_STATUS", authenticated: true });
    } catch {
      console.log("[XSweep] Bearer token not available yet.");
    }

    // Listen for messages from side panel / background
    chrome.runtime.onMessage.addListener(
      (message: MessageType, _sender, sendResponse) => {
        handleMessage(message, sendResponse);
        return true; // keep message channel open for async response
      },
    );
  },
});

async function handleMessage(
  message: MessageType,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  switch (message.type) {
    case "GET_AUTH_STATUS": {
      try {
        await extractBearerToken();
        sendResponse({ authenticated: true });
      } catch {
        sendResponse({ authenticated: false });
      }
      break;
    }

    case "START_SCAN": {
      try {
        await extractBearerToken();
        const result = await fullScan(
          (progress: ScanProgress) => {
            sendMessage({ type: "SCAN_PROGRESS", data: progress });
          },
          async (batch) => {
            await upsertUsers(batch);
          },
        );

        // Save all users to DB (final state with relationships)
        await upsertUsers(result.users);

        // Store follower IDs for relationship computation
        await chrome.storage.local.set({
          xsweep_follower_ids: result.followerIds,
          xsweep_following_count: result.followingIds.length,
          xsweep_follower_count: result.followerIds.length,
          xsweep_last_scan: new Date().toISOString(),
        });

        sendMessage({
          type: "SCAN_COMPLETE",
          data: { totalUsers: result.users.length },
        });
        sendResponse({ success: true });
      } catch (e) {
        const error = e instanceof Error ? e.message : "Unknown error";
        sendMessage({ type: "SCAN_ERROR", error });
        sendResponse({ success: false, error });
      }
      break;
    }

    case "STOP_SCAN": {
      stopScan();
      sendResponse({ success: true });
      break;
    }

    case "START_UNFOLLOW": {
      try {
        await extractBearerToken();
        const users = message.userIds.map((id) => ({
          userId: id,
          username: id, // will be resolved from DB
        }));

        const results = await bulkUnfollow(
          users,
          { dryRun: message.dryRun },
          (done, total, current) => {
            sendMessage({
              type: "UNFOLLOW_PROGRESS",
              data: { done, total, current },
            });
          },
        );

        const successCount = results.filter((r) => r.success).length;
        sendMessage({
          type: "UNFOLLOW_COMPLETE",
          data: { count: successCount },
        });
        sendResponse({ success: true, count: successCount });
      } catch (e) {
        const error = e instanceof Error ? e.message : "Unknown error";
        sendResponse({ success: false, error });
      }
      break;
    }

    case "STOP_UNFOLLOW": {
      stopUnfollow();
      sendResponse({ success: true });
      break;
    }
  }
}

function sendMessage(message: MessageType): void {
  try {
    chrome.runtime.sendMessage(message);
  } catch {
    // Side panel might not be open
  }
}
