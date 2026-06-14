/**
 * iter413t — Frecency tracker for admin mobile tab sheet ordering.
 *
 * Stores per-tab usage events in localStorage and scores each tab by
 * a recency × frequency formula so the slide-up sheet on
 * /admin/dashboard (mobile) surfaces the admin's most-used tabs at
 * the top. Falls back gracefully when:
 *   • localStorage is unavailable (private browsing → empty scores)
 *   • Stored data is malformed (corrupt JSON → reset)
 *   • Entries are too old (>30d → pruned on read)
 *
 * Scoring matches the Mozilla Places-style frecency formula at low
 * scale: each tap contributes `weight(age_days)`; weight halves every
 * 7d. We cap the per-tab event count at 50 so a hot tab doesn't bloat
 * localStorage indefinitely.
 */

const STORAGE_KEY = "cm_admin_tab_frecency_v1";
const MAX_EVENTS_PER_TAB = 50;
const MAX_AGE_DAYS = 30;

/** Half-life weighted score. 0d=1.0, 7d=0.5, 14d=0.25, 30d≈0.05. */
function weightForAgeDays(ageDays) {
  if (ageDays < 0) return 0;
  return Math.pow(0.5, ageDays / 7);
}

/** Load + auto-prune the raw event store. Returns { [tabId]: number[] }
 *  where each number is a unix-ms timestamp of a tap event. */
function loadRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const cutoff = Date.now() - MAX_AGE_DAYS * 86400 * 1000;
    const out = {};
    for (const [id, events] of Object.entries(parsed)) {
      if (!Array.isArray(events)) continue;
      const fresh = events.filter((t) => typeof t === "number" && t >= cutoff);
      if (fresh.length > 0) out[id] = fresh;
    }
    return out;
  } catch {
    return {};
  }
}

function saveRaw(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch { /* private mode — silently drop */ }
}

/** Record a tap on `tabId`. Capped at MAX_EVENTS_PER_TAB to keep the
 *  store bounded — old timestamps roll off via the cutoff in loadRaw. */
export function recordTabPick(tabId) {
  if (!tabId) return;
  const data = loadRaw();
  const events = data[tabId] || [];
  events.push(Date.now());
  // Keep the most-recent MAX_EVENTS_PER_TAB entries.
  if (events.length > MAX_EVENTS_PER_TAB) {
    events.splice(0, events.length - MAX_EVENTS_PER_TAB);
  }
  data[tabId] = events;
  saveRaw(data);
}

/** Return a Map<tabId, score>. Tabs with no events are absent.
 *  Score is the SUM of weighted ages — higher = more "frecent". */
export function getFrecencyScores() {
  const data = loadRaw();
  const now = Date.now();
  const out = new Map();
  for (const [id, events] of Object.entries(data)) {
    let score = 0;
    for (const t of events) {
      score += weightForAgeDays((now - t) / 86400000);
    }
    if (score > 0) out.set(id, score);
  }
  return out;
}

/** Sort an array of tab objects (each has at least `id`) so frecent
 *  tabs lead. Stable sort preserves declared order among tabs with
 *  equal scores (e.g. all the unused tabs). Returns a NEW array. */
export function sortByFrecency(tabs) {
  if (!Array.isArray(tabs) || tabs.length <= 1) return tabs;
  const scores = getFrecencyScores();
  // Decorate-sort-undecorate so the underlying sort is stable across
  // browsers (Array.prototype.sort is spec-stable since ES2019, but
  // the decorator pattern makes ties explicit + readable).
  return tabs
    .map((tab, originalIdx) => ({
      tab,
      originalIdx,
      score: scores.get(tab.id) || 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.originalIdx - b.originalIdx;
    })
    .map((x) => x.tab);
}

/** Clear all stored frecency data. Surfaced via Settings → Options
 *  (future) so an admin can reset to declaration order. */
export function clearFrecency() {
  try { localStorage.removeItem(STORAGE_KEY); }
  catch { /* ignore */ }
}
