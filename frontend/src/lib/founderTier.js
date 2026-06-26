/**
 * iter413cl — Founder tier helpers (frontend mirror of revenue.py).
 *
 * Keeps the upgrade-suppression logic + Founder benefits tab + header
 * pill all reading from one source of truth so the maker dashboard
 * never disagrees with itself about whether someone is a founder.
 *
 * Tier resolution mirrors revenue.py:
 *   commission_bps_for() and is_founder()/is_inaugural_founder().
 */

export const FOUNDER_MONTHLY_LISTING_QUOTA = 50;
export const FOUNDER_INAUGURAL_CAP = 100;

/** Stable `YYYY-MM` key matching `maker.listings_by_month` shape. */
export function currentMonthKey(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function isFounder(maker) {
  return !!maker && (maker.tier || "") === "founder";
}

export function isInauguralFounder(maker) {
  return isFounder(maker) && (maker.founder_status || "") === "inaugural";
}

export function isPlus(maker) {
  return !!maker && (maker.subscription_status || "") === "active";
}

/**
 * Highest tier the maker currently holds. Used to pick ONE status pill
 * in the header instead of stacking multiple. Resolution order:
 *   inaugural_founder > founder > plus > standard
 */
export function effectiveTier(maker) {
  if (isInauguralFounder(maker)) return "inaugural_founder";
  if (isFounder(maker)) return "founder";
  if (isPlus(maker)) return "plus";
  return "standard";
}

export const TIER_LABELS = {
  inaugural_founder: "Inaugural Founder",
  founder: "Founder",
  plus: "Crafters Plus",
  standard: "Standard",
};

/** Listings published this calendar month. Reads the same field
 *  the backend uses for quota math (`listings_by_month[yyyymm]`). */
export function listingsThisMonth(maker) {
  if (!maker?.listings_by_month) return 0;
  return Number(maker.listings_by_month[currentMonthKey()] || 0);
}

/** True for founders who still have their monthly free quota available.
 *  We hide all "upgrade to Plus" prompts in this state because Plus would
 *  RAISE their commission (3% → 4%) — confusing and economically wrong. */
export function founderHasFreeQuotaLeft(maker) {
  if (!isFounder(maker)) return false;
  return listingsThisMonth(maker) < FOUNDER_MONTHLY_LISTING_QUOTA;
}

/** Convenience: should we suppress Plus upgrade prompts for this maker?
 *  TRUE when they're a founder who hasn't yet exhausted the 50/mo quota. */
export function shouldSuppressPlusPromptsForFounder(maker) {
  return founderHasFreeQuotaLeft(maker);
}

/** Days remaining in the Founding Access (beta) promo window. Returns
 *  null when the maker isn't in the 90-day Founding Access cohort.
 *  Used by the Founder tab to show "day 47 / 90" sub-text. */
export function foundingAccessDaysLeft(maker) {
  if (!maker?.beta_expires_at) return null;
  const exp = Date.parse(maker.beta_expires_at);
  if (Number.isNaN(exp)) return null;
  const daysLeft = Math.ceil((exp - Date.now()) / (24 * 60 * 60 * 1000));
  return daysLeft > 0 ? daysLeft : 0;
}

/** Days remaining in the regular (non-inaugural) Founder window.
 *  Returns null when the maker isn't a founder or has lifetime status. */
export function regularFounderDaysLeft(maker) {
  if (!isFounder(maker) || isInauguralFounder(maker)) return null;
  if (!maker?.founder_expires_at) return null;
  const exp = Date.parse(maker.founder_expires_at);
  if (Number.isNaN(exp)) return null;
  return Math.max(0, Math.ceil((exp - Date.now()) / (24 * 60 * 60 * 1000)));
}
