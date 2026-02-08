import { useEffect, useState, useRef } from "react";
import { getAllUsers, deleteUser, logUnfollow } from "../../../storage/db";
import { formatCount } from "../../../utils/format";
import {
  runFullReview,
  loadSession,
  clearSession,
  computeQuickStats,
  type ReviewSession,
  type ReviewCategory,
  type QuickStats,
} from "../../../core/reviewer";
import { exportUsersCSV } from "../../../utils/export";
import type { UserProfile } from "../../../core/types";
import type { NavigateFn, ShowToastFn } from "../App";

interface Props {
  navigateTo: NavigateFn;
  showToast: ShowToastFn;
}

export default function Review({ navigateTo, showToast }: Props) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [nonMutuals, setNonMutuals] = useState<UserProfile[]>([]);
  const [quickStats, setQuickStats] = useState<QuickStats | null>(null);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [showAllUsers, setShowAllUsers] = useState<Set<string>>(new Set());
  const [confirmUnfollow, setConfirmUnfollow] = useState<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const allUsers = await getAllUsers();
    setUsers(allUsers);

    const nm = allUsers.filter((u) => !u.isMutual);
    setNonMutuals(nm);
    setQuickStats(computeQuickStats(nm));

    const saved = await loadSession();
    if (saved) setSession(saved);

    setLoading(false);
  }

  async function handleAnalyze() {
    const apiKey = (await chrome.storage.local.get("xsweep_claude_api_key"))
      .xsweep_claude_api_key;

    if (!apiKey) {
      showToast("Add your Claude API key in Settings first");
      return;
    }

    if (nonMutuals.length === 0) {
      showToast("No non-mutual follows found. Run a scan first.");
      return;
    }

    cancelRef.current = false;
    setRunning(true);
    setExpandedCategories(new Set());
    setShowAllUsers(new Set());

    try {
      await runFullReview(nonMutuals, apiKey, (updated) => {
        setSession({ ...updated });
      });
    } finally {
      setRunning(false);
    }
  }

  async function handleReanalyze() {
    await clearSession();
    setSession(null);
    handleAnalyze();
  }

  function toggleCategory(categoryId: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  function toggleShowAll(categoryId: string) {
    setShowAllUsers((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  function getUserById(userId: string): UserProfile | undefined {
    return users.find((u) => u.userId === userId);
  }

  async function handleUnfollowCategory(category: ReviewCategory) {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url?.includes("x.com")) {
      showToast("Navigate to x.com first, then try again.");
      return;
    }

    const count = category.userIds.length;

    // Export backup
    const categoryUsers = category.userIds
      .map(getUserById)
      .filter(Boolean) as UserProfile[];
    exportUsersCSV(
      categoryUsers,
      `xsweep_backup_${category.id}_${Date.now()}.csv`,
    );

    // Broadcast start so App.tsx shows progress banner
    chrome.runtime
      .sendMessage({
        type: "UNFOLLOW_STARTED",
        data: { total: count, done: 0 },
      })
      .catch(() => {});

    showToast(`Unfollowing ${count} accounts from "${category.name}"...`);

    // Send unfollow command
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: "START_UNFOLLOW",
        userIds: category.userIds,
        dryRun: false,
      });
    }

    // Log unfollows
    for (const user of categoryUsers) {
      await logUnfollow({
        userId: user.userId,
        username: user.username,
        date: new Date().toISOString(),
        reason: `review:${category.id}`,
      });
    }

    setConfirmUnfollow(null);
  }

  async function handleProtectCategory(category: ReviewCategory) {
    const data = await chrome.storage.local.get("xsweep_whitelist");
    const existing: string[] = data.xsweep_whitelist || [];
    const usernames = category.userIds
      .map(getUserById)
      .filter(Boolean)
      .map((u) => (u as UserProfile).username.toLowerCase());

    const combined = [...new Set([...existing, ...usernames])];
    await chrome.storage.local.set({ xsweep_whitelist: combined });
    showToast(`Protected ${usernames.length} accounts from "${category.name}"`);
  }

  const suggestionColors: Record<string, { bg: string; text: string }> = {
    keep: { bg: "bg-x-green/20", text: "text-x-green" },
    review: { bg: "bg-x-yellow/20", text: "text-x-yellow" },
    unfollow: { bg: "bg-x-red/20", text: "text-x-red" },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-x-text-secondary">Loading...</div>
      </div>
    );
  }

  if (nonMutuals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <div className="text-4xl">🔍</div>
        <div className="text-center space-y-1">
          <div className="text-sm font-medium">No scan data yet</div>
          <div className="text-xs text-x-text-secondary">
            Run a scan from the Dashboard to find non-mutual follows.
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
      {/* Header */}
      <div>
        <h2 className="text-base font-bold">Review Your Following</h2>
        <p className="text-xs text-x-text-secondary mt-0.5">
          {nonMutuals.length.toLocaleString()} non-mutual follows
        </p>
      </div>

      {/* Action Button */}
      <div>
        {!session || session.status === "error" ? (
          <button
            onClick={handleAnalyze}
            disabled={running}
            className="w-full px-4 py-3 bg-x-accent text-white rounded-xl text-sm font-medium hover:bg-x-accent-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {running ? (
              <>
                <span className="animate-spin">&#9696;</span>
                Analyzing...
              </>
            ) : (
              <>Analyze with AI</>
            )}
          </button>
        ) : session.status === "complete" ? (
          <button
            onClick={handleReanalyze}
            disabled={running}
            className="w-full px-4 py-2 bg-x-card border border-x-border text-x-text rounded-xl text-sm hover:bg-x-border transition-colors disabled:opacity-50"
          >
            Re-analyze
          </button>
        ) : null}
      </div>

      {/* Progress Bar */}
      {session &&
        (session.status === "generating-taxonomy" ||
          session.status === "classifying") && (
          <div className="bg-x-card rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                {session.status === "generating-taxonomy"
                  ? "Generating taxonomy..."
                  : "Classifying accounts..."}
              </span>
              {session.status === "classifying" && (
                <span className="text-xs text-x-text-secondary">
                  {session.progress.done}/{session.progress.total}
                </span>
              )}
            </div>
            <div className="w-full bg-x-border rounded-full h-2">
              <div
                className="h-2 rounded-full bg-x-accent transition-all duration-500"
                style={{
                  width:
                    session.status === "generating-taxonomy"
                      ? "15%"
                      : `${session.progress.total > 0 ? (session.progress.done / session.progress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="text-[10px] text-x-text-secondary mt-1">
              {session.status === "generating-taxonomy"
                ? "Sampling accounts to build category taxonomy..."
                : `Processing batch ${Math.ceil(session.progress.done / 200)} of ${Math.ceil(session.progress.total / 200)}`}
            </div>
          </div>
        )}

      {/* Error */}
      {session?.status === "error" && session.error && (
        <div className="bg-x-red/10 border border-x-red/30 rounded-xl p-3">
          <div className="text-sm font-medium text-x-red">Analysis failed</div>
          <div className="text-xs text-x-text-secondary mt-1">
            {session.error}
          </div>
        </div>
      )}

      {/* Quick Stats */}
      {quickStats && (
        <div className="bg-x-card rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold">Quick Stats</h3>

          <div>
            <div className="text-[10px] text-x-text-secondary mb-1">
              By Follower Tier
            </div>
            <div className="flex flex-wrap gap-1.5">
              <StatBadge
                label="Mega (100K+)"
                count={quickStats.tiers.mega}
                color="text-x-accent"
              />
              <StatBadge
                label="Large (10K+)"
                count={quickStats.tiers.large}
                color="text-x-accent"
              />
              <StatBadge
                label="Mid (1K+)"
                count={quickStats.tiers.mid}
                color="text-x-text"
              />
              <StatBadge
                label="Small (100+)"
                count={quickStats.tiers.small}
                color="text-x-text-secondary"
              />
              <StatBadge
                label="Micro (<100)"
                count={quickStats.tiers.micro}
                color="text-x-text-secondary"
              />
            </div>
          </div>

          <div>
            <div className="text-[10px] text-x-text-secondary mb-1">
              By Activity
            </div>
            <div className="flex flex-wrap gap-1.5">
              <StatBadge
                label="Active"
                count={quickStats.activity.active}
                color="text-x-green"
              />
              <StatBadge
                label="Inactive (1y+)"
                count={quickStats.activity.inactive}
                color="text-x-yellow"
              />
              <StatBadge
                label="Ghost"
                count={quickStats.activity.ghost}
                color="text-x-orange"
              />
              <StatBadge
                label="Suspended"
                count={quickStats.activity.suspended}
                color="text-x-red"
              />
            </div>
          </div>
        </div>
      )}

      {/* AI Categories */}
      {session?.status === "complete" && session.categories.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">AI Analysis</h3>
            <span className="text-[10px] text-x-text-secondary">
              {session.categories.length} categories
              {session.uncategorized.length > 0 &&
                ` + ${session.uncategorized.length} uncategorized`}
            </span>
          </div>

          {session.categories.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              expanded={expandedCategories.has(category.id)}
              showAll={showAllUsers.has(category.id)}
              confirmingUnfollow={confirmUnfollow === category.id}
              getUserById={getUserById}
              onToggle={() => toggleCategory(category.id)}
              onToggleShowAll={() => toggleShowAll(category.id)}
              onUnfollow={() => {
                if (confirmUnfollow === category.id) {
                  handleUnfollowCategory(category);
                } else {
                  setConfirmUnfollow(category.id);
                }
              }}
              onCancelUnfollow={() => setConfirmUnfollow(null)}
              onProtect={() => handleProtectCategory(category)}
              suggestionColors={suggestionColors}
            />
          ))}

          {/* Uncategorized */}
          {session.uncategorized.length > 0 && (
            <div className="bg-x-card rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">Uncategorized</span>
                  <span className="text-xs text-x-text-secondary ml-2">
                    {session.uncategorized.length} accounts
                  </span>
                </div>
              </div>
              <div className="text-xs text-x-text-secondary mt-1">
                Accounts that didn't fit any category. Review individually in
                the Audit tab.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatBadge({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <span className="flex items-center gap-1 bg-x-bg px-2 py-1 rounded text-[11px]">
      <span className={`font-semibold ${color}`}>{formatCount(count)}</span>
      <span className="text-x-text-secondary">{label}</span>
    </span>
  );
}

function CategoryCard({
  category,
  expanded,
  showAll,
  confirmingUnfollow,
  getUserById,
  onToggle,
  onToggleShowAll,
  onUnfollow,
  onCancelUnfollow,
  onProtect,
  suggestionColors,
}: {
  category: ReviewCategory;
  expanded: boolean;
  showAll: boolean;
  confirmingUnfollow: boolean;
  getUserById: (id: string) => UserProfile | undefined;
  onToggle: () => void;
  onToggleShowAll: () => void;
  onUnfollow: () => void;
  onCancelUnfollow: () => void;
  onProtect: () => void;
  suggestionColors: Record<string, { bg: string; text: string }>;
}) {
  const colors = suggestionColors[category.suggestion] || {
    bg: "bg-x-border",
    text: "text-x-text-secondary",
  };
  const previewCount = 5;
  const displayUsers = showAll
    ? category.userIds
    : category.userIds.slice(0, previewCount);

  return (
    <div className="bg-x-card rounded-xl overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-x-bg/50 transition-colors"
      >
        <span className="text-xs mt-0.5 text-x-text-secondary">
          {expanded ? "▾" : "▸"}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{category.name}</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors.bg} ${colors.text}`}
            >
              {category.suggestion}
            </span>
            <span className="text-[10px] text-x-text-secondary">
              {category.userIds.length} accounts
            </span>
          </div>
          <div className="text-xs text-x-text-secondary mt-0.5">
            {category.description}
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* AI Reason */}
          <div className="text-xs text-x-text-secondary italic">
            {category.reason}
          </div>

          {/* User preview */}
          <div className="space-y-1">
            {displayUsers.map((userId) => {
              const user = getUserById(userId);
              if (!user) return null;
              return (
                <div key={userId} className="flex items-center gap-2 py-1">
                  {user.profileImageUrl ? (
                    <img
                      src={user.profileImageUrl}
                      alt=""
                      className="w-6 h-6 rounded-full flex-shrink-0"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-x-border flex-shrink-0" />
                  )}
                  <a
                    href={`https://x.com/${user.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-x-accent hover:underline truncate"
                  >
                    @{user.username}
                  </a>
                  <span className="text-[10px] text-x-text-secondary truncate">
                    {formatCount(user.followerCount)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Show more/less */}
          {category.userIds.length > previewCount && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleShowAll();
              }}
              className="text-[10px] text-x-accent hover:text-x-accent-hover"
            >
              {showAll
                ? "Show less"
                : `Show all ${category.userIds.length} accounts`}
            </button>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {category.suggestion === "unfollow" || confirmingUnfollow ? (
              confirmingUnfollow ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnfollow();
                    }}
                    className="px-3 py-1.5 bg-x-red/20 text-x-red rounded-lg text-xs font-medium hover:bg-x-red/30 transition-colors"
                  >
                    Confirm unfollow {category.userIds.length}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelUnfollow();
                    }}
                    className="px-3 py-1.5 bg-x-border text-x-text-secondary rounded-lg text-xs hover:bg-x-card transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnfollow();
                  }}
                  className="px-3 py-1.5 bg-x-red/20 text-x-red rounded-lg text-xs font-medium hover:bg-x-red/30 transition-colors"
                >
                  Unfollow all
                </button>
              )
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUnfollow();
                }}
                className="px-3 py-1.5 bg-x-border text-x-text-secondary rounded-lg text-xs hover:text-x-text transition-colors"
              >
                Unfollow all
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                onProtect();
              }}
              className="px-3 py-1.5 bg-x-green/20 text-x-green rounded-lg text-xs font-medium hover:bg-x-green/30 transition-colors"
            >
              Protect all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
