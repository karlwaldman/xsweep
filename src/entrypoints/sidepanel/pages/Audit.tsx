import { useEffect, useState } from "react";
import { getAllUsers } from "../../../storage/db";
import type { UserProfile, ScanProgress } from "../../../core/types";

type SortKey = "username" | "followerCount" | "daysSinceLastTweet" | "status";
type FilterStatus =
  | "all"
  | "active"
  | "inactive"
  | "suspended"
  | "no_tweets"
  | "mutual"
  | "non_mutual";

export default function Audit() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [sort, setSort] = useState<SortKey>("daysSinceLastTweet");
  const [sortDesc, setSortDesc] = useState(true);
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    loadUsers();
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

  async function loadUsers() {
    const all = await getAllUsers();
    setUsers(all);
  }

  const filtered = users
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
          <UserRow key={user.userId} user={user} />
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

function UserRow({ user }: { user: UserProfile }) {
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
        </div>
        <div className="text-xs text-x-text-secondary">
          @{user.username} · {user.followerCount.toLocaleString()} followers
        </div>
        {user.bio && (
          <div className="text-xs text-x-text-secondary mt-0.5 line-clamp-1">
            {user.bio}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end flex-shrink-0">
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
    </div>
  );
}
