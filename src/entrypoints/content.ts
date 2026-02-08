/**
 * Content script: Injected on x.com pages.
 * Handles auth extraction, scanning, and unfollowing.
 * Communicates with side panel via chrome.runtime messages.
 */

import { extractBearerToken, isAuthenticated } from "../core/auth";
import {
  fullScan,
  stopScan,
  scanVerifiedFollowers,
  scanOwnTweets,
  stopMonetizationScan,
} from "../core/scanner";
import { bulkUnfollow, stopUnfollow } from "../core/unfollower";
import {
  fetchMyLists,
  fetchListMembers,
  createXList,
  addListMember,
} from "../core/lists-api";
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
            // Send batch to background for DB storage (extension-origin IndexedDB)
            await chrome.runtime.sendMessage({
              type: "STORE_USERS_BATCH",
              users: batch,
            });
          },
        );

        // Send final data to background for relationship update + storage
        await chrome.runtime.sendMessage({
          type: "FINALIZE_SCAN",
          followerIds: result.followerIds,
          followingIds: result.followingIds,
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

    case "FETCH_X_LISTS": {
      try {
        await extractBearerToken();
        const lists = await fetchMyLists();
        sendResponse({ success: true, lists });
      } catch (e) {
        const error = e instanceof Error ? e.message : "Unknown error";
        sendResponse({ success: false, error });
      }
      break;
    }

    case "FETCH_X_LIST_MEMBERS": {
      try {
        await extractBearerToken();
        const members = await fetchListMembers(message.listId);
        sendResponse({ success: true, members });
      } catch (e) {
        const error = e instanceof Error ? e.message : "Unknown error";
        sendResponse({ success: false, error });
      }
      break;
    }

    case "CREATE_X_LIST": {
      try {
        await extractBearerToken();
        const list = await createXList(
          message.name,
          message.description,
          message.mode,
        );
        sendResponse({ success: true, list });
      } catch (e) {
        const error = e instanceof Error ? e.message : "Unknown error";
        sendResponse({ success: false, error });
      }
      break;
    }

    case "ADD_X_LIST_MEMBER": {
      try {
        await extractBearerToken();
        await addListMember(message.listId, message.userId);
        sendResponse({ success: true });
      } catch (e) {
        const error = e instanceof Error ? e.message : "Unknown error";
        sendResponse({ success: false, error });
      }
      break;
    }

    case "SCAN_MONETIZATION": {
      try {
        await extractBearerToken();

        // Phase 1: Scan followers
        const followers = await scanVerifiedFollowers((progress) => {
          sendMessage({
            type: "MONETIZATION_PROGRESS",
            data: { phase: "followers", ...progress },
          });
        });

        // Phase 2: Scan own tweets
        const tweets = await scanOwnTweets((progress) => {
          sendMessage({
            type: "MONETIZATION_PROGRESS",
            data: { phase: "tweets", ...progress },
          });
        });

        sendMessage({
          type: "MONETIZATION_COMPLETE",
          data: {
            verifiedFollowers: followers.verified,
            totalFollowers: followers.total,
            organicImpressions: tweets.impressions,
            impressionsAvailable: tweets.impressionsAvailable,
            tweetsLast30Days: tweets.tweetsLast30,
            tweetsLast90Days: tweets.tweetsLast90,
            avgViewsPerTweet: tweets.avgViews,
            topTweetViews: tweets.topViews,
          },
        });
        sendResponse({ success: true });
      } catch (e) {
        const error = e instanceof Error ? e.message : "Unknown error";
        sendMessage({ type: "MONETIZATION_ERROR", error });
        sendResponse({ success: false, error });
      }
      break;
    }

    case "STOP_MONETIZATION": {
      stopMonetizationScan();
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
