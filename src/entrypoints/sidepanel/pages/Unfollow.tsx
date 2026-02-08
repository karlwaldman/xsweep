import { useEffect, useState } from "react";
import { getAllUsers, logUnfollow, getUnfollowLog } from "../../../storage/db";
import { getInactiveUsers } from "../../../core/relationships";
import { exportUsersCSV } from "../../../utils/export";
import { getTodayUnfollowCount, getDailyLimit } from "../../../core/unfollower";
import type { UserProfile, UnfollowEntry } from "../../../core/types";
import type { NavigateFn, ShowToastFn } from "../App";

interface Props {
  navigateTo: NavigateFn;
  showToast: ShowToastFn;
}

export default function Unfollow({ navigateTo, showToast }: Props) {
  const [inactive, setInactive] = useState<UserProfile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [unfollowing, setUnfollowing] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [todayCount, setTodayCount] = useState(0);
  const [recentLog, setRecentLog] = useState<UnfollowEntry[]>([]);
  const [whitelistInput, setWhitelistInput] = useState("");
  const [whitelist, setWhitelist] = useState<Set<string>>(new Set());
  const [protectMutuals, setProtectMutuals] = useState(true);
  const [protectVerified, setProtectVerified] = useState(true);
  const [minFollowers, setMinFollowers] = useState(0);

  useEffect(() => {
    loadData();
    // Load whitelist from storage
    chrome.storage.local.get("xsweep_whitelist").then((data) => {
      if (data.xsweep_whitelist) {
        setWhitelist(new Set(data.xsweep_whitelist));
      }
    });

    const listener = (message: { type: string }) => {
      if (message.type === "UNFOLLOW_COMPLETE") {
        setUnfollowing(false);
        setSelected(new Set());
        loadData();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  async function loadData() {
    const users = await getAllUsers();
    let filteredInactive = getInactiveUsers(users, whitelist);

    // Apply protection rules
    if (protectMutuals) {
      filteredInactive = filteredInactive.filter((u) => !u.isMutual);
    }
    if (protectVerified) {
      filteredInactive = filteredInactive.filter((u) => !u.isVerified);
    }
    if (minFollowers > 0) {
      filteredInactive = filteredInactive.filter(
        (u) => u.followerCount < minFollowers,
      );
    }

    // Sort: most inactive first
    filteredInactive.sort(
      (a, b) => (b.daysSinceLastTweet ?? 9999) - (a.daysSinceLastTweet ?? 9999),
    );

    setInactive(filteredInactive);
    setTodayCount(await getTodayUnfollowCount());
    setRecentLog(await getUnfollowLog());
  }

  function toggleSelect(userId: string) {
    const next = new Set(selected);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setSelected(next);
  }

  function selectAll() {
    if (selected.size === inactive.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(inactive.map((u) => u.userId)));
    }
  }

  async function handleUnfollow() {
    if (selected.size === 0) return;

    // Verify active tab is x.com before proceeding
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url?.includes("x.com")) {
      showToast("Navigate to x.com first, then try again.");
      return;
    }

    const count = selected.size;
    setUnfollowing(true);

    // Immediate feedback
    showToast(
      dryRun
        ? `Previewing ${count} accounts...`
        : `Got it! Cleaning up ${count} accounts in the background.`,
    );

    // Broadcast start so App.tsx shows progress banner
    chrome.runtime
      .sendMessage({
        type: "UNFOLLOW_STARTED",
        data: { total: count, done: 0 },
      })
      .catch(() => {});

    // Export backup first
    const toUnfollow = inactive.filter((u) => selected.has(u.userId));
    exportUsersCSV(toUnfollow, `xsweep_backup_before_unfollow.csv`);

    // Send unfollow command to content script
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: "START_UNFOLLOW",
        userIds: [...selected],
        dryRun,
      });
    }

    // Log the unfollows
    for (const user of toUnfollow) {
      await logUnfollow({
        userId: user.userId,
        username: user.username,
        date: new Date().toISOString(),
        reason: dryRun ? "dry_run" : user.status,
      });
    }
  }

  async function addToWhitelist() {
    if (!whitelistInput.trim()) return;
    const names = whitelistInput
      .split(",")
      .map((n) => n.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    const next = new Set([...whitelist, ...names]);
    setWhitelist(next);
    await chrome.storage.local.set({ xsweep_whitelist: [...next] });
    setWhitelistInput("");
    await loadData();
  }

  const dailyLimit = getDailyLimit();
  const remaining = dailyLimit - todayCount;

  if (inactive.length === 0 && !unfollowing) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <div className="text-4xl">✨</div>
        <div className="text-center space-y-1">
          <div className="text-sm font-medium">No inactive accounts found</div>
          <div className="text-xs text-x-text-secondary">
            Run a scan from the Dashboard to find accounts to clean up.
          </div>
        </div>
        <button
          onClick={() => navigateTo("dashboard")}
          className="px-4 py-2 bg-x-accent text-white rounded-full text-sm font-medium hover:bg-x-accent-hover transition-colors"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Safety Controls */}
      <div className="bg-x-card rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold">Safety Controls</h3>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="accent-x-accent"
          />
          Dry run (preview only, no actual unfollows)
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={protectMutuals}
            onChange={(e) => {
              setProtectMutuals(e.target.checked);
              loadData();
            }}
            className="accent-x-accent"
          />
          Protect mutual follows
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={protectVerified}
            onChange={(e) => {
              setProtectVerified(e.target.checked);
              loadData();
            }}
            className="accent-x-accent"
          />
          Protect verified accounts
        </label>

        <div className="flex items-center gap-2 text-sm">
          <span>Min followers to protect:</span>
          <input
            type="number"
            value={minFollowers}
            onChange={(e) => {
              setMinFollowers(parseInt(e.target.value) || 0);
              loadData();
            }}
            className="w-20 bg-x-bg border border-x-border rounded px-2 py-1 text-sm text-x-text"
          />
        </div>

        {/* Whitelist */}
        <div>
          <label className="text-xs text-x-text-secondary block mb-1">
            Whitelist (never unfollow)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={whitelistInput}
              onChange={(e) => setWhitelistInput(e.target.value)}
              placeholder="@user1, @user2"
              className="flex-1 bg-x-bg border border-x-border rounded px-2 py-1 text-sm text-x-text"
            />
            <button
              onClick={addToWhitelist}
              className="px-3 py-1 bg-x-border text-x-text rounded text-xs hover:bg-x-card"
            >
              Add
            </button>
          </div>
          {whitelist.size > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {[...whitelist].map((name) => (
                <span
                  key={name}
                  className="text-[10px] bg-x-border px-1.5 py-0.5 rounded"
                >
                  @{name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Daily Limit */}
      <div className="bg-x-card rounded-xl p-3 flex items-center justify-between">
        <span className="text-sm text-x-text-secondary">
          Today: {todayCount}/{dailyLimit}
        </span>
        <span className="text-xs text-x-text-secondary">
          {remaining} remaining
        </span>
      </div>

      {/* Select + Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={selectAll}
            className="text-xs text-x-accent hover:text-x-accent-hover"
          >
            {selected.size === inactive.length ? "Deselect all" : "Select all"}
          </button>
          <span className="text-xs text-x-text-secondary">
            {selected.size} selected of {inactive.length}
          </span>
        </div>

        <button
          onClick={handleUnfollow}
          disabled={selected.size === 0 || unfollowing || remaining <= 0}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            dryRun
              ? "bg-x-yellow/20 text-x-yellow hover:bg-x-yellow/30"
              : "bg-x-red/20 text-x-red hover:bg-x-red/30"
          } disabled:opacity-50`}
        >
          {unfollowing
            ? "Unfollowing..."
            : dryRun
              ? `Preview (${selected.size})`
              : `Unfollow ${selected.size}`}
        </button>
      </div>

      {/* User List */}
      <div className="space-y-1">
        {inactive.slice(0, 100).map((user) => (
          <label
            key={user.userId}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-x-card cursor-pointer transition-colors"
          >
            <input
              type="checkbox"
              checked={selected.has(user.userId)}
              onChange={() => toggleSelect(user.userId)}
              className="accent-x-accent flex-shrink-0"
            />
            {user.profileImageUrl ? (
              <img
                src={user.profileImageUrl}
                alt=""
                className="w-7 h-7 rounded-full flex-shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-x-border flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <a
                href={`https://x.com/${user.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm truncate text-x-accent hover:underline block"
                onClick={(e) => e.stopPropagation()}
              >
                @{user.username}
              </a>
              <div className="text-[10px] text-x-text-secondary">
                {user.status} · {user.daysSinceLastTweet ?? "N/A"} days ·{" "}
                {user.followerCount.toLocaleString()} followers
              </div>
            </div>
          </label>
        ))}
        {inactive.length > 100 && (
          <div className="text-xs text-x-text-secondary text-center py-2">
            Showing first 100 of {inactive.length}
          </div>
        )}
      </div>

      {/* Recent Unfollow Log */}
      {recentLog.length > 0 && (
        <div className="bg-x-card rounded-xl p-3">
          <h4 className="text-xs font-semibold mb-2">Recent Activity</h4>
          <div className="space-y-1">
            {recentLog.slice(0, 5).map((entry) => (
              <div key={entry.id} className="text-[10px] text-x-text-secondary">
                Unfollowed @{entry.username} -{" "}
                {new Date(entry.date).toLocaleDateString()}
                {entry.reason === "dry_run" && " (dry run)"}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
