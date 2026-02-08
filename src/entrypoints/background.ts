/**
 * Background service worker.
 * Handles side panel opening and AI categorization.
 */

import { categorizeWithAI } from "../core/categorizer";
import {
  getAllUsers,
  getAllLists,
  updateUserListIds,
  upsertUsers,
} from "../storage/db";
import type { MessageType } from "../core/types";

export default defineBackground(() => {
  console.log("[XSweep] Background worker started");

  // Open side panel when extension icon is clicked
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  });

  // Handle messages
  chrome.runtime.onMessage.addListener(
    (message: MessageType, _sender, sendResponse) => {
      if (message.type === "OPEN_SIDEPANEL") {
        chrome.tabs.query(
          { active: true, currentWindow: true },
          async (tabs) => {
            if (tabs[0]?.id) {
              await chrome.sidePanel.open({ tabId: tabs[0].id });
            }
          },
        );
        sendResponse({ success: true });
        return true;
      }

      if (message.type === "STORE_USERS_BATCH") {
        upsertUsers(message.users)
          .then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true;
      }

      if (message.type === "FINALIZE_SCAN") {
        handleFinalizeScan(message.followerIds, message.followingIds)
          .then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true;
      }

      if (message.type === "CATEGORIZE_AI") {
        handleAICategorization(message.listId, message.apiKey)
          .then(() => {
            chrome.runtime.sendMessage({
              type: "CATEGORIZE_AI_COMPLETE",
              listId: message.listId,
            });
            sendResponse({ success: true });
          })
          .catch((e) => {
            sendResponse({ success: false, error: e.message });
          });
        return true;
      }

      return false;
    },
  );

  // Relay messages between content script and side panel
  chrome.runtime.onMessage.addListener((message: MessageType) => {
    if (
      message.type === "SCAN_PROGRESS" ||
      message.type === "SCAN_COMPLETE" ||
      message.type === "SCAN_ERROR" ||
      message.type === "UNFOLLOW_STARTED" ||
      message.type === "UNFOLLOW_PROGRESS" ||
      message.type === "UNFOLLOW_COMPLETE" ||
      message.type === "AUTH_STATUS" ||
      message.type === "MONETIZATION_PROGRESS" ||
      message.type === "MONETIZATION_COMPLETE" ||
      message.type === "MONETIZATION_ERROR"
    ) {
      // Broadcast to all extension pages (side panel will pick it up)
      chrome.runtime.sendMessage(message).catch(() => {
        // No listener available
      });
    }
  });
});

async function handleFinalizeScan(
  followerIds: string[],
  followingIds: string[],
): Promise<void> {
  // Store counts in chrome.storage.local
  await chrome.storage.local.set({
    xsweep_follower_ids: followerIds,
    xsweep_following_count: followingIds.length,
    xsweep_follower_count: followerIds.length,
    xsweep_last_scan: new Date().toISOString(),
  });

  // Update relationship fields on all stored users
  const followerSet = new Set(followerIds.map(String));
  const users = await getAllUsers();
  for (const user of users) {
    user.isFollower = followerSet.has(user.userId);
    user.isMutual = followerSet.has(user.userId);
  }
  await upsertUsers(users);
}

async function handleAICategorization(
  listId: number,
  apiKey: string,
): Promise<void> {
  const users = await getAllUsers();
  const lists = await getAllLists();
  const targetList = lists.find((l) => l.id === listId);

  if (!targetList) throw new Error("List not found");

  const mapping = await categorizeWithAI(users, [targetList], apiKey);

  for (const [userId, listIds] of mapping) {
    const user = users.find((u) => u.userId === userId);
    if (user) {
      const newListIds = [...new Set([...user.listIds, ...listIds])];
      await updateUserListIds(userId, newListIds);
    }
  }
}
