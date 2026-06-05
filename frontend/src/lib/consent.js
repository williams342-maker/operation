/**
 * iter334e — GDPR consent storage + vendor consent API.
 *
 * Centralizes the localStorage shape so the bootstrap script in
 * `public/index.html` (which can't import) and the React app stay in
 * sync. Schema version bumped whenever the shape changes — the banner
 * treats an older version as "no choice yet" and re-prompts.
 */
const STORAGE_KEY = "cm_consent";
const SCHEMA_VERSION = 1;

/** @typedef {'granted'|'denied'} ConsentState */

/** @typedef {{ ad_storage: ConsentState, analytics_storage: ConsentState, version: number, decided_at: string }} ConsentRecord */

/** Read the persisted consent record, or null if none / outdated. */
export function readConsent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || c.version !== SCHEMA_VERSION) return null;
    if (c.ad_storage !== "granted" && c.ad_storage !== "denied") return null;
    if (c.analytics_storage !== "granted" && c.analytics_storage !== "denied") return null;
    return c;
  } catch {
    return null;
  }
}

/** Persist a consent choice + push it to GA4 + UET immediately. */
export function writeConsent(adStorage, analyticsStorage) {
  const record = {
    ad_storage: adStorage,
    analytics_storage: analyticsStorage,
    version: SCHEMA_VERSION,
    decided_at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* Storage disabled — push consent anyway so this session works. */
  }
  pushVendorConsent(adStorage, analyticsStorage);
  return record;
}

/** Push consent update to GA4 + UET without touching localStorage. */
export function pushVendorConsent(adStorage, analyticsStorage) {
  if (typeof window === "undefined") return;
  try {
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", {
        ad_storage: adStorage,
        analytics_storage: analyticsStorage,
        ad_user_data: adStorage,
        ad_personalization: adStorage,
      });
    }
  } catch { /* swallow — analytics should never break the app */ }
  try {
    if (window.uetq && typeof window.uetq.push === "function") {
      window.uetq.push("consent", "update", { ad_storage: adStorage });
    }
  } catch { /* same */ }
}

/** Convenience helpers for the banner. */
export const acceptAll = () => writeConsent("granted", "granted");
export const rejectAll = () => writeConsent("denied", "denied");

/** Custom event the Footer "Cookie preferences" link can dispatch to
 *  re-open the banner. CookieBanner.jsx listens for this. */
export const REOPEN_EVENT = "cm:reopen-cookie-banner";
export const reopenBanner = () => {
  try {
    window.dispatchEvent(new CustomEvent(REOPEN_EVENT));
  } catch { /* noop */ }
};
