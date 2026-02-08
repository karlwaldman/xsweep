import { describe, it, expect } from "vitest";
import {
  getRequirements,
  getCoachingTips,
  loadMonetizationData,
  saveMonetizationData,
} from "@/core/monetization";
import type { MonetizationData } from "@/core/monetization";

function makeData(overrides: Partial<MonetizationData> = {}): MonetizationData {
  return {
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

  it("returns minimal tips when all metrics are good", () => {
    const data = makeData({
      verifiedFollowers: 3000,
      organicImpressions: 6_000_000,
      tweetsLast30Days: 100,
      avgViewsPerTweet: 5000,
    });
    const tips = getCoachingTips(data);
    expect(tips.length).toBe(0);
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

  it("returns low engagement tip when avgViews < 100", () => {
    const data = makeData({
      verifiedFollowers: 3000,
      organicImpressions: 6_000_000,
      tweetsLast30Days: 100,
      avgViewsPerTweet: 50,
    });
    const tips = getCoachingTips(data);
    expect(tips.find((t) => t.id === "engagement_low")).toBeDefined();
  });
});

describe("loadMonetizationData / saveMonetizationData", () => {
  it("returns null when no data saved", async () => {
    const result = await loadMonetizationData();
    expect(result).toBeNull();
  });

  it("round-trips data through save and load", async () => {
    const data = makeData({
      verifiedFollowers: 1500,
      organicImpressions: 2_000_000,
    });
    await saveMonetizationData(data);
    const loaded = await loadMonetizationData();
    expect(loaded).toEqual(data);
  });
});
