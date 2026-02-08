/**
 * Export utilities for CSV/JSON download.
 */

import type { UserProfile } from "../core/types";

function sanitizeCSVField(value: string): string {
  let safe = value.replace(/"/g, '""').replace(/\n/g, " ");
  // Prevent CSV formula injection in Excel
  if (/^[=+\-@\t\r]/.test(safe)) {
    safe = `'${safe}`;
  }
  return `"${safe}"`;
}

function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  // Chrome extension sidepanels can't trigger downloads via DOM <a> click.
  // Use chrome.downloads API when available (real extension context).
  if (typeof chrome !== "undefined" && chrome.downloads?.download) {
    const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
    chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
    return;
  }

  // Fallback for non-extension contexts (tests, standalone pages)
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportUsersCSV(users: UserProfile[], filename?: string): void {
  const headers = [
    "username",
    "display_name",
    "user_id",
    "follower_count",
    "following_count",
    "tweet_count",
    "last_tweet_date",
    "days_inactive",
    "status",
    "is_mutual",
    "verified",
    "bio",
  ];

  const rows = users.map((u) => {
    const days = u.daysSinceLastTweet ?? "N/A";
    return [
      sanitizeCSVField(u.username),
      sanitizeCSVField(u.displayName || ""),
      u.userId,
      u.followerCount,
      u.followingCount,
      u.tweetCount,
      u.lastTweetDate ? u.lastTweetDate.split("T")[0] : "N/A",
      days,
      u.status,
      u.isMutual ? "yes" : "no",
      u.isVerified ? "yes" : "no",
      sanitizeCSVField(u.bio || ""),
    ].join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  const date = new Date().toISOString().split("T")[0];
  downloadFile(csv, filename || `xsweep_export_${date}.csv`, "text/csv");
}

export function exportUsersJSON(users: UserProfile[], filename?: string): void {
  const json = JSON.stringify(users, null, 2);
  const date = new Date().toISOString().split("T")[0];
  downloadFile(
    json,
    filename || `xsweep_export_${date}.json`,
    "application/json",
  );
}
