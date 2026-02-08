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
import {
  loadMonetizationData,
  saveMonetizationData,
  getRequirements,
  getCoachingTips,
  estimatePayout,
} from "../../../core/monetization";
import type { MonetizationData } from "../../../core/monetization";
import { formatCount } from "../../../utils/format";
import { computeQuickStats, type QuickStats } from "../../../core/reviewer";
import type {
  AuditCounts,
  AccountHealth,
  SmartList,
  ScanProgress,
  UserProfile,
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
  const [monetization, setMonetization] = useState<MonetizationData | null>(
    null,
  );
  const [monetizationScanning, setMonetizationScanning] = useState(false);
  const [monetizationProgress, setMonetizationProgress] = useState<{
    phase: "followers" | "tweets";
    done: number;
    total: number;
  } | null>(null);
  const [monetizationError, setMonetizationError] = useState<string | null>(
    null,
  );
  const [quickStats, setQuickStats] = useState<QuickStats | null>(null);

  useEffect(() => {
    loadData();
    loadMonetizationData().then(setMonetization);
    const listener = (message: {
      type: string;
      data?: ScanProgress & Record<string, unknown>;
      error?: string;
    }) => {
      if (message.type === "SCAN_COMPLETE") {
        setScanning(false);
        setScanProgress(null);
        loadData();
      }
      if (message.type === "SCAN_PROGRESS" && message.data) {
        setScanning(true);
        setScanProgress(message.data as ScanProgress);
        setScanError(null);
      }
      if (message.type === "SCAN_ERROR") {
        setScanning(false);
        setScanProgress(null);
        setScanError(message.error || "Scan failed");
      }
      if (message.type === "MONETIZATION_PROGRESS" && message.data) {
        setMonetizationProgress(
          message.data as {
            phase: "followers" | "tweets";
            done: number;
            total: number;
          },
        );
      }
      if (message.type === "MONETIZATION_COMPLETE" && message.data) {
        const d = message.data as Record<string, unknown>;
        const impressions = (d.organicImpressions as number) || 0;
        const totalReplies = (d.totalReplies as number) || 0;
        const totalRetweets = (d.totalRetweets as number) || 0;
        const totalLikes = (d.totalLikes as number) || 0;
        const tweetsLast90 = (d.tweetsLast90Days as number) || 0;
        const totalFollowers = (d.totalFollowers as number) || 0;
        const verifiedFollowers = (d.verifiedFollowers as number) || 0;
        const mediaTweetCount = (d.mediaTweetCount as number) || 0;
        const threadCount = (d.threadCount as number) || 0;
        const threadImpressions = (d.threadImpressions as number) || 0;
        const singleImpressions = (d.singleImpressions as number) || 0;

        // Compute derived metrics
        const totalEngagement = totalReplies + totalRetweets + totalLikes;
        const engagementRate =
          impressions > 0 ? totalEngagement / impressions : 0;
        const avgRepliesPerTweet =
          tweetsLast90 > 0 ? totalReplies / tweetsLast90 : 0;
        const replyRate = impressions > 0 ? totalReplies / impressions : 0;
        const mediaTweetPercent =
          tweetsLast90 > 0 ? (mediaTweetCount / tweetsLast90) * 100 : 0;
        const verifiedFollowerPercent =
          totalFollowers > 0 ? (verifiedFollowers / totalFollowers) * 100 : 0;

        // Compute thread engagement comparison
        const nonThreadCount = tweetsLast90 - threadCount;
        const avgThreadEng =
          threadCount > 0 ? threadImpressions / threadCount : 0;
        const avgSingleEng =
          nonThreadCount > 0 ? singleImpressions / nonThreadCount : 0;
        const avgThreadEngagement =
          avgSingleEng > 0 ? avgThreadEng / avgSingleEng : 0;

        // Compute peak hours/days from engagement maps
        const hourlyEntries =
          (d.hourlyEngagement as Array<
            [number, { total: number; count: number }]
          >) || [];
        const dailyEntries =
          (d.dailyEngagement as Array<
            [number, { total: number; count: number }]
          >) || [];

        const peakHours = hourlyEntries
          .map(([hour, { total, count }]) => ({
            hour,
            avg: count > 0 ? total / count : 0,
          }))
          .sort((a, b) => b.avg - a.avg)
          .slice(0, 3)
          .map((e) => e.hour);

        const peakDays = dailyEntries
          .map(([day, { total, count }]) => ({
            day,
            avg: count > 0 ? total / count : 0,
          }))
          .sort((a, b) => b.avg - a.avg)
          .slice(0, 3)
          .map((e) => e.day);

        const partial: MonetizationData = {
          userId: (d.userId as string) || "",
          verifiedFollowers,
          totalFollowers,
          organicImpressions: impressions,
          impressionsAvailable: (d.impressionsAvailable as boolean) || false,
          tweetsLast30Days: (d.tweetsLast30Days as number) || 0,
          tweetsLast90Days: tweetsLast90,
          avgViewsPerTweet: (d.avgViewsPerTweet as number) || 0,
          topTweetViews: (d.topTweetViews as number) || 0,
          manualImpressions: monetization?.manualImpressions ?? 0,
          identityVerified: monetization?.identityVerified ?? false,
          lastChecked: new Date().toISOString(),
          // Engagement
          totalReplies,
          totalRetweets,
          totalLikes,
          engagementRate,
          avgRepliesPerTweet,
          replyRate,
          // Content
          mediaTweetPercent,
          threadCount,
          avgThreadEngagement,
          // Peak times
          peakHours,
          peakDays,
          // Verified intelligence
          verifiedFollowerPercent,
          topVerifiedFollowers:
            (d.topVerifiedFollowers as MonetizationData["topVerifiedFollowers"]) ||
            [],
          // Geo
          topLocations:
            (d.topLocations as MonetizationData["topLocations"]) || [],
          // Payout — computed after object created
          estimatedMonthlyPayout: 0,
          projectedAnnualPayout: 0,
        };
        const payout = estimatePayout(partial);
        partial.estimatedMonthlyPayout = payout.monthly;
        partial.projectedAnnualPayout = payout.annual;

        saveMonetizationData(partial);
        setMonetization(partial);
        setMonetizationScanning(false);
        setMonetizationProgress(null);
      }
      if (message.type === "MONETIZATION_ERROR") {
        setMonetizationScanning(false);
        setMonetizationProgress(null);
        setMonetizationError(message.error || "Monetization scan failed");
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
    setQuickStats(computeQuickStats(users));

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

  async function startMonetizationScan() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url?.includes("x.com")) {
      setMonetizationError("Navigate to x.com first.");
      return;
    }
    setMonetizationError(null);
    setMonetizationScanning(true);
    setMonetizationProgress(null);
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "SCAN_MONETIZATION" });
    }
  }

  async function toggleIdentityVerified() {
    if (!monetization) return;
    const updated = {
      ...monetization,
      identityVerified: !monetization.identityVerified,
    };
    await saveMonetizationData(updated);
    setMonetization(updated);
  }

  async function updateManualImpressions(value: string) {
    if (!monetization) return;
    const num = parseInt(value.replace(/[^0-9]/g, ""), 10) || 0;
    const updated = { ...monetization, manualImpressions: num };
    await saveMonetizationData(updated);
    setMonetization(updated);
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

      {/* Monetization Card */}
      <MonetizationCard
        data={monetization}
        scanning={monetizationScanning}
        progress={monetizationProgress}
        error={monetizationError}
        onCheckProgress={startMonetizationScan}
        onToggleIdentity={toggleIdentityVerified}
        onUpdateImpressions={updateManualImpressions}
      />

      {/* Relationship Stats */}
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
          label="Followers only"
          value={counts.followersOnly}
          color="text-x-accent"
          onClick={() =>
            navigateTo("audit", {
              auditFilter: "followers_only",
              sortBy: "followerCount",
              sortDesc: true,
            })
          }
        />
        <StatCard
          label="Don't follow back"
          value={counts.notFollowingBack}
          color="text-x-orange"
          onClick={() => navigateTo("audit", { auditFilter: "non_mutual" })}
        />
        <RatioCard followers={followerCount} following={counts.total} />
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

      {/* Ratio Optimizer */}
      {health && (
        <RatioOptimizer
          counts={counts}
          followerCount={followerCount}
          navigateTo={navigateTo}
        />
      )}

      {/* Follow-Back Opportunities */}
      {counts.followersOnly > 0 && (
        <FollowBackOpportunities navigateTo={navigateTo} />
      )}

      {/* Quick Stats — Clickable tier & activity badges */}
      {quickStats && (
        <div className="bg-x-card rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold">Quick Stats</h3>

          <div>
            <div className="text-[10px] text-x-text-secondary mb-1">
              By Follower Tier
            </div>
            <div className="flex flex-wrap gap-1.5">
              <ClickableBadge
                label="Mega (100K+)"
                count={quickStats.tiers.mega}
                color="text-x-accent"
                onClick={() =>
                  navigateTo("audit", {
                    followerMin: 100000,
                    sortBy: "followerCount",
                    sortDesc: true,
                  })
                }
              />
              <ClickableBadge
                label="Large (10K+)"
                count={quickStats.tiers.large}
                color="text-x-accent"
                onClick={() =>
                  navigateTo("audit", {
                    followerMin: 10000,
                    followerMax: 99999,
                    sortBy: "followerCount",
                    sortDesc: true,
                  })
                }
              />
              <ClickableBadge
                label="Mid (1K+)"
                count={quickStats.tiers.mid}
                color="text-x-text"
                onClick={() =>
                  navigateTo("audit", {
                    followerMin: 1000,
                    followerMax: 9999,
                    sortBy: "followerCount",
                    sortDesc: true,
                  })
                }
              />
              <ClickableBadge
                label="Small (100+)"
                count={quickStats.tiers.small}
                color="text-x-text-secondary"
                onClick={() =>
                  navigateTo("audit", {
                    followerMin: 100,
                    followerMax: 999,
                    sortBy: "followerCount",
                    sortDesc: true,
                  })
                }
              />
              <ClickableBadge
                label="Micro (<100)"
                count={quickStats.tiers.micro}
                color="text-x-text-secondary"
                onClick={() =>
                  navigateTo("audit", {
                    followerMax: 99,
                    sortBy: "followerCount",
                    sortDesc: true,
                  })
                }
              />
            </div>
          </div>

          <div>
            <div className="text-[10px] text-x-text-secondary mb-1">
              By Activity
            </div>
            <div className="flex flex-wrap gap-1.5">
              <ClickableBadge
                label="Active"
                count={quickStats.activity.active}
                color="text-x-green"
                onClick={() => navigateTo("audit", { auditFilter: "active" })}
              />
              <ClickableBadge
                label="Inactive (1y+)"
                count={quickStats.activity.inactive}
                color="text-x-yellow"
                onClick={() => navigateTo("audit", { auditFilter: "inactive" })}
              />
              <ClickableBadge
                label="Ghost"
                count={quickStats.activity.ghost}
                color="text-x-orange"
                onClick={() =>
                  navigateTo("audit", { auditFilter: "no_tweets" })
                }
              />
              <ClickableBadge
                label="Suspended"
                count={quickStats.activity.suspended}
                color="text-x-red"
                onClick={() =>
                  navigateTo("audit", { auditFilter: "suspended" })
                }
              />
            </div>
          </div>
        </div>
      )}

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

function MonetizationCard({
  data,
  scanning,
  progress,
  error,
  onCheckProgress,
  onToggleIdentity,
  onUpdateImpressions,
}: {
  data: MonetizationData | null;
  scanning: boolean;
  progress: {
    phase: "followers" | "tweets";
    done: number;
    total: number;
  } | null;
  error: string | null;
  onCheckProgress: () => void;
  onToggleIdentity: () => void;
  onUpdateImpressions: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(!data);
  const [showAudience, setShowAudience] = useState(false);
  const [showGeo, setShowGeo] = useState(false);

  const isExpanded = expanded || scanning;

  if (!data && !scanning) {
    return (
      <div className="bg-x-card rounded-xl p-4">
        <button
          onClick={onCheckProgress}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">&#x1F4B0;</span>
            <span className="text-sm font-semibold">Creator Monetization</span>
          </div>
          <span className="text-xs text-x-accent font-medium">
            Check Progress
          </span>
        </button>
        {error && <p className="text-x-red text-xs mt-2">{error}</p>}
      </div>
    );
  }

  const requirements = data ? getRequirements(data) : [];
  const tips = data ? getCoachingTips(data) : [];
  const metCount = requirements.filter((r) => r.met).length;
  const timeAgo = data?.lastChecked ? getRelativeTime(data.lastChecked) : null;
  const payout = data ? estimatePayout(data) : { monthly: 0, annual: 0 };

  const payoutColor =
    payout.monthly >= 100
      ? "text-x-green"
      : payout.monthly >= 10
        ? "text-x-yellow"
        : "text-x-red";

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-3">
      {/* Header card with payout estimator */}
      <div className="bg-x-card rounded-xl p-4">
        <button
          onClick={() => setExpanded(!isExpanded)}
          className="w-full flex items-center justify-between mb-1"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">&#x1F4B0;</span>
            <span className="text-sm font-semibold">
              Monetization Intelligence
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-x-text-secondary">
              {metCount}/{requirements.length}
            </span>
            <span className="text-xs text-x-text-secondary">
              {isExpanded ? "\u25B2" : "\u25BC"}
            </span>
          </div>
        </button>

        {timeAgo && (
          <div className="text-[10px] text-x-text-secondary mb-3">
            Last checked: {timeAgo}
            {data?.userId && (
              <span className="ml-1 text-x-accent">
                (Profile: {data.userId.slice(-6)})
              </span>
            )}
          </div>
        )}

        {/* Scanning progress */}
        {scanning && progress && (
          <div className="space-y-2">
            <div className="text-xs font-medium">
              {progress.phase === "followers"
                ? "Scanning followers..."
                : "Scanning tweets..."}
            </div>
            <div className="w-full bg-x-border rounded-full h-1.5">
              <div
                className="h-1.5 rounded-full bg-x-accent transition-all duration-300"
                style={{
                  width: `${progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 10}%`,
                }}
              />
            </div>
            <div className="text-[10px] text-x-text-secondary">
              {progress.done.toLocaleString()} processed
            </div>
          </div>
        )}

        {/* Payout Estimator — always visible when expanded and data present */}
        {isExpanded && data && !scanning && (
          <>
            <div className="bg-x-bg rounded-lg p-3 mb-3">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-xs text-x-text-secondary">
                  Est. Monthly
                </span>
                <span className={`text-xl font-bold ${payoutColor}`}>
                  ${payout.monthly.toFixed(2)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-x-text-secondary">
                  Projected Annual
                </span>
                <span className="text-sm font-semibold text-x-text">
                  ${payout.annual.toFixed(2)}
                </span>
              </div>
              <div className="text-[10px] text-x-text-secondary mt-1">
                Based on{" "}
                {formatCount(
                  Math.max(data.organicImpressions, data.manualImpressions),
                )}{" "}
                impressions, {(data.engagementRate * 100).toFixed(2)}%
                engagement
              </div>
            </div>
          </>
        )}

        {error && <p className="text-x-red text-xs">{error}</p>}
      </div>

      {isExpanded && data && !scanning && (
        <>
          {/* Engagement Quality Card */}
          <div className="bg-x-card rounded-xl p-4">
            <h3 className="text-xs font-semibold mb-3">Engagement Quality</h3>
            <div className="space-y-2.5">
              <MetricBar
                label="Reply Rate"
                value={data.replyRate * 100}
                target={1}
                suffix="%"
                decimals={2}
              />
              <MetricBar
                label="Engagement"
                value={data.engagementRate * 100}
                target={2}
                suffix="%"
                decimals={2}
              />
              <MetricBar
                label="Media Usage"
                value={data.mediaTweetPercent}
                target={50}
                suffix="%"
                decimals={0}
              />
              <MetricBar
                label="Threads (90d)"
                value={data.threadCount}
                target={12}
                suffix=""
                decimals={0}
              />
            </div>
            {data.avgThreadEngagement > 0 && (
              <div className="text-[10px] text-x-text-secondary mt-2">
                Threads get {data.avgThreadEngagement.toFixed(1)}x engagement vs
                singles
              </div>
            )}
          </div>

          {/* Best Time to Post */}
          {data.peakHours.length > 0 && (
            <div className="bg-x-card rounded-xl p-4">
              <h3 className="text-xs font-semibold mb-2">Best Time to Post</h3>
              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="text-x-text-secondary">Peak hours: </span>
                  <span className="font-medium">
                    {data.peakHours
                      .slice(0, 3)
                      .map((h) => `${h}:00`)
                      .join(", ")}{" "}
                    UTC
                  </span>
                </div>
              </div>
              {data.peakDays.length > 0 && (
                <div className="flex items-center justify-between text-xs mt-1">
                  <div>
                    <span className="text-x-text-secondary">Best days: </span>
                    <span className="font-medium">
                      {data.peakDays
                        .slice(0, 3)
                        .map((d) => dayNames[d])
                        .join(", ")}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Premium Audience — collapsible */}
          <div className="bg-x-card rounded-xl p-4">
            <button
              onClick={() => setShowAudience(!showAudience)}
              className="w-full flex items-center justify-between"
            >
              <h3 className="text-xs font-semibold">Your Premium Audience</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-x-text-secondary">
                  {data.verifiedFollowerPercent.toFixed(1)}% verified
                </span>
                <span className="text-xs text-x-text-secondary">
                  {showAudience ? "\u25B2" : "\u25BC"}
                </span>
              </div>
            </button>

            {/* Verified % bar always visible */}
            <div className="mt-2">
              <div className="w-full bg-x-border rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full bg-x-accent transition-all"
                  style={{
                    width: `${Math.min(100, data.verifiedFollowerPercent)}%`,
                  }}
                />
              </div>
              <div className="text-[10px] text-x-text-secondary mt-1">
                {data.verifiedFollowers.toLocaleString()} verified /{" "}
                {data.totalFollowers.toLocaleString()} total — target: 2,000
              </div>
            </div>

            {showAudience && data.topVerifiedFollowers.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="text-[10px] text-x-text-secondary">
                  Top verified followers (their engagement drives your revenue)
                </div>
                {data.topVerifiedFollowers.slice(0, 5).map((f) => (
                  <div
                    key={f.userId}
                    className="flex items-center gap-2 py-0.5"
                  >
                    {f.profileImageUrl ? (
                      <img
                        src={f.profileImageUrl}
                        alt=""
                        className="w-5 h-5 rounded-full flex-shrink-0"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-x-border flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium truncate">
                        {f.displayName}
                      </div>
                      <div className="text-[10px] text-x-text-secondary truncate">
                        @{f.username} · {formatCount(f.followerCount)} followers
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Geographic Distribution — collapsible */}
          {data.topLocations.length > 0 && (
            <div className="bg-x-card rounded-xl p-4">
              <button
                onClick={() => setShowGeo(!showGeo)}
                className="w-full flex items-center justify-between"
              >
                <h3 className="text-xs font-semibold">Follower Geography</h3>
                <span className="text-xs text-x-text-secondary">
                  {showGeo ? "\u25B2" : "\u25BC"}
                </span>
              </button>

              {showGeo && (
                <div className="mt-3 space-y-1.5">
                  {data.topLocations.slice(0, 5).map((loc) => {
                    const maxCount = data.topLocations[0].count;
                    const pct =
                      maxCount > 0
                        ? Math.round((loc.count / maxCount) * 100)
                        : 0;
                    const isHighCPM = [
                      "us",
                      "usa",
                      "united states",
                      "uk",
                      "united kingdom",
                      "canada",
                      "australia",
                    ].some((kw) => loc.location.includes(kw));
                    return (
                      <div key={loc.location}>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="capitalize truncate max-w-[60%]">
                            {loc.location}
                            {isHighCPM && (
                              <span className="text-x-green ml-1">$</span>
                            )}
                          </span>
                          <span className="text-x-text-secondary">
                            {loc.count}
                          </span>
                        </div>
                        <div className="w-full bg-x-border rounded-full h-1 mt-0.5">
                          <div
                            className="h-1 rounded-full bg-x-accent transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Requirements — existing threshold progress */}
          <div className="bg-x-card rounded-xl p-4">
            <h3 className="text-xs font-semibold mb-3">
              Eligibility Requirements
            </h3>
            <div className="space-y-3">
              {requirements.map((req) => (
                <RequirementRow
                  key={req.id}
                  req={req}
                  isIdentityToggle={req.id === "identity_verified"}
                  onToggle={onToggleIdentity}
                />
              ))}
            </div>

            {data && !data.impressionsAvailable && (
              <div className="pt-2 border-t border-x-border mt-3">
                <label className="text-[10px] text-x-text-secondary block mb-1">
                  Manual impression count (from{" "}
                  <a
                    href="https://analytics.x.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-x-accent underline"
                  >
                    analytics.x.com
                  </a>
                  )
                </label>
                <input
                  type="text"
                  defaultValue={
                    data.manualImpressions > 0
                      ? data.manualImpressions.toLocaleString()
                      : ""
                  }
                  onBlur={(e) => onUpdateImpressions(e.target.value)}
                  placeholder="e.g. 2500000"
                  className="w-full px-2 py-1 text-xs bg-x-bg border border-x-border rounded-lg focus:border-x-accent focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Smart Coaching — data-driven tips */}
          {tips.length > 0 && (
            <div className="bg-x-card rounded-xl p-4">
              <h3 className="text-xs font-semibold mb-2">Smart Coaching</h3>
              <div className="space-y-2">
                {tips.slice(0, 5).map((tip) => (
                  <div
                    key={tip.id}
                    className="flex items-start gap-2 text-[11px]"
                  >
                    <span
                      className={`flex-shrink-0 mt-0.5 ${
                        tip.priority === "high"
                          ? "text-x-red"
                          : tip.priority === "medium"
                            ? "text-x-yellow"
                            : "text-x-green"
                      }`}
                    >
                      {tip.priority === "high"
                        ? "!"
                        : tip.priority === "medium"
                          ? "\u25CF"
                          : "\u2713"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{tip.title}</div>
                      {tip.estimatedImpact && (
                        <div className="text-x-green text-[10px]">
                          {tip.estimatedImpact}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Refresh button */}
          <button
            onClick={onCheckProgress}
            className="w-full px-3 py-1.5 bg-x-accent/10 text-x-accent rounded-full text-xs font-medium hover:bg-x-accent/20 transition-colors"
          >
            Refresh Progress
          </button>
        </>
      )}
    </div>
  );
}

/** Metric bar for engagement quality section */
function MetricBar({
  label,
  value,
  target,
  suffix,
  decimals,
}: {
  label: string;
  value: number;
  target: number;
  suffix: string;
  decimals: number;
}) {
  const percent = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const met = value >= target;
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[11px] text-x-text-secondary">{label}</span>
        <span className="text-[11px]">
          <span className={met ? "text-x-green font-medium" : ""}>
            {value.toFixed(decimals)}
            {suffix}
          </span>
          <span className="text-x-text-secondary">
            {" "}
            / {target}
            {suffix}
          </span>
        </span>
      </div>
      <div className="w-full bg-x-border rounded-full h-1.5">
        <div
          className="h-1.5 rounded-full transition-all"
          style={{
            width: `${Math.round(percent)}%`,
            backgroundColor: met
              ? "#00ba7c"
              : percent >= 50
                ? "#ffd400"
                : "#f4212e",
          }}
        />
      </div>
    </div>
  );
}

function RequirementRow({
  req,
  isIdentityToggle,
  onToggle,
}: {
  req: ReturnType<typeof getRequirements>[number];
  isIdentityToggle?: boolean;
  onToggle?: () => void;
}) {
  const percent =
    req.target > 0
      ? Math.min(100, Math.round((req.current / req.target) * 100))
      : 0;

  // For boolean requirements (active, identity, age)
  if (req.manual || req.id === "active_30d") {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={
              req.met ? "text-x-green text-xs" : "text-x-text-secondary text-xs"
            }
          >
            {req.met ? "\u2705" : "\u2B1C"}
          </span>
          <span className="text-xs">{req.label}</span>
        </div>
        {isIdentityToggle ? (
          <button
            onClick={onToggle}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              req.met
                ? "border-x-green text-x-green"
                : "border-x-border text-x-text-secondary hover:border-x-accent"
            }`}
          >
            {req.met ? "Verified" : "Set verified"}
          </button>
        ) : (
          <span className="text-xs text-x-green">
            {req.met ? "\u2713" : ""}
          </span>
        )}
      </div>
    );
  }

  // Progress bar requirements (followers, impressions)
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span
            className={
              req.met ? "text-x-green text-xs" : "text-x-text-secondary text-xs"
            }
          >
            {req.met ? "\u2705" : "\u2B1C"}
          </span>
          <span className="text-xs">{req.label}</span>
        </div>
        <span className="text-xs text-x-text-secondary">
          {formatCount(req.current)}/{formatCount(req.target)}
        </span>
      </div>
      <div
        className="w-full bg-x-border rounded-full h-1.5 ml-5"
        style={{ width: "calc(100% - 20px)" }}
      >
        <div
          className="h-1.5 rounded-full transition-all"
          style={{
            width: `${percent}%`,
            backgroundColor: req.met
              ? "#00ba7c"
              : percent >= 50
                ? "#ffd400"
                : "#f4212e",
          }}
        />
      </div>
      <div className="text-[10px] text-x-text-secondary text-right">
        {percent}%
      </div>
    </div>
  );
}

function getRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

function ClickableBadge({
  label,
  count,
  color,
  onClick,
}: {
  label: string;
  count: number;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 bg-x-bg px-2 py-1 rounded text-[11px] hover:bg-x-border transition-colors"
    >
      <span className={`font-semibold ${color}`}>{formatCount(count)}</span>
      <span className="text-x-text-secondary">{label}</span>
    </button>
  );
}

function RatioCard({
  followers,
  following,
}: {
  followers: number;
  following: number;
}) {
  const ratio = following > 0 ? followers / following : 0;
  const ratioStr = ratio.toFixed(2);
  const color =
    ratio >= 1.0
      ? "text-x-green"
      : ratio >= 0.5
        ? "text-x-yellow"
        : "text-x-red";

  return (
    <div className="bg-x-card rounded-xl p-3">
      <div className={`text-xl font-bold ${color}`}>{ratioStr}</div>
      <div className="text-xs text-x-text-secondary">Follow Ratio</div>
    </div>
  );
}

function RatioOptimizer({
  counts,
  followerCount,
  navigateTo,
}: {
  counts: AuditCounts;
  followerCount: number;
  navigateTo: NavigateFn;
}) {
  const deadWeight = counts.inactive + counts.suspended;
  const currentRatio =
    counts.total > 0 ? (followerCount / counts.total).toFixed(2) : "0.00";
  const cleanedFollowing = counts.total - deadWeight;
  const cleanedRatio =
    cleanedFollowing > 0
      ? (followerCount / cleanedFollowing).toFixed(2)
      : "0.00";

  const ratioColor = (r: string) => {
    const n = parseFloat(r);
    if (n >= 1.0) return "text-x-green";
    if (n >= 0.5) return "text-x-yellow";
    return "text-x-red";
  };

  return (
    <div className="bg-x-card rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold">Ratio Optimizer</h3>

      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-x-text-secondary">Current ratio</span>
          <span className={`font-bold ${ratioColor(currentRatio)}`}>
            {currentRatio}:1
          </span>
        </div>

        {deadWeight > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-x-text-secondary">
              After removing {deadWeight} dead accounts
            </span>
            <span className={`font-bold ${ratioColor(cleanedRatio)}`}>
              {cleanedRatio}:1
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {deadWeight > 0 && (
          <button
            onClick={() => navigateTo("unfollow")}
            className="px-3 py-1.5 bg-x-red/10 text-x-red rounded-full text-xs font-medium hover:bg-x-red/20 transition-colors"
          >
            Clean dead weight →
          </button>
        )}
        {counts.followersOnly > 0 && (
          <button
            onClick={() =>
              navigateTo("audit", {
                auditFilter: "followers_only",
                sortBy: "followerCount",
                sortDesc: true,
              })
            }
            className="px-3 py-1.5 bg-x-accent/10 text-x-accent rounded-full text-xs font-medium hover:bg-x-accent/20 transition-colors"
          >
            Follow-back opportunities →
          </button>
        )}
      </div>
    </div>
  );
}

function FollowBackOpportunities({ navigateTo }: { navigateTo: NavigateFn }) {
  const [topFollowers, setTopFollowers] = useState<UserProfile[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadTopFollowers();
  }, []);

  async function loadTopFollowers() {
    const users = await getAllUsers();
    const followerOnly = users
      .filter((u) => u.isFollowing === false)
      .sort((a, b) => b.followerCount - a.followerCount);
    setTotalCount(followerOnly.length);
    setTopFollowers(followerOnly.slice(0, 5));
  }

  if (topFollowers.length === 0) return null;

  return (
    <div className="bg-x-card rounded-xl p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <h3 className="text-sm font-semibold">Follow-Back Opportunities</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-x-text-secondary">
            {totalCount} users
          </span>
          <span className="text-xs text-x-text-secondary">
            {expanded ? "\u25B2" : "\u25BC"}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {topFollowers.map((user) => (
            <div key={user.userId} className="flex items-center gap-2 py-1">
              {user.profileImageUrl ? (
                <img
                  src={user.profileImageUrl}
                  alt=""
                  className="w-6 h-6 rounded-full flex-shrink-0"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-x-border flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">
                  {user.displayName}
                </div>
                <div className="text-[10px] text-x-text-secondary truncate">
                  @{user.username} · {formatCount(user.followerCount)} followers
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={() =>
              navigateTo("audit", {
                auditFilter: "followers_only",
                sortBy: "followerCount",
                sortDesc: true,
              })
            }
            className="w-full px-3 py-1.5 bg-x-accent/10 text-x-accent rounded-full text-xs font-medium hover:bg-x-accent/20 transition-colors mt-2"
          >
            View all {totalCount} →
          </button>
        </div>
      )}
    </div>
  );
}
