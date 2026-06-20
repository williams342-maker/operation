// iter413bb — Anonymous attribution cookie.
//
// One stable UUID per device, stored in localStorage with a soft 30-day
// expiry. Used to tie a lead-magnet download to a later /apply
// page-view and a later maker-application submission without requiring
// the visitor to log in.
//
// Why localStorage not an HTTP cookie? Same-site cross-subdomain reads
// are simpler (the lead-magnet form lives on the homepage, the apply
// page lives on /apply — both same origin), no SameSite headaches,
// and the value survives third-party-cookie purges.

const KEY = "cm_visitor_id";
const EXP_KEY = "cm_visitor_id_exp";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hex32() {
  // 32 hex chars (no dashes) — matches the backend regex.
  const a = new Uint8Array(16);
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(a);
  } else {
    for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getVisitorId() {
  if (typeof window === "undefined") return "";
  try {
    const now = Date.now();
    const stored = localStorage.getItem(KEY);
    const exp = parseInt(localStorage.getItem(EXP_KEY) || "0", 10) || 0;
    if (stored && exp > now) return stored;
    const fresh = hex32();
    localStorage.setItem(KEY, fresh);
    localStorage.setItem(EXP_KEY, String(now + TTL_MS));
    return fresh;
  } catch {
    return "";
  }
}

// Pull UTM + referrer from the current page. Used by ApplyPage on mount
// + by the homepage lead-magnet form.
export function readAttributionContext() {
  if (typeof window === "undefined") return {};
  try {
    const url = new URL(window.location.href);
    const get = (k) => (url.searchParams.get(k) || "").trim().slice(0, 128);
    return {
      visitor_id: getVisitorId(),
      source: get("utm_source") || undefined,
      medium: get("utm_medium") || undefined,
      campaign: get("utm_campaign") || undefined,
      referrer: (document.referrer || "").slice(0, 512) || undefined,
    };
  } catch {
    return { visitor_id: getVisitorId() };
  }
}
