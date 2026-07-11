/**
 * iter452 — First-party storefront event pipeline (client side).
 *
 * SEPARATE from GA4 / ad pixels. Powers the maker's Store Analytics
 * dashboard only. Every event is tagged with a consent `category`
 * (currently "analytics") so events can be reclassified to a future
 * "functional" category without rewriting the pipeline. Sending is
 * gated on the visitor's Analytics consent choice.
 */
import { readConsent } from "./consent";
import { API } from "./api";

const CATEGORY = "analytics";
const CTX_KEY = "cm_se_ctx";
let queue = [];
let timer = null;

const allowed = () => readConsent()?.analytics_storage === "granted";

function sid() {
  try {
    let v = sessionStorage.getItem("cm_se_sid");
    if (!v) {
      v = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("cm_se_sid", v);
    }
    return v;
  } catch { return null; }
}

function vid() {
  try {
    let v = localStorage.getItem("cm_se_vid");
    if (!v) {
      v = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("cm_se_vid", v);
    }
    return v;
  } catch { return null; }
}

function flush() {
  clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const events = queue.splice(0, 20);
  const body = JSON.stringify({ events });
  try {
    const ok = navigator.sendBeacon?.(
      `${API}/store-events`, new Blob([body], { type: "application/json" }));
    if (!ok) {
      fetch(`${API}/store-events`, {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json" }, body,
      }).catch(() => {});
    }
  } catch { /* tracking must never break the app */ }
  if (queue.length) timer = setTimeout(flush, 500);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/** Queue a first-party store event. No-op unless Analytics consent granted. */
export function trackStoreEvent(type, data = {}) {
  if (!allowed()) return;
  queue.push({ type, category: CATEGORY, session_id: sid(), visitor_id: vid(), ...data });
  if (queue.length >= 10) flush();
  else if (!timer) timer = setTimeout(flush, 4000);
}

/** Remember the storefront browsing context (maker + section) so the PDP
 * add-to-cart event can be attributed to the section it came from. */
export function setStoreContext(makerSlug, sectionSlug) {
  try {
    sessionStorage.setItem(CTX_KEY, JSON.stringify({
      maker_slug: makerSlug, section_slug: sectionSlug || null, at: Date.now(),
    }));
  } catch { /* noop */ }
}

export function getStoreContext(makerSlug) {
  try {
    const c = JSON.parse(sessionStorage.getItem(CTX_KEY));
    if (c && c.maker_slug === makerSlug && Date.now() - c.at < 30 * 60 * 1000) return c;
  } catch { /* noop */ }
  return null;
}
