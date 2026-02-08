import { describe, it, expect } from "vitest";
import { formatTimeAgo, formatCount } from "@/utils/format";

describe("formatTimeAgo", () => {
  it("returns 'No tweets' for null", () => {
    expect(formatTimeAgo(null)).toBe("No tweets");
  });

  it("returns 'today' for 0", () => {
    expect(formatTimeAgo(0)).toBe("today");
  });

  it("returns 'today' for negative values", () => {
    expect(formatTimeAgo(-1)).toBe("today");
    expect(formatTimeAgo(-100)).toBe("today");
  });

  it("returns days for 1-6", () => {
    expect(formatTimeAgo(1)).toBe("1d ago");
    expect(formatTimeAgo(3)).toBe("3d ago");
    expect(formatTimeAgo(6)).toBe("6d ago");
  });

  it("returns weeks for 7-29", () => {
    expect(formatTimeAgo(7)).toBe("1w ago");
    expect(formatTimeAgo(14)).toBe("2w ago");
    expect(formatTimeAgo(29)).toBe("4w ago");
  });

  it("returns months for 30-364", () => {
    expect(formatTimeAgo(30)).toBe("1mo ago");
    expect(formatTimeAgo(59)).toBe("1mo ago");
    expect(formatTimeAgo(60)).toBe("2mo ago");
    expect(formatTimeAgo(180)).toBe("6mo ago");
    expect(formatTimeAgo(364)).toBe("12mo ago");
  });

  it("returns years for 365+", () => {
    expect(formatTimeAgo(365)).toBe("1y ago");
    expect(formatTimeAgo(729)).toBe("1y ago");
    expect(formatTimeAgo(730)).toBe("2y ago");
    expect(formatTimeAgo(1500)).toBe("4y ago");
  });
});

describe("formatCount", () => {
  it("formats numbers under 1000 as-is", () => {
    expect(formatCount(500)).toBe("500");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
  });

  it("formats low thousands with one decimal K", () => {
    expect(formatCount(1234)).toBe("1.2K");
    expect(formatCount(1000)).toBe("1K");
  });

  it("rounds to nearest K for 10K+", () => {
    expect(formatCount(45000)).toBe("45K");
    expect(formatCount(10000)).toBe("10K");
    expect(formatCount(9999)).toBe("10K");
  });

  it("formats low millions with one decimal M", () => {
    expect(formatCount(1200000)).toBe("1.2M");
    expect(formatCount(1000000)).toBe("1M");
  });

  it("rounds to nearest M for 10M+", () => {
    expect(formatCount(10000000)).toBe("10M");
    expect(formatCount(50000000)).toBe("50M");
  });
});
