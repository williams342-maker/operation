import { http } from "./api";

const VIS_KEY = "cm_visitor_id";
const SES_KEY = "cm_session_id";
const SES_LAST = "cm_session_last";
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
  if (path.startsWith("/admin") || path.startsWith("/maker/")) return;

  try {
    http.post("/analytics/track", {
      path,
      referer: document.referrer || "",
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      title: (document.title || "").slice(0, 200),
    }).catch(() => {});
  } catch {
    // swallow
  }
}
