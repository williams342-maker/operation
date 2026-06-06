import { http, API } from "./api";

const VIS_KEY = "cm_visitor_id";
const SES_KEY = "cm_session_id";
const SES_LAST = "cm_session_last";
const ATTR_KEY = "cm_attribution_source";   // off-site ad attribution
const ATTR_TS_KEY = "cm_attribution_ts";
const ATTR_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
const SESSION_GAP_MS = 30 * 60 * 1000;            // 30 min inactivity gap

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function getVisitorId() {
  try {
    let v = localStorage.getItem(VIS_KEY);
    if (!v) {
      v = uuid();
      localStorage.setItem(VIS_KEY, v);
    }
    return v;
  } catch {
    return "anon";
  }
}

function getSessionId() {
  try {
    const now = Date.now();
    const last = parseInt(sessionStorage.getItem(SES_LAST) || "0", 10);
    let s = sessionStorage.getItem(SES_KEY);
    if (!s || (now - last) > SESSION_GAP_MS) {
      s = uuid();
      sessionStorage.setItem(SES_KEY, s);
    }
    sessionStorage.setItem(SES_LAST, String(now));
    return s;
  } catch {
    return "anon";
  }
}

let lastTracked = "";

// Time-on-page state for the most recent pageview.
let _currentEventId = null;
let _currentPath = null;
let _enteredAt = 0;
let _accruedMs = 0;
let _wasVisible = true;
let _flushedMs = 0;       // total dwell already pushed to backend for this event

/**
 * Send (event_id, dwell_ms) via sendBeacon when available — survives unload.
 * Falls back to fetch with keepalive=true.
 */
function flushDwell() {
  if (!_currentEventId) return;
  const total = _accruedMs + (_wasVisible && _enteredAt ? Date.now() - _enteredAt : 0);
  if (total <= _flushedMs) return;
  _flushedMs = total;
  const payload = JSON.stringify({ event_id: _currentEventId, dwell_ms: total });
  const url = `${API}/analytics/dwell`;
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(url, blob);
      return;
    }
  } catch { /* fall through */ }
  try {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch { /* swallow */ }
}

function _markVisible() {
  if (_wasVisible) return;
  _wasVisible = true;
  _enteredAt = Date.now();
}

function _markHidden() {
  if (!_wasVisible) return;
  _wasVisible = false;
  if (_enteredAt) _accruedMs += Date.now() - _enteredAt;
  _enteredAt = 0;
  flushDwell();
}

function _resetForNewPage(eventId, path) {
  flushDwell();                         // close out previous page first
  _currentEventId = eventId || null;
  _currentPath = path;
  _enteredAt = Date.now();
  _accruedMs = 0;
  _flushedMs = 0;
  _wasVisible = !document.hidden;
  if (!_wasVisible) _enteredAt = 0;
}

let _listenersAttached = false;
function _attachListenersOnce() {
  if (_listenersAttached || typeof document === "undefined") return;
  _listenersAttached = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) _markHidden();
    else _markVisible();
  });
  // Catch-all for tab/window close
  window.addEventListener("pagehide", flushDwell);
  window.addEventListener("beforeunload", flushDwell);
}

/**
 * Capture and persist UTM source (or `via=external`) for off-site ad
 * attribution. Stored in localStorage with a 30-day TTL — surfaced at
 * checkout so Stripe Connect can apply the off-site fee surcharge.
 *
 * iter334l — Also captures Microsoft Ads `msclkid` query param so the
 * admin ROAS tile can attribute revenue back to Bing Ads spend.
 *
 * iter334u — Same pattern for Google Ads `gclid` query param → Google
 * Ads ROAS tile attribution.
 *
 * iter334x — Same pattern for Meta Ads `fbclid` query param → Meta
 * Ads ROAS tile attribution.
 */
const MSCLKID_KEY = "cm_msclkid";
const MSCLKID_TS_KEY = "cm_msclkid_ts";
const GCLID_KEY = "cm_gclid";
const GCLID_TS_KEY = "cm_gclid_ts";
const FBCLID_KEY = "cm_fbclid";
const FBCLID_TS_KEY = "cm_fbclid_ts";

export function captureAttribution() {
  try {
    const url = new URL(window.location.href);
    const utm = url.searchParams.get("utm_source") || url.searchParams.get("via");
    if (utm) {
      localStorage.setItem(ATTR_KEY, utm.slice(0, 50));
      localStorage.setItem(ATTR_TS_KEY, String(Date.now()));
    }
    const msclkid = url.searchParams.get("msclkid");
    if (msclkid) {
      // Microsoft Click ID. Persist for 30 days — Bing's standard
      // attribution window. Maxed at 100 chars to bound localStorage.
      localStorage.setItem(MSCLKID_KEY, msclkid.slice(0, 100));
      localStorage.setItem(MSCLKID_TS_KEY, String(Date.now()));
    }
    const gclid = url.searchParams.get("gclid");
    if (gclid) {
      // Google Click ID. 90-day default attribution window in Google
      // Ads; we use the same 30-day TTL as msclkid for consistency.
      localStorage.setItem(GCLID_KEY, gclid.slice(0, 200));
      localStorage.setItem(GCLID_TS_KEY, String(Date.now()));
    }
    const fbclid = url.searchParams.get("fbclid");
    if (fbclid) {
      // Facebook Click ID (Meta). 28-day default attribution window.
      // We use the same 30-day TTL — close enough and one less knob.
      // Fbclids can be quite long (encoded session data), cap at 300.
      localStorage.setItem(FBCLID_KEY, fbclid.slice(0, 300));
      localStorage.setItem(FBCLID_TS_KEY, String(Date.now()));
    }
  } catch { /* swallow */ }
}

/** Returns the persisted msclkid if within 30-day TTL, else null. */
export function getMsclkid() {
  try {
    const ts = parseInt(localStorage.getItem(MSCLKID_TS_KEY) || "0", 10);
    if (!ts || Date.now() - ts > ATTR_TTL_MS) return null;
    return localStorage.getItem(MSCLKID_KEY) || null;
  } catch {
    return null;
  }
}

/** Returns the persisted gclid if within 30-day TTL, else null. */
export function getGclid() {
  try {
    const ts = parseInt(localStorage.getItem(GCLID_TS_KEY) || "0", 10);
    if (!ts || Date.now() - ts > ATTR_TTL_MS) return null;
    return localStorage.getItem(GCLID_KEY) || null;
  } catch {
    return null;
  }
}

/** Returns the persisted fbclid if within 30-day TTL, else null. */
export function getFbclid() {
  try {
    const ts = parseInt(localStorage.getItem(FBCLID_TS_KEY) || "0", 10);
    if (!ts || Date.now() - ts > ATTR_TTL_MS) return null;
    return localStorage.getItem(FBCLID_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Returns the active attribution source if within TTL, else null.
 * Anything not "internal" or "" is treated as external (off-site) traffic
 * for Stripe Connect fee purposes. The backend trusts `external_attribution`
 * — the frontend just forwards the source string.
 */
export function getAttributionSource() {
  try {
    const ts = parseInt(localStorage.getItem(ATTR_TS_KEY) || "0", 10);
    if (!ts || Date.now() - ts > ATTR_TTL_MS) return null;
    const src = localStorage.getItem(ATTR_KEY);
    return src && src !== "internal" ? src : null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget pageview tracker. Never throws — analytics must not break
 * the page. De-dupes consecutive identical paths within 1s to handle StrictMode
 * double-invocation in dev.
 */
export function trackPageview() {
  const path = window.location.pathname + window.location.search;
  const key = `${path}@${Math.floor(Date.now() / 1000)}`;
  if (key === lastTracked) return;
  lastTracked = key;

  // Skip the admin / maker dashboards — internal traffic shouldn't pollute.
  if (path.startsWith("/admin") || path.startsWith("/maker/")) {
    flushDwell();   // close out whatever was on the previous page
    _currentEventId = null;
    return;
  }

  _attachListenersOnce();

  try {
    http.post("/analytics/track", {
      path,
      referer: document.referrer || "",
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      title: (document.title || "").slice(0, 200),
    }).then((res) => {
      const eid = res?.data?.event_id || null;
      _resetForNewPage(eid, path);
    }).catch(() => {
      // Ingest may have failed (offline) — still set up local timing so the
      // next nav can flush a no-op.
      _resetForNewPage(null, path);
    });
  } catch {
    // swallow
  }
}
