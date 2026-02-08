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
import {
  getHealthGrade,
  getRecommendations,
} from "../../../core/health-recommendations";
import type {
  AuditCounts,
  AccountHealth,
  SmartList,
  ScanProgress,
} from "../../../core/types";
import type { Recommendation } from "../../../core/health-recommendations";
import type { NavigateFn, ShowToastFn } from "../App";

interface ListWithCount extends SmartList {
  userCount: number;
}

interface Props {
  navigateTo: NavigateFn;
  showToast: ShowToastFn;
}

export default function Dashboard({ navigateTo, showToast }: Props) {
  const [counts, setCounts] = useState<AuditCounts | null>(null);
  const [health, setHealth] = useState<AccountHealth | null>(null);
  const [lists, setLists] = useState<ListWithCount[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

  useEffect(() => {
    loadData();
    const listener = (message: {
      type: string;
      data?: ScanProgress;
      error?: string;
    }) => {
      if (message.type === "SCAN_COMPLETE") {
        setScanning(false);
        setScanProgress(null);
        loadData();
      }
      if (message.type === "SCAN_PROGRESS" && message.data) {
        setScanning(true);
        setScanProgress(message.data);
        setScanError(null);
      }
      if (message.type === "SCAN_ERROR") {
        setScanning(false);
        setScanProgress(null);
        setScanError(message.error || "Scan failed");
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

    const recs = getRecommendations(accountHealth, auditCounts);
    setRecommendations(recs);

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
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url?.includes("x.com")) {
      setScanError("Navigate to x.com first, then start the scan.");
      return;
    }
    setScanError(null);
    setScanning(true);
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "START_SCAN" });
    }
  }

  function handleRecommendationClick(rec: Recommendation) {
    if (rec.target === "unfollow") {
      navigateTo("unfollow");
    } else if (rec.target === "audit" && rec.targetFilter) {
      navigateTo("audit", { auditFilter: rec.targetFilter });
    } else if (rec.target === "lists") {
      navigateTo("lists");
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

        {scanning && scanProgress ? (
          <ScanProgressBar progress={scanProgress} />
        ) : (
          <button
            onClick={startScan}
            disabled={scanning}
            className="px-6 py-2.5 bg-x-accent text-white rounded-full font-semibold hover:bg-x-accent-hover disabled:opacity-50 transition-colors"
          >
            Scan My Following
          </button>
        )}

        {scanError && (
          <p className="text-x-red text-sm text-center">{scanError}</p>
        )}
      </div>
    );
  }

  const grade = health ? getHealthGrade(health.score) : null;

  return (
    <div className="p-4 space-y-4">
      {/* Health Score Card */}
      {health && grade && (
        <div className="bg-x-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className={`text-3xl font-black ${grade.color}`}>
                {grade.letter}
              </span>
              <div>
                <div className="text-sm font-medium">Account Health</div>
                <div className="text-xs text-x-text-secondary">
                  {grade.label}
                </div>
              </div>
            </div>
            <span className="text-2xl font-bold">{health.score}</span>
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
            <div>Follow ratio: {health.followRatio}x</div>
            <div>Inactive: {health.inactivePercent}%</div>
            <div>Mutual: {health.mutualPercent}%</div>
            <div>Engagement: {health.engagementPotential}%</div>
          </div>

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className="mt-4 pt-3 border-t border-x-border">
              <div className="text-xs font-medium text-x-text-secondary mb-2">
                How to improve
              </div>
              <div className="space-y-2">
                {recommendations.map((rec) => (
                  <button
                    key={rec.id}
                    onClick={() => handleRecommendationClick(rec)}
                    className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-x-border/50 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium">{rec.title}</div>
                      <div className="text-[10px] text-x-text-secondary">
                        {rec.description}
                      </div>
                    </div>
                    <span className="text-xs text-x-green font-medium ml-2 flex-shrink-0">
                      +{rec.estimatedGain} pts →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Following"
          value={counts.total}
          onClick={() => navigateTo("audit", { auditFilter: "all" })}
        />
        <StatCard label="Followers" value={followerCount} />
        <StatCard
          label="Mutual"
          value={counts.mutual}
          color="text-x-green"
          onClick={() => navigateTo("audit", { auditFilter: "mutual" })}
        />
        <StatCard
          label="Don't follow back"
          value={counts.notFollowingBack}
          color="text-x-orange"
          onClick={() => navigateTo("audit", { auditFilter: "non_mutual" })}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Inactive"
          value={counts.inactive}
          color="text-x-yellow"
          onClick={() => navigateTo("audit", { auditFilter: "inactive" })}
        />
        <StatCard
          label="Suspended"
          value={counts.suspended}
          color="text-x-red"
          onClick={() => navigateTo("audit", { auditFilter: "suspended" })}
        />
        <StatCard
          label="No tweets"
          value={counts.noTweets}
          color="text-x-text-secondary"
          onClick={() => navigateTo("audit", { auditFilter: "no_tweets" })}
        />
      </div>

      {/* Quick Actions */}
      {(counts.inactive > 0 || counts.suspended > 0 || lists.length === 0) && (
        <div className="flex flex-wrap gap-2">
          {(counts.inactive > 0 || counts.suspended > 0) && (
            <button
              onClick={() => navigateTo("unfollow")}
              className="px-3 py-1.5 bg-x-red/10 text-x-red rounded-full text-xs font-medium hover:bg-x-red/20 transition-colors"
            >
              Clean {counts.inactive + counts.suspended} inactive →
            </button>
          )}
          {lists.length === 0 && counts.total > 0 && (
            <button
              onClick={() => navigateTo("lists")}
              className="px-3 py-1.5 bg-x-accent/10 text-x-accent rounded-full text-xs font-medium hover:bg-x-accent/20 transition-colors"
            >
              Create smart lists →
            </button>
          )}
          {counts.notFollowingBack > 0 && (
            <button
              onClick={() => navigateTo("audit", { auditFilter: "non_mutual" })}
              className="px-3 py-1.5 bg-x-orange/10 text-x-orange rounded-full text-xs font-medium hover:bg-x-orange/20 transition-colors"
            >
              Review {counts.notFollowingBack} non-mutuals →
            </button>
          )}
        </div>
      )}

      {/* Smart Lists */}
      {lists.length > 0 && (
        <div className="bg-x-card rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-3">Smart Lists</h3>
          <div className="space-y-2">
            {lists.map((list) => (
              <button
                key={list.id}
                onClick={() => navigateTo("lists")}
                className="w-full flex items-center justify-between py-1.5 border-b border-x-border last:border-b-0 hover:bg-x-border/30 rounded px-1 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs">
                    {list.type === "ai" ? "🤖" : "🏷️"}
                  </span>
                  <span className="text-sm">{list.name}</span>
                </div>
                <span className="text-xs text-x-text-secondary">
                  {list.userCount} →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scan Progress or Actions */}
      {scanning && scanProgress ? (
        <ScanProgressBar progress={scanProgress} />
      ) : (
        <div className="flex gap-3">
          <button
            onClick={startScan}
            disabled={scanning}
            className="flex-1 px-4 py-2 bg-x-card text-x-text rounded-full text-sm font-medium hover:bg-x-border disabled:opacity-50 transition-colors"
          >
            Re-scan
          </button>
        </div>
      )}

      {scanError && (
        <p className="text-x-red text-sm text-center">{scanError}</p>
      )}

      {lastScan && !scanning && (
        <p className="text-xs text-x-text-secondary text-center">
          Last scan: {new Date(lastScan).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

function ScanProgressBar({ progress }: { progress: ScanProgress }) {
  const phaseLabels: Record<string, string> = {
    "collecting-ids": "Collecting account IDs",
    "scanning-users": "Scanning user profiles",
    "computing-relationships": "Computing relationships",
    complete: "Complete",
    error: "Error",
  };

  const phaseLabel = phaseLabels[progress.phase] || progress.phase;

  let percent = 0;
  if (progress.phase === "collecting-ids") {
    percent = Math.min(20, progress.currentPage * 5);
  } else if (progress.phase === "scanning-users") {
    const userPercent =
      progress.totalIds > 0
        ? (progress.scannedUsers / progress.totalIds) * 100
        : 0;
    percent = 20 + userPercent * 0.7;
  } else if (progress.phase === "computing-relationships") {
    percent = 95;
  } else if (progress.phase === "complete") {
    percent = 100;
  }

  percent = Math.min(100, Math.round(percent));

  return (
    <div className="w-full bg-x-card rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{phaseLabel}</span>
        <span className="text-sm text-x-text-secondary">{percent}%</span>
      </div>
      <div className="w-full bg-x-border rounded-full h-2">
        <div
          className="h-2 rounded-full bg-x-accent transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      {progress.phase === "scanning-users" && progress.totalIds > 0 && (
        <div className="text-xs text-x-text-secondary text-center">
          {progress.scannedUsers.toLocaleString()} /{" "}
          {progress.totalIds.toLocaleString()} profiles scanned
        </div>
      )}
      {progress.phase === "collecting-ids" && progress.totalIds > 0 && (
        <div className="text-xs text-x-text-secondary text-center">
          {progress.totalIds.toLocaleString()} IDs collected
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "text-x-text",
  onClick,
}: {
  label: string;
  value: number;
  color?: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="bg-x-card rounded-xl p-3 text-left hover:bg-x-border transition-colors group"
      >
        <div className="flex items-center justify-between">
          <div className={`text-xl font-bold ${color}`}>
            {value.toLocaleString()}
          </div>
          <span className="text-xs text-x-text-secondary opacity-0 group-hover:opacity-100 transition-opacity">
            →
          </span>
        </div>
        <div className="text-xs text-x-text-secondary">{label}</div>
      </button>
    );
  }

  return (
    <div className="bg-x-card rounded-xl p-3">
      <div className={`text-xl font-bold ${color}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-x-text-secondary">{label}</div>
    </div>
  );
}
