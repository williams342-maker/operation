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

/** Count the total number of recorded tap events across ALL tabs.
 *  Used by the Settings → Options "Clear admin tab frecency" panel
 *  to display a counter (e.g. "Clear (42 taps)") and to disable the
 *  button when nothing is stored. */
export function countTotalEvents() {
  const data = loadRaw();
  let n = 0;
  for (const events of Object.values(data)) {
    if (Array.isArray(events)) n += events.length;
  }
  return n;
}

// ── Pinned tabs (iter413v) ────────────────────────────────────────────
// Manual pinning is orthogonal to frecency: pins surface tabs the admin
// WANTS at the top regardless of usage (e.g. Audit Log — scanned often,
// rarely clicked). Stored as an ordered list of tab IDs in a separate
// key so clearing one doesn't clobber the other.

const PINS_KEY = "cm_admin_tab_pins_v1";

function loadPins() {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}
function savePins(arr) {
  try { localStorage.setItem(PINS_KEY, JSON.stringify(arr)); }
  catch { /* private mode */ }
}

export function getPinnedIds() { return loadPins(); }
export function isPinned(id) { return loadPins().includes(id); }
export function countPins() { return loadPins().length; }

/** Toggle pin state. Newly pinned IDs append at the END so existing
 *  pin order is preserved (predictability beats "pop-to-top"). Fires
 *  GA4 `tab_pinned` / `tab_unpinned` events (iter413y) so admins can
 *  build a cohort report on which secondary tabs power-users pin —
 *  signal for which surfaces deserve promotion into the bottom-bar
 *  quick-actions. */
export function togglePin(id) {
  const pins = loadPins();
  const idx = pins.indexOf(id);
  if (idx >= 0) pins.splice(idx, 1);
  else pins.push(id);
  savePins(pins);
  const pinned = pins.includes(id);
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", pinned ? "tab_pinned" : "tab_unpinned", {
        tab_id: id,
        pinned_count: pins.length,
        surface: "admin_mobile_tab_sheet",
      });
    }
  } catch { /* gtag is best-effort — never block the UX */ }
  return pinned;
}

export function clearPins() {
  try { localStorage.removeItem(PINS_KEY); }
  catch { /* ignore */ }
}

/** Partition + sort: returns { pinned, others } where `pinned` is in
 *  pin-order (the order the admin pinned them, stable across sessions)
 *  and `others` is frecency-sorted. */
export function partitionByPins(tabs) {
  if (!Array.isArray(tabs)) return { pinned: [], others: [] };
  const pinIds = loadPins();
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const pinned = pinIds.map((id) => byId.get(id)).filter(Boolean);
  const pinnedSet = new Set(pinIds);
  const others = sortByFrecency(tabs.filter((t) => !pinnedSet.has(t.id)));
  return { pinned, others };
}
