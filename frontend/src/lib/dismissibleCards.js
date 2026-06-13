/**
 * iter413l — Dashboard-card dismiss registry.
 *
 * The maker dashboard surfaces a handful of upsell / onboarding cards
 * (Crafters Plus nudge, Refer-a-maker progress, etc). Power users
 * eventually want to silence them. Each card writes a per-key
 * localStorage flag here; Settings → Options surfaces a "Restore
 * dismissed cards" button that clears them.
 *
 * Keep all keys + labels in this one file so:
 *   • each card and the Settings restore-button stay in sync
 *   • a glance at this file lists every dismissible surface
 *   • test code can iterate the registry instead of hardcoding keys
 */

export const DISMISSIBLE_CARDS = [
  {
    key: "cm_dismiss_dashboard_plus_nudge",
    label: "Crafters Plus upgrade nudge",
  },
  {
    key: "cm_dismiss_dashboard_referral_card",
    label: "Refer-a-maker progress card",
  },
];

// iter413m — GA4 event surface for the upsell-card lifecycle. Both
// helpers fire `card_dismissed` / `cards_restored` events so admins
// can build a "card fatigue" report in GA4 (e.g. % of viewers who
// dismissed the Plus nudge within 7d). Wrapped in try/catch because
// gtag is loaded async and may not exist at call-time on cold loads.
function _trackGA(eventName, params) {
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", eventName, params);
    }
  } catch { /* gtag is best-effort — never block the UX */ }
}

function _labelFor(key) {
  const found = DISMISSIBLE_CARDS.find((c) => c.key === key);
  return found ? found.label : key;
}

export function isDismissed(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    // Private-browsing mode — treat as not dismissed.
    return false;
  }
}

export function dismiss(key) {
  try { localStorage.setItem(key, "1"); } catch { /* private mode */ }
  _trackGA("card_dismissed", {
    card_key: key,
    card_label: _labelFor(key),
    surface: "maker_dashboard",
  });
}

/** Clear every registered dismiss flag. Returns the count that were
 *  actually set so the caller can decide whether to show a toast. */
export function restoreAllDismissed() {
  let cleared = 0;
  const restoredKeys = [];
  for (const { key } of DISMISSIBLE_CARDS) {
    try {
      if (localStorage.getItem(key) === "1") {
        localStorage.removeItem(key);
        restoredKeys.push(key);
        cleared += 1;
      }
    } catch { /* private mode */ }
  }
  if (cleared > 0) {
    _trackGA("cards_restored", {
      count: cleared,
      // GA4 caps custom-dimension cardinality, so we send a comma-joined
      // string of restored keys rather than an array — easy to split in
      // BigQuery exports if you want per-card restore rates later.
      restored_keys: restoredKeys.join(","),
      surface: "maker_settings",
    });
  }
  return cleared;
}

/** Count currently-dismissed cards. Used by the Settings button to
 *  show "Restore (2)" vs "Restore" and disable when none. */
export function countDismissed() {
  let n = 0;
  for (const { key } of DISMISSIBLE_CARDS) {
    if (isDismissed(key)) n += 1;
  }
  return n;
}
