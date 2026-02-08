/**
 * Monetization tracker: types, requirement calculations, coaching tips,
 * and chrome.storage persistence for X Creator Monetization progress.
 */

export interface MonetizationData {
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
}

const STORAGE_KEY = "xsweep_monetization";

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

export function getCoachingTips(data: MonetizationData): CoachingTip[] {
  const tips: CoachingTip[] = [];
  const impressions = Math.max(data.organicImpressions, data.manualImpressions);

  // Verified follower tips
  if (data.verifiedFollowers < 500) {
    tips.push({
      id: "followers_low",
      title: "Focus on growing followers first",
      description:
        "Engage with accounts in your niche. Reply to popular tweets and add value.",
      priority: "high",
      metric: "verified_followers",
    });
  } else if (data.verifiedFollowers < 1500) {
    const pct = Math.round(
      (data.verifiedFollowers / TARGETS.verifiedFollowers) * 100,
    );
    tips.push({
      id: "followers_mid",
      title: `You're ${pct}% there on followers`,
      description:
        "Post consistently to attract verified followers. Quality > quantity.",
      priority: "medium",
      metric: "verified_followers",
    });
  } else if (data.verifiedFollowers < TARGETS.verifiedFollowers) {
    const remaining = TARGETS.verifiedFollowers - data.verifiedFollowers;
    tips.push({
      id: "followers_almost",
      title: `Almost there! ${remaining} more verified followers needed`,
      description:
        "Keep up the momentum. Engage with larger accounts for visibility.",
      priority: "low",
      metric: "verified_followers",
    });
  }

  // Impression tips
  if (impressions < 1_000_000) {
    tips.push({
      id: "impressions_low",
      title: "Post 3-5 tweets/day during peak hours",
      description:
        "Best times: 9-11am and 1-3pm EST. Consistency builds reach.",
      priority: "high",
      metric: "organic_impressions",
    });
  } else if (impressions < 3_000_000) {
    tips.push({
      id: "impressions_mid",
      title: "Use threads for longer content",
      description:
        "Threads get 2-3x more impressions than single tweets. Break ideas into 3-5 tweet threads.",
      priority: "medium",
      metric: "organic_impressions",
    });
  } else if (impressions < TARGETS.organicImpressions) {
    tips.push({
      id: "impressions_almost",
      title: "Focus on viral-potential content",
      description:
        "Hot takes, data threads, and contrarian opinions drive the most impressions.",
      priority: "low",
      metric: "organic_impressions",
    });
  }

  // Activity tips
  if (data.tweetsLast30Days < 10) {
    tips.push({
      id: "activity_critical",
      title: `Critical: Only ${data.tweetsLast30Days} tweets in 30 days`,
      description: "Post at least 1 tweet/day to maintain algorithmic reach.",
      priority: "high",
      metric: "active_30d",
    });
  } else if (data.tweetsLast30Days < 30) {
    const perDay = (data.tweetsLast30Days / 30).toFixed(1);
    tips.push({
      id: "activity_low",
      title: `You're tweeting ${perDay}/day. Aim for 3-5/day`,
      description:
        "More tweets = more impressions. Include replies and quote tweets.",
      priority: "medium",
      metric: "active_30d",
    });
  }

  // Engagement quality tip
  if (data.avgViewsPerTweet > 0 && data.avgViewsPerTweet < 100) {
    tips.push({
      id: "engagement_low",
      title: "Low impression rate per tweet",
      description:
        "Try adding images, polls, or questions. Visual tweets get 2x more engagement.",
      priority: "medium",
      metric: "organic_impressions",
    });
  }

  // Sort by priority
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  tips.sort((a, b) => order[a.priority] - order[b.priority]);

  return tips;
}

export async function loadMonetizationData(): Promise<MonetizationData | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || null;
}

export async function saveMonetizationData(
  data: MonetizationData,
): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}
