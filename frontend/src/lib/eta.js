/**
 * iter386 — Client-side mirror of the backend `_eta_window()` rules
 * (checkout.py) so the product page can show "Arrives Jun 18 – 21"
 * without an extra API round-trip. The cart keeps using the
 * authoritative backend quote; this is a display nudge only.
 *
 * Rules (keep in sync with checkout.py):
 *   • parse up to two day-counts from the maker's copy ("3-5 business days")
 *   • business days stretch to calendar (×7/5)
 *   • unparseable/missing → platform default 4–8 days
 *   • +1 / +2 handling padding
 */
export function etaRange(estText) {
  const txt = (estText || "").trim();
  const nums = (txt.match(/\d+/g) || [])
    .map(Number)
    .filter((n) => n > 0 && n < 60)
    .slice(0, 2);
  let lo, hi;
  if (nums.length >= 2) [lo, hi] = nums;
  else if (nums.length === 1) lo = hi = nums[0];
  else { lo = 4; hi = 8; }
  if (/business/i.test(txt)) {
    lo = Math.ceil((lo * 7) / 5);
    hi = Math.ceil((hi * 7) / 5);
  }
  lo += 1; hi += 2;
  const day = 86400000;
  const fmt = (t) =>
    new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(Date.now() + lo * day)} – ${fmt(Date.now() + hi * day)}`;
}
