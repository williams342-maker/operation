/**
 * Compact time-ago formatting shared across the app. Returns the
 * smallest reasonable unit that fits: "just now", "2m ago", "3h ago",
 * "5d ago", "2w ago", "3mo ago", "1y ago".
 *
 * Input: ISO-8601 string or Date. Non-parsable → null.
 */
export function timeAgo(input) {
  if (!input) return null;
  const then = input instanceof Date ? input : new Date(input);
  if (isNaN(then.getTime())) return null;
  const sec = Math.floor((Date.now() - then.getTime()) / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  if (day < 365) return `${Math.floor(day / 30)}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

/** Whole-day diff; used by the backorder "stale" badge. Returns 0 for today. */
export function daysSince(input) {
  if (!input) return null;
  const then = input instanceof Date ? input : new Date(input);
  if (isNaN(then.getTime())) return null;
  return Math.floor((Date.now() - then.getTime()) / (1000 * 60 * 60 * 24));
}
