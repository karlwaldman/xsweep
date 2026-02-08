/**
 * Content script: Injected on x.com pages.
 * Handles auth extraction, scanning, and unfollowing.
 * Communicates with side panel via chrome.runtime messages.
 */

import { extractBearerToken, getHeaders, getMyUserId } from "../core/auth";
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
        const { fullScan } = await import("../core/scanner");
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
          userId: getMyUserId(),
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
      const { stopScan } = await import("../core/scanner");
      stopScan();
      sendResponse({ success: true });
      break;
    }

    case "START_UNFOLLOW": {
      try {
        await extractBearerToken();
        const { bulkUnfollow } = await import("../core/unfollower");
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
      const { stopUnfollow } = await import("../core/unfollower");
      stopUnfollow();
      sendResponse({ success: true });
      break;
    }

    case "FETCH_X_LISTS": {
      try {
        await extractBearerToken();
        const { fetchMyLists } = await import("../core/lists-api");
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
        const { fetchListMembers } = await import("../core/lists-api");
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
        const { createXList } = await import("../core/lists-api");
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
        const { addListMember } = await import("../core/lists-api");
        await addListMember(message.listId, message.userId);
        sendResponse({ success: true });
      } catch (e) {
        const error = e instanceof Error ? e.message : "Unknown error";
        sendResponse({ success: false, error });
      }
      break;
    }

    case "FOLLOW_USER": {
      try {
        await extractBearerToken();
        const headers = {
          ...getHeaders(),
          "content-type": "application/x-www-form-urlencoded",
        };
        const resp = await fetch(
          "https://x.com/i/api/1.1/friendships/create.json",
          {
            method: "POST",
            headers,
            credentials: "include",
            body: new URLSearchParams({ user_id: message.userId }),
          },
        );
        if (resp.ok) {
          sendResponse({ success: true });
        } else {
          sendResponse({
            success: false,
            error: `friendships/create.json: ${resp.status}`,
          });
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : "Unknown error";
        sendResponse({ success: false, error });
      }
      break;
    }

    case "SCAN_MONETIZATION": {
      try {
        await extractBearerToken();
        const { scanVerifiedFollowers, scanOwnTweets } =
          await import("../core/scanner");
        const userId = getMyUserId();

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
            userId,
            verifiedFollowers: followers.verified,
            totalFollowers: followers.total,
            organicImpressions: tweets.impressions,
            impressionsAvailable: tweets.impressionsAvailable,
            tweetsLast30Days: tweets.tweetsLast30,
            tweetsLast90Days: tweets.tweetsLast90,
            avgViewsPerTweet: tweets.avgViews,
            topTweetViews: tweets.topViews,
            // Engagement metrics
            totalReplies: tweets.totalReplies,
            totalRetweets: tweets.totalRetweets,
            totalLikes: tweets.totalLikes,
            mediaTweetCount: tweets.mediaTweetCount,
            threadCount: tweets.threadCount,
            threadImpressions: tweets.threadImpressions,
            singleImpressions: tweets.singleImpressions,
            hourlyEngagement: Array.from(tweets.hourlyEngagement.entries()),
            dailyEngagement: Array.from(tweets.dailyEngagement.entries()),
            // Verified follower profiles
            topVerifiedFollowers: followers.topVerifiedFollowers,
            // Geographic distribution
            topLocations: followers.topLocations,
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
      const { stopMonetizationScan } = await import("../core/scanner");
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
