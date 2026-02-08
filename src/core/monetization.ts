/**
 * Monetization tracker: types, requirement calculations, coaching tips,
 * payout estimation, and chrome.storage persistence for X Creator Monetization progress.
 * Supports multiple profiles keyed by userId.
 */

export interface MonetizationData {
  userId: string; // which X profile this data belongs to
  verifiedFollowers: number;
  totalFollowers: number;
  organicImpressions: number; // API-detected
  manualImpressions: number; // User-entered fallback
  impressionsAvailable: boolean; // whether API returned ext_views
  tweetsLast30Days: number;
  tweetsLast90Days: number;
  avgViewsPerTweet: number;
  topTweetViews: number;
  lastChecked: string; // ISO timestamp
  identityVerified: boolean; // manual toggle

  // Engagement metrics (from tweet objects)
  totalReplies: number;
  totalRetweets: number;
  totalLikes: number;
  engagementRate: number; // (replies+retweets+likes) / impressions
  avgRepliesPerTweet: number;
  replyRate: number; // replies / impressions

  // Content analysis
  mediaTweetPercent: number; // % of tweets with images/video
  threadCount: number; // tweets that are self-replies (threads)
  avgThreadEngagement: number; // avg engagement on threads vs singles

  // Best posting times
  peakHours: number[]; // top 3 hours (UTC) by avg engagement
  peakDays: number[]; // top 3 days of week by avg engagement

  // Verified follower intelligence
  verifiedFollowerPercent: number;
  topVerifiedFollowers: Array<{
    userId: string;
    username: string;
    displayName: string;
    followerCount: number;
    profileImageUrl: string;
  }>;

  // Geographic distribution
  topLocations: Array<{ location: string; count: number }>;

  // Payout estimation
  estimatedMonthlyPayout: number;
  projectedAnnualPayout: number;
}

export interface MonetizationRequirement {
  id: string;
  label: string;
  current: number;
  target: number;
  met: boolean;
  manual?: boolean; // true for identity/age
}

export interface CoachingTip {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  metric: string; // which requirement this helps
  estimatedImpact?: string; // estimated $ impact
}

const STORAGE_KEY_PREFIX = "xsweep_monetization_";
const LEGACY_STORAGE_KEY = "xsweep_monetization";

const TARGETS = {
  verifiedFollowers: 2000,
  organicImpressions: 5_000_000,
  active30d: 1, // at least 1 tweet in 30 days
} as const;

export function getRequirements(
  data: MonetizationData,
): MonetizationRequirement[] {
  const impressions = Math.max(data.organicImpressions, data.manualImpressions);

  return [
    {
      id: "verified_followers",
      label: "Verified Followers",
      current: data.verifiedFollowers,
      target: TARGETS.verifiedFollowers,
      met: data.verifiedFollowers >= TARGETS.verifiedFollowers,
    },
    {
      id: "organic_impressions",
      label: "Organic Impressions (3mo)",
      current: impressions,
      target: TARGETS.organicImpressions,
      met: impressions >= TARGETS.organicImpressions,
    },
    {
      id: "active_30d",
      label: "Active (30 days)",
      current: data.tweetsLast30Days,
      target: TARGETS.active30d,
      met: data.tweetsLast30Days >= TARGETS.active30d,
    },
    {
      id: "identity_verified",
      label: "Identity Verified",
      current: data.identityVerified ? 1 : 0,
      target: 1,
      met: data.identityVerified,
      manual: true,
    },
    {
      id: "age_18",
      label: "Age 18+",
      current: 1,
      target: 1,
      met: true,
      manual: true,
    },
  ];
}

/**
 * Estimate monthly payout based on verified impressions and engagement quality.
 * Base rate: ~$8.50 per 1M verified impressions, adjusted by engagement.
 */
export function estimatePayout(data: MonetizationData): {
  monthly: number;
  annual: number;
} {
  const impressions = Math.max(data.organicImpressions, data.manualImpressions);
  if (impressions === 0) return { monthly: 0, annual: 0 };

  const baseRate = 8.5; // $ per 1M verified impressions
  const monthlyImpressions = impressions / 3; // 3-month window → per month

  // Engagement multiplier: 2% baseline, capped 0.5x-2.0x
  const engagementMultiplier = Math.max(
    0.5,
    Math.min(2.0, (data.engagementRate || 0) / 0.02),
  );

  // Reply bonus: replies drive 150x ad weight, bonus for above-avg reply rates
  const replyBonus = Math.max(1.0, 1.0 + ((data.replyRate || 0) - 0.005) * 50);

  const monthly =
    (monthlyImpressions / 1_000_000) *
    baseRate *
    engagementMultiplier *
    replyBonus;

  return {
    monthly: Math.round(monthly * 100) / 100,
    annual: Math.round(monthly * 12 * 100) / 100,
  };
}

/**
 * Data-driven coaching tips based on actual metrics.
 */
export function getCoachingTips(data: MonetizationData): CoachingTip[] {
  const tips: CoachingTip[] = [];
  const impressions = Math.max(data.organicImpressions, data.manualImpressions);
  const payout = estimatePayout(data);

  // Reply rate coaching — highest impact for revenue
  if (data.replyRate < 0.005 && data.tweetsLast90Days > 0) {
    const replyPct = (data.replyRate * 100).toFixed(2);
    const potentialBonus = Math.round(payout.monthly * 0.5 * 100) / 100;
    tips.push({
      id: "reply_rate_low",
      title: `Reply rate is ${replyPct}% — ask more questions`,
      description:
        "Posts that ask questions get 3.4x more replies. Replies drive 150x algorithm weight for ad revenue.",
      priority: "high",
      metric: "engagement",
      estimatedImpact:
        potentialBonus > 0 ? `+$${potentialBonus.toFixed(2)}/mo` : undefined,
    });
  }

  // Media usage coaching
  if (data.mediaTweetPercent < 30 && data.tweetsLast90Days > 0) {
    const mediaPct = Math.round(data.mediaTweetPercent);
    tips.push({
      id: "media_low",
      title: `Only ${mediaPct}% of tweets have media`,
      description:
        "Images get 2x engagement. Add visuals to at least half your posts.",
      priority: "high",
      metric: "engagement",
      estimatedImpact: `+$${(payout.monthly * 0.3).toFixed(2)}/mo`,
    });
  }

  // Thread coaching
  if (data.threadCount < 2 && data.tweetsLast30Days >= 5) {
    tips.push({
      id: "threads_low",
      title: `Only ${data.threadCount} thread${data.threadCount !== 1 ? "s" : ""} in 90 days`,
      description: "Threads get 3x engagement. Try 2-3 value threads per week.",
      priority: "medium",
      metric: "organic_impressions",
      estimatedImpact: `+$${(payout.monthly * 0.25).toFixed(2)}/mo`,
    });
  }

  // Peak hours coaching
  if (data.peakHours.length > 0) {
    const peakStr = data.peakHours
      .slice(0, 3)
      .map((h) => `${h}:00`)
      .join(", ");
    tips.push({
      id: "peak_hours",
      title: `Best engagement at ${peakStr} UTC`,
      description: "Shift your posting schedule to these peak hours.",
      priority: "medium",
      metric: "organic_impressions",
    });
  }

  // Verified follower % coaching
  if (data.verifiedFollowerPercent < 5 && data.totalFollowers > 0) {
    const vPct = data.verifiedFollowerPercent.toFixed(1);
    tips.push({
      id: "verified_pct_low",
      title: `Only ${vPct}% Premium followers`,
      description:
        "Engage with verified accounts to attract their followers. Only Premium engagement generates revenue.",
      priority: "high",
      metric: "verified_followers",
    });
  }

  // Geographic coaching — US followers earn higher CPMs
  if (data.topLocations.length > 0) {
    const topLoc = data.topLocations[0];
    const usKeywords = [
      "us",
      "usa",
      "united states",
      "new york",
      "los angeles",
      "california",
      "texas",
      "florida",
      "chicago",
    ];
    const topIsUS = usKeywords.some((kw) =>
      topLoc.location.toLowerCase().includes(kw),
    );
    if (!topIsUS) {
      tips.push({
        id: "geo_non_us",
        title: `Most followers in "${topLoc.location}"`,
        description:
          "US followers earn higher CPMs. Target US peak hours (1-5pm EST) for better monetization.",
        priority: "low",
        metric: "organic_impressions",
      });
    }
  }

  // Verified follower count tips (keep existing logic for threshold progress)
  if (data.verifiedFollowers < 500) {
    tips.push({
      id: "followers_low",
      title: "Focus on growing verified followers",
      description:
        "Engage with accounts in your niche. Reply to popular tweets and add value.",
      priority: "high",
      metric: "verified_followers",
    });
  } else if (data.verifiedFollowers < TARGETS.verifiedFollowers) {
    const remaining = TARGETS.verifiedFollowers - data.verifiedFollowers;
    const pct = Math.round(
      (data.verifiedFollowers / TARGETS.verifiedFollowers) * 100,
    );
    tips.push({
      id: "followers_progress",
      title: `${pct}% to target — ${remaining} more verified needed`,
      description:
        "Engage with larger accounts for visibility. Quality replies attract followers.",
      priority: remaining < 500 ? "low" : "medium",
      metric: "verified_followers",
    });
  }

  // Activity tips
  if (data.tweetsLast30Days < 10) {
    tips.push({
      id: "activity_critical",
      title: `Only ${data.tweetsLast30Days} tweets in 30 days`,
      description: "Post at least 1 tweet/day to maintain algorithmic reach.",
      priority: "high",
      metric: "active_30d",
    });
  } else if (data.tweetsLast30Days < 30) {
    const perDay = (data.tweetsLast30Days / 30).toFixed(1);
    tips.push({
      id: "activity_low",
      title: `Tweeting ${perDay}/day — aim for 3-5/day`,
      description:
        "More tweets = more impressions. Include replies and quote tweets.",
      priority: "medium",
      metric: "active_30d",
    });
  }

  // Impression tips
  if (impressions < 1_000_000) {
    tips.push({
      id: "impressions_low",
      title: "Post 3-5 tweets/day during peak hours",
      description: "Consistency builds reach. Focus on engagement over volume.",
      priority: "high",
      metric: "organic_impressions",
    });
  }

  // Sort by priority, then by estimated impact
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  tips.sort((a, b) => order[a.priority] - order[b.priority]);

  return tips;
}

/**
 * Load monetization data for a specific profile.
 * Falls back to legacy unkeyed storage for migration.
 */
export async function loadMonetizationData(
  userId?: string,
): Promise<MonetizationData | null> {
  if (userId) {
    const key = STORAGE_KEY_PREFIX + userId;
    const result = await chrome.storage.local.get(key);
    if (result[key]) return result[key];
  }

  // Fallback: try legacy key (pre-multi-profile)
  const legacy = await chrome.storage.local.get(LEGACY_STORAGE_KEY);
  return legacy[LEGACY_STORAGE_KEY] || null;
}

/**
 * Save monetization data keyed by profile userId.
 */
export async function saveMonetizationData(
  data: MonetizationData,
): Promise<void> {
  const key = STORAGE_KEY_PREFIX + data.userId;
  await chrome.storage.local.set({ [key]: data });
  // Also write to legacy key for backward compat
  await chrome.storage.local.set({ [LEGACY_STORAGE_KEY]: data });
}

/**
 * List all stored profile IDs that have monetization data.
 */
export async function listMonetizationProfiles(): Promise<string[]> {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith(STORAGE_KEY_PREFIX))
    .map((k) => k.slice(STORAGE_KEY_PREFIX.length));
}
