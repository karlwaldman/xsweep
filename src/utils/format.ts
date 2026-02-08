/**
 * Formatting utilities.
 */

/**
 * Convert days-since-last-tweet into a human-friendly string.
 * null → "No tweets", 0/negative → "today", then d/w/mo/y buckets.
 */
export function formatTimeAgo(days: number | null): string {
  if (days === null) return "No tweets";
  if (days <= 0) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * Format a number compactly: 1234 → "1.2K", 45000 → "45K", 1200000 → "1.2M"
 */
export function formatCount(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return m >= 10
      ? `${Math.round(m)}M`
      : `${m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return k >= 10
      ? `${Math.round(k)}K`
      : `${k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return n.toString();
}
