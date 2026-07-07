/**
 * Lightweight growth-analytics tracker.
 * Fires a `POST /api/analytics/events` beacon for funnel signals we want
 * to see in the admin Growth Analytics page.
 *
 * Usage:
 *   import { trackEvent } from "../lib/growthTrack";
 *   trackEvent("apply_click", { path: window.location.pathname });
 *
 * Beacons are fire-and-forget (`keepalive: true` so they survive page
 * navigation). No PII is ever sent; the backend strips headers we don't
 * need before storing.
 */
const API = process.env.REACT_APP_BACKEND_URL;

let _sessionId = null;
let _visitorId = null;

function _sid() {
  if (_sessionId) return _sessionId;
  try {
    const key = "cm_growth_sid";
    let v = sessionStorage.getItem(key);
    if (!v) {
      v = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)) + Date.now().toString(36);
      sessionStorage.setItem(key, v);
    }
    _sessionId = v;
  } catch { _sessionId = "anon"; }
  return _sessionId;
}

function _vid() {
  if (_visitorId) return _visitorId;
  try {
    const key = "cm_growth_vid";
    let v = localStorage.getItem(key);
    if (!v) {
      v = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)) + Date.now().toString(36);
      localStorage.setItem(key, v);
    }
    _visitorId = v;
  } catch { _visitorId = "anon"; }
  return _visitorId;
}

export function trackEvent(eventType, extra = {}) {
  try {
    const body = JSON.stringify({
      event_type: eventType,
      path: window.location.pathname + window.location.search,
      referrer: document.referrer || null,
      session_id: _sid(),
      visitor_id: _vid(),
      ...extra,
    });
    // Prefer `fetch(keepalive: true)` so it survives during page transitions.
    fetch(`${API}/api/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch { /* swallow — analytics must never break the app */ }
}

export default trackEvent;
