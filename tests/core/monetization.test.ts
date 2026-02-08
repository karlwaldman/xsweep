import { describe, it, expect } from "vitest";
import {
  getRequirements,
  getCoachingTips,
  estimatePayout,
  loadMonetizationData,
  saveMonetizationData,
} from "@/core/monetization";
import type { MonetizationData } from "@/core/monetization";

function makeData(overrides: Partial<MonetizationData> = {}): MonetizationData {
  return {
    userId: "12345",
    verifiedFollowers: 0,
    totalFollowers: 0,
    organicImpressions: 0,
    manualImpressions: 0,
    impressionsAvailable: true,
    tweetsLast30Days: 0,
    tweetsLast90Days: 0,
    avgViewsPerTweet: 0,
    topTweetViews: 0,
    lastChecked: new Date().toISOString(),
    identityVerified: false,
    // Engagement
    totalReplies: 0,
    totalRetweets: 0,
    totalLikes: 0,
    engagementRate: 0,
    avgRepliesPerTweet: 0,
    replyRate: 0,
    // Content
    mediaTweetPercent: 0,
    threadCount: 0,
    avgThreadEngagement: 0,
    // Peak times
    peakHours: [],
    peakDays: [],
    // Verified intelligence
    verifiedFollowerPercent: 0,
    topVerifiedFollowers: [],
    // Geo
    topLocations: [],
    // Payout
    estimatedMonthlyPayout: 0,
    projectedAnnualPayout: 0,
    ...overrides,
  };
}

describe("getRequirements", () => {
  it("returns all requirements met when all criteria satisfied", () => {
    const data = makeData({
      verifiedFollowers: 2500,
      organicImpressions: 6_000_000,
      tweetsLast30Days: 50,
      identityVerified: true,
    });
    const reqs = getRequirements(data);
    expect(reqs).toHaveLength(5);
    expect(reqs.every((r) => r.met)).toBe(true);
  });

  it("returns all requirements not met when nothing achieved", () => {
    const data = makeData();
    const reqs = getRequirements(data);
    // age_18 is always met
    const nonAge = reqs.filter((r) => r.id !== "age_18");
    expect(nonAge.every((r) => !r.met)).toBe(true);
    expect(reqs.find((r) => r.id === "age_18")!.met).toBe(true);
  });

  it("handles partial progress correctly", () => {
    const data = makeData({
      verifiedFollowers: 2100, // met
      organicImpressions: 1_000_000, // not met
      tweetsLast30Days: 5, // met
      identityVerified: false, // not met
    });
    const reqs = getRequirements(data);
    expect(reqs.find((r) => r.id === "verified_followers")!.met).toBe(true);
    expect(reqs.find((r) => r.id === "organic_impressions")!.met).toBe(false);
    expect(reqs.find((r) => r.id === "active_30d")!.met).toBe(true);
    expect(reqs.find((r) => r.id === "identity_verified")!.met).toBe(false);
    expect(reqs.find((r) => r.id === "age_18")!.met).toBe(true);
  });

  it("uses manual impressions when API impressions unavailable", () => {
    const data = makeData({
      organicImpressions: 0,
      manualImpressions: 6_000_000,
      impressionsAvailable: false,
    });
    const reqs = getRequirements(data);
    const impressionReq = reqs.find((r) => r.id === "organic_impressions")!;
    expect(impressionReq.met).toBe(true);
    expect(impressionReq.current).toBe(6_000_000);
  });

  it("uses max of API vs manual impressions", () => {
    const data = makeData({
      organicImpressions: 3_000_000,
      manualImpressions: 5_500_000,
    });
    const reqs = getRequirements(data);
    const impressionReq = reqs.find((r) => r.id === "organic_impressions")!;
    expect(impressionReq.current).toBe(5_500_000);

    // Now flip it
    const data2 = makeData({
      organicImpressions: 7_000_000,
      manualImpressions: 2_000_000,
    });
    const reqs2 = getRequirements(data2);
    const impressionReq2 = reqs2.find((r) => r.id === "organic_impressions")!;
    expect(impressionReq2.current).toBe(7_000_000);
  });
});

describe("estimatePayout", () => {
  it("returns zero payout when no impressions", () => {
    const data = makeData();
    const payout = estimatePayout(data);
    expect(payout.monthly).toBe(0);
    expect(payout.annual).toBe(0);
  });

  it("calculates base payout from impressions", () => {
    const data = makeData({
      organicImpressions: 3_000_000, // 1M per month
      engagementRate: 0.02, // baseline = 1.0x multiplier
      replyRate: 0.005, // baseline = 1.0x bonus
    });
    const payout = estimatePayout(data);
    // 1M / 1M * 8.5 * 1.0 * 1.0 = $8.50/mo
    expect(payout.monthly).toBe(8.5);
    expect(payout.annual).toBe(102);
  });

  it("increases payout with higher engagement rate", () => {
    const base = makeData({
      organicImpressions: 3_000_000,
      engagementRate: 0.02,
      replyRate: 0.005,
    });
    const high = makeData({
      organicImpressions: 3_000_000,
      engagementRate: 0.04, // 2x baseline
      replyRate: 0.005,
    });
    expect(estimatePayout(high).monthly).toBeGreaterThan(
      estimatePayout(base).monthly,
    );
  });

  it("increases payout with higher reply rate", () => {
    const base = makeData({
      organicImpressions: 3_000_000,
      engagementRate: 0.02,
      replyRate: 0.005,
    });
    const high = makeData({
      organicImpressions: 3_000_000,
      engagementRate: 0.02,
      replyRate: 0.015, // 3x baseline
    });
    expect(estimatePayout(high).monthly).toBeGreaterThan(
      estimatePayout(base).monthly,
    );
  });
});

describe("getCoachingTips", () => {
  it("returns follower growth tips for low followers", () => {
    const data = makeData({ verifiedFollowers: 100 });
    const tips = getCoachingTips(data);
    expect(tips.some((t) => t.metric === "verified_followers")).toBe(true);
    expect(tips.find((t) => t.id === "followers_low")).toBeDefined();
  });

  it("returns impression tips for low impressions", () => {
    const data = makeData({ organicImpressions: 500_000 });
    const tips = getCoachingTips(data);
    expect(tips.some((t) => t.metric === "organic_impressions")).toBe(true);
  });

  it("returns activity tips for low tweet frequency", () => {
    const data = makeData({ tweetsLast30Days: 5 });
    const tips = getCoachingTips(data);
    expect(tips.some((t) => t.metric === "active_30d")).toBe(true);
    expect(tips.find((t) => t.id === "activity_critical")).toBeDefined();
  });

  it("returns reply rate tips when reply rate is low", () => {
    const data = makeData({
      tweetsLast90Days: 50,
      replyRate: 0.001,
      organicImpressions: 1_000_000,
    });
    const tips = getCoachingTips(data);
    expect(tips.find((t) => t.id === "reply_rate_low")).toBeDefined();
  });

  it("returns media tips when media usage is low", () => {
    const data = makeData({
      tweetsLast90Days: 50,
      mediaTweetPercent: 10,
    });
    const tips = getCoachingTips(data);
    expect(tips.find((t) => t.id === "media_low")).toBeDefined();
  });

  it("returns thread tips when thread count is low", () => {
    const data = makeData({
      threadCount: 0,
      tweetsLast30Days: 30,
    });
    const tips = getCoachingTips(data);
    expect(tips.find((t) => t.id === "threads_low")).toBeDefined();
  });

  it("returns verified % tip when low", () => {
    const data = makeData({
      totalFollowers: 1000,
      verifiedFollowerPercent: 2,
    });
    const tips = getCoachingTips(data);
    expect(tips.find((t) => t.id === "verified_pct_low")).toBeDefined();
  });

  it("returns peak hours tip when peak hours available", () => {
    const data = makeData({
      peakHours: [14, 17, 21],
    });
    const tips = getCoachingTips(data);
    expect(tips.find((t) => t.id === "peak_hours")).toBeDefined();
  });

  it("includes estimated impact on tips where applicable", () => {
    const data = makeData({
      tweetsLast90Days: 50,
      replyRate: 0.001,
      organicImpressions: 3_000_000,
      engagementRate: 0.02,
    });
    const tips = getCoachingTips(data);
    const replyTip = tips.find((t) => t.id === "reply_rate_low");
    expect(replyTip?.estimatedImpact).toBeDefined();
    expect(replyTip?.estimatedImpact).toMatch(/^\+\$/);
  });

  it("sorts tips by priority (high first)", () => {
    const data = makeData({
      verifiedFollowers: 100,
      organicImpressions: 500_000,
      tweetsLast30Days: 5,
    });
    const tips = getCoachingTips(data);
    expect(tips.length).toBeGreaterThan(1);
    for (let i = 1; i < tips.length; i++) {
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      expect(order[tips[i].priority]).toBeGreaterThanOrEqual(
        order[tips[i - 1].priority],
      );
    }
  });
});

describe("loadMonetizationData / saveMonetizationData", () => {
  it("returns null when no data saved", async () => {
    const result = await loadMonetizationData();
    expect(result).toBeNull();
  });

  it("round-trips data through save and load (profile-keyed)", async () => {
    const data = makeData({
      userId: "profile_1",
      verifiedFollowers: 1500,
      organicImpressions: 2_000_000,
    });
    await saveMonetizationData(data);
    const loaded = await loadMonetizationData("profile_1");
    expect(loaded).toEqual(data);
  });

  it("stores separate data per profile", async () => {
    const profile1 = makeData({
      userId: "profile_a",
      verifiedFollowers: 500,
    });
    const profile2 = makeData({
      userId: "profile_b",
      verifiedFollowers: 2000,
    });
    await saveMonetizationData(profile1);
    await saveMonetizationData(profile2);

    const loaded1 = await loadMonetizationData("profile_a");
    const loaded2 = await loadMonetizationData("profile_b");
    expect(loaded1?.verifiedFollowers).toBe(500);
    expect(loaded2?.verifiedFollowers).toBe(2000);
  });

  it("falls back to legacy key when no profile-keyed data found", async () => {
    const data = makeData({
      userId: "legacy_user",
      verifiedFollowers: 999,
    });
    await saveMonetizationData(data); // saves to both legacy and profile-keyed
    // Loading without a userId falls back to legacy key
    const loaded = await loadMonetizationData();
    expect(loaded?.verifiedFollowers).toBe(999);
  });
});
