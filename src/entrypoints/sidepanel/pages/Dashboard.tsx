import { useEffect, useState } from "react";
import {
  getAllUsers,
  getAllLists,
  getUsersByListId,
} from "../../../storage/db";
import {
  computeAuditCounts,
  computeAccountHealth,
} from "../../../core/relationships";
import type {
  AuditCounts,
  AccountHealth,
  SmartList,
} from "../../../core/types";

interface ListWithCount extends SmartList {
  userCount: number;
}

export default function Dashboard() {
  const [counts, setCounts] = useState<AuditCounts | null>(null);
  const [health, setHealth] = useState<AccountHealth | null>(null);
  const [lists, setLists] = useState<ListWithCount[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    loadData();
    const listener = (message: { type: string }) => {
      if (message.type === "SCAN_COMPLETE") {
        setScanning(false);
        loadData();
      }
      if (message.type === "SCAN_PROGRESS") {
        setScanning(true);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  async function loadData() {
    const users = await getAllUsers();
    if (users.length === 0) return;

    const stored = await chrome.storage.local.get([
      "xsweep_follower_ids",
      "xsweep_follower_count",
      "xsweep_last_scan",
    ]);
    const followerIds = new Set<string>(
      (stored.xsweep_follower_ids || []).map(String),
    );
    setFollowerCount(stored.xsweep_follower_count || 0);
    setLastScan(stored.xsweep_last_scan || null);

    const auditCounts = computeAuditCounts(users, followerIds);
    setCounts(auditCounts);

    const accountHealth = computeAccountHealth(
      users,
      stored.xsweep_follower_count || 0,
      followerIds,
    );
    setHealth(accountHealth);

    const allLists = await getAllLists();
    const listsWithCounts: ListWithCount[] = [];
    for (const list of allLists) {
      if (list.id !== undefined) {
        const listUsers = await getUsersByListId(list.id);
        listsWithCounts.push({ ...list, userCount: listUsers.length });
      }
    }
    setLists(listsWithCounts);
  }

  async function startScan() {
    setScanning(true);
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "START_SCAN" });
    }
  }

  if (!counts) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <div className="text-4xl">🧹</div>
        <h2 className="text-lg font-semibold">Welcome to XSweep</h2>
        <p className="text-x-text-secondary text-center text-sm">
          Scan your X/Twitter following to get an audit of your account, find
          inactive follows, and organize with smart lists.
        </p>
        <p className="text-x-text-secondary text-center text-xs">
          Make sure you're on x.com before scanning.
        </p>
        <button
          onClick={startScan}
          disabled={scanning}
          className="px-6 py-2.5 bg-x-accent text-white rounded-full font-semibold hover:bg-x-accent-hover disabled:opacity-50 transition-colors"
        >
          {scanning ? "Scanning..." : "Scan My Following"}
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Health Score */}
      {health && (
        <div className="bg-x-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-x-text-secondary">
              Account Health
            </span>
            <span className="text-2xl font-bold">{health.score}/100</span>
          </div>
          <div className="w-full bg-x-border rounded-full h-2.5">
            <div
              className="h-2.5 rounded-full transition-all"
              style={{
                width: `${health.score}%`,
                backgroundColor:
                  health.score >= 70
                    ? "#00ba7c"
                    : health.score >= 40
                      ? "#ffd400"
                      : "#f4212e",
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-x-text-secondary">
            <div>Follow ratio: {health.followRatio}</div>
            <div>Inactive: {health.inactivePercent}%</div>
            <div>Mutual: {health.mutualPercent}%</div>
            <div>Engagement: {health.engagementPotential}%</div>
          </div>
        </div>
      )}

      {/* Counts */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Following" value={counts.total} />
        <StatCard label="Followers" value={followerCount} />
        <StatCard label="Mutual" value={counts.mutual} color="text-x-green" />
        <StatCard
          label="Don't follow back"
          value={counts.notFollowingBack}
          color="text-x-orange"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Inactive"
          value={counts.inactive}
          color="text-x-yellow"
        />
        <StatCard
          label="Suspended"
          value={counts.suspended}
          color="text-x-red"
        />
        <StatCard
          label="No tweets"
          value={counts.noTweets}
          color="text-x-text-secondary"
        />
      </div>

      {/* Smart Lists */}
      {lists.length > 0 && (
        <div className="bg-x-card rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-3">Smart Lists</h3>
          <div className="space-y-2">
            {lists.map((list) => (
              <div
                key={list.id}
                className="flex items-center justify-between py-1.5 border-b border-x-border last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs">
                    {list.type === "ai" ? "🤖" : "🏷️"}
                  </span>
                  <span className="text-sm">{list.name}</span>
                </div>
                <span className="text-xs text-x-text-secondary">
                  {list.userCount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={startScan}
          disabled={scanning}
          className="flex-1 px-4 py-2 bg-x-card text-x-text rounded-full text-sm font-medium hover:bg-x-border disabled:opacity-50 transition-colors"
        >
          {scanning ? "Scanning..." : "Re-scan"}
        </button>
      </div>

      {lastScan && (
        <p className="text-xs text-x-text-secondary text-center">
          Last scan: {new Date(lastScan).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "text-x-text",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="bg-x-card rounded-xl p-3">
      <div className={`text-xl font-bold ${color}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-x-text-secondary">{label}</div>
    </div>
  );
}
