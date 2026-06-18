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

/**
 * iter334f — Microsoft Ads conversion event helper.
 *
 * Safely fires a UET custom event. Honors the Consent Mode default —
 * if the user rejected ad_storage, Microsoft's SDK silently drops the
 * event server-side, so calling this is always safe. The local guard
 * just avoids throwing if the SDK hasn't loaded (ad blocker, etc).
 *
 * Standard events Microsoft accepts:
 *   - 'purchase' with { revenue_value, currency, event_label?, event_value? }
 *   - 'submit_lead' with { event_label?, event_value? }
 *   - 'sign_up' / 'add_to_cart' / 'begin_checkout' (full list:
 *     https://help.ads.microsoft.com/#apex/ads/en/60118)
 *
 * Returns true if the event was queued, false otherwise.
 */
export function uetTrack(eventName, params = {}) {
  if (typeof window === "undefined") return false;
  try {
    if (!window.uetq || typeof window.uetq.push !== "function") return false;
    window.uetq.push("event", eventName, params);
    return true;
  } catch {
    return false;
  }
}

/**
 * iter413av — UET Enhanced Conversions PII push.
 * Sends the visitor's email/phone to Microsoft so Bing can match offline
 * conversions back to ad clicks even when the cookie expires or the
 * click came from a different browser. Microsoft accepts plain values
 * (they hash server-side with SHA-256) — we just normalize first
 * (lowercase email, strip phone formatting) per their spec.
 *
 * Call this once per page after the user identifies themselves
 * (login, signup, checkout, contact form submit). It's idempotent:
 * calling it twice with the same values is a no-op as far as Bing's
 * matching pipeline is concerned.
 *
 * Honors consent: skipped when ad_storage='denied'.
 *
 * Docs: https://help.ads.microsoft.com/apex/index/3/en/60111
 */
export function uetSetPII({ email, phone } = {}) {
  if (typeof window === "undefined") return false;
  try {
    if (!window.uetq || typeof window.uetq.push !== "function") return false;
    const consent = readConsent();
    if (consent && consent.ad_storage !== "granted") return false;
    const pid = {};
    if (email && typeof email === "string") {
      pid.em = email.trim().toLowerCase();
    }
    if (phone && typeof phone === "string") {
      // Strip everything except digits and the leading +
      const digits = phone.replace(/[^\d+]/g, "");
      if (digits) pid.ph = digits.startsWith("+") ? digits : `+${digits}`;
    }
    if (!pid.em && !pid.ph) return false;
    window.uetq.push("set", { pid });
    return true;
  } catch {
    return false;
  }
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
