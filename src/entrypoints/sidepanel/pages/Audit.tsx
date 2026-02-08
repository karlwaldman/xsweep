import { useEffect, useState, useRef } from "react";
import { getAllUsers, deleteUser, logUnfollow } from "../../../storage/db";
import type { UserProfile, ScanProgress } from "../../../core/types";
import type { NavigateFn, ShowToastFn } from "../App";

type SortKey = "username" | "followerCount" | "daysSinceLastTweet" | "status";
type FilterStatus =
  | "all"
  | "active"
  | "inactive"
  | "suspended"
  | "no_tweets"
  | "mutual"
  | "non_mutual";

interface Props {
  initialFilter?: string;
  navigateTo: NavigateFn;
  showToast: ShowToastFn;
}

export default function Audit({ initialFilter, navigateTo, showToast }: Props) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [filter, setFilter] = useState<FilterStatus>(
    (initialFilter as FilterStatus) || "all",
  );
  const [sort, setSort] = useState<SortKey>("daysSinceLastTweet");
  const [sortDesc, setSortDesc] = useState(true);
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [page, setPage] = useState(0);
  const [whitelist, setWhitelist] = useState<Set<string>>(new Set());
  const [removedUsers, setRemovedUsers] = useState<Set<string>>(new Set());
  const pendingUnfollows = useRef<
    Map<string, { timer: ReturnType<typeof setTimeout>; user: UserProfile }>
  >(new Map());
  const PAGE_SIZE = 50;

  useEffect(() => {
    loadUsers();
    loadWhitelist();
    const listener = (message: { type: string; data?: ScanProgress }) => {
      if (message.type === "SCAN_PROGRESS" && message.data) {
        setScanning(true);
        setProgress(message.data);
      }
      if (message.type === "SCAN_COMPLETE") {
        setScanning(false);
        setProgress(null);
        loadUsers();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Reset filter when initialFilter prop changes
  useEffect(() => {
    if (initialFilter) {
      setFilter(initialFilter as FilterStatus);
      setPage(0);
    }
  }, [initialFilter]);

  async function loadUsers() {
    const all = await getAllUsers();
    setUsers(all);
  }

  async function loadWhitelist() {
    const data = await chrome.storage.local.get("xsweep_whitelist");
    if (data.xsweep_whitelist) {
      setWhitelist(new Set(data.xsweep_whitelist));
    }
  }

  function handleInlineUnfollow(user: UserProfile) {
    // Optimistically remove from view immediately
    setRemovedUsers((prev) => new Set([...prev, user.userId]));

    // Set a 4-second timer before actually executing
    const timer = setTimeout(async () => {
      pendingUnfollows.current.delete(user.userId);

      // Actually execute the unfollow
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.url?.includes("x.com") && tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: "START_UNFOLLOW",
          userIds: [user.userId],
          dryRun: false,
        });
      }

      // Remove from DB and log
      await deleteUser(user.userId);
      await logUnfollow({
        userId: user.userId,
        username: user.username,
        date: new Date().toISOString(),
        reason: user.status,
      });
    }, 4000);

    pendingUnfollows.current.set(user.userId, { timer, user });

    // Toast with working undo
    showToast(`Unfollowed @${user.username}`, {
      label: "Undo",
      onClick: () => {
        // Cancel the pending unfollow
        const pending = pendingUnfollows.current.get(user.userId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingUnfollows.current.delete(user.userId);
        }
        // Restore the user in the list
        setRemovedUsers((prev) => {
          const next = new Set(prev);
          next.delete(user.userId);
          return next;
        });
        showToast(`Restored @${user.username}`);
      },
    });
  }

  async function handleProtect(user: UserProfile) {
    const next = new Set([...whitelist, user.username.toLowerCase()]);
    setWhitelist(next);
    await chrome.storage.local.set({ xsweep_whitelist: [...next] });
    showToast(`Protected @${user.username}`);
  }

  const filtered = users
    .filter((u) => !removedUsers.has(u.userId))
    .filter((u) => !whitelist.has(u.username.toLowerCase()) || filter === "all")
    .filter((u) => {
      if (filter === "mutual") return u.isMutual;
      if (filter === "non_mutual") return !u.isMutual && !u.isFollower;
      if (filter !== "all") return u.status === filter;
      return true;
    })
    .filter((u) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.bio.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case "username":
          cmp = a.username.localeCompare(b.username);
          break;
        case "followerCount":
          cmp = a.followerCount - b.followerCount;
          break;
        case "daysSinceLastTweet":
          cmp = (a.daysSinceLastTweet ?? 9999) - (b.daysSinceLastTweet ?? 9999);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDesc ? -cmp : cmp;
    });

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  return (
    <div className="p-4 space-y-3">
      {/* Scan Progress */}
      {scanning && progress && (
        <div className="bg-x-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {progress.phase === "collecting-ids"
                ? "Collecting IDs..."
                : progress.phase === "scanning-users"
                  ? "Scanning profiles..."
                  : progress.phase === "computing-relationships"
                    ? "Computing relationships..."
                    : "Scanning..."}
            </span>
            <span className="text-xs text-x-text-secondary">
              {progress.scannedUsers}/{progress.totalIds || "?"}
            </span>
          </div>
          <div className="w-full bg-x-border rounded-full h-2">
            <div
              className="h-2 rounded-full bg-x-accent transition-all"
              style={{
                width: `${progress.totalIds > 0 ? (progress.scannedUsers / progress.totalIds) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search users..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          className="flex-1 bg-x-card border border-x-border rounded-lg px-3 py-2 text-sm text-x-text placeholder-x-text-secondary focus:border-x-accent focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["all", "All"],
            ["active", "Active"],
            ["inactive", "Inactive"],
            ["suspended", "Suspended"],
            ["no_tweets", "No tweets"],
            ["mutual", "Mutual"],
            ["non_mutual", "Non-mutual"],
          ] as [FilterStatus, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => {
              setFilter(value);
              setPage(0);
            }}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === value
                ? "bg-x-accent text-white"
                : "bg-x-card text-x-text-secondary hover:text-x-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2 text-xs text-x-text-secondary">
        <span>Sort:</span>
        {(
          [
            ["daysSinceLastTweet", "Last active"],
            ["followerCount", "Followers"],
            ["username", "Username"],
          ] as [SortKey, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              if (sort === key) setSortDesc(!sortDesc);
              else {
                setSort(key);
                setSortDesc(true);
              }
            }}
            className={`${sort === key ? "text-x-accent" : "hover:text-x-text"}`}
          >
            {label} {sort === key ? (sortDesc ? "↓" : "↑") : ""}
          </button>
        ))}
      </div>

      {/* Results count */}
      <div className="text-xs text-x-text-secondary">
        {filtered.length.toLocaleString()} users
      </div>

      {/* User List */}
      <div className="space-y-1">
        {paginated.map((user) => (
          <UserRow
            key={user.userId}
            user={user}
            isProtected={whitelist.has(user.username.toLowerCase())}
            onUnfollow={() => handleInlineUnfollow(user)}
            onProtect={() => handleProtect(user)}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="text-xs text-x-text-secondary hover:text-x-text disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-xs text-x-text-secondary">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="text-xs text-x-text-secondary hover:text-x-text disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function UserRow({
  user,
  isProtected,
  onUnfollow,
  onProtect,
}: {
  user: UserProfile;
  isProtected: boolean;
  onUnfollow: () => void;
  onProtect: () => void;
}) {
  const statusColors: Record<string, string> = {
    active: "text-x-green",
    inactive: "text-x-yellow",
    suspended: "text-x-red",
    deactivated: "text-x-red",
    no_tweets: "text-x-text-secondary",
    error: "text-x-red",
  };

  return (
    <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-x-card transition-colors">
      {user.profileImageUrl ? (
        <img
          src={user.profileImageUrl}
          alt=""
          className="w-8 h-8 rounded-full flex-shrink-0"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-x-border flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">
            {user.displayName}
          </span>
          {user.isMutual && (
            <span className="text-[10px] bg-x-accent/20 text-x-accent px-1 rounded">
              mutual
            </span>
          )}
          {user.isVerified && <span className="text-[10px]">✓</span>}
          {isProtected && (
            <span className="text-[10px] bg-x-green/20 text-x-green px-1 rounded">
              protected
            </span>
          )}
        </div>
        <div className="text-xs text-x-text-secondary">
          <a
            href={`https://x.com/${user.username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-x-accent hover:underline"
          >
            @{user.username}
          </a>
          {" · "}
          {user.followerCount.toLocaleString()} followers
        </div>
        {user.bio && (
          <div className="text-xs text-x-text-secondary mt-0.5 line-clamp-1">
            {user.bio}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <div className="flex flex-col items-end mr-1">
          <span
            className={`text-[10px] font-medium ${statusColors[user.status] || ""}`}
          >
            {user.status}
          </span>
          {user.daysSinceLastTweet !== null && (
            <span className="text-[10px] text-x-text-secondary">
              {user.daysSinceLastTweet}d ago
            </span>
          )}
        </div>
        {/* Protect button */}
        {!isProtected && (
          <button
            onClick={onProtect}
            className="p-1 text-x-text-secondary hover:text-x-green transition-colors"
            title="Protect (never unfollow)"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </button>
        )}
        {/* Unfollow button — single click, undo via toast */}
        <button
          onClick={onUnfollow}
          className="p-1 text-x-text-secondary hover:text-x-red transition-colors"
          title="Unfollow"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
