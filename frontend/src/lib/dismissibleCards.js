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
}

/** Clear every registered dismiss flag. Returns the count that were
 *  actually set so the caller can decide whether to show a toast. */
export function restoreAllDismissed() {
  let cleared = 0;
  for (const { key } of DISMISSIBLE_CARDS) {
    try {
      if (localStorage.getItem(key) === "1") {
        localStorage.removeItem(key);
        cleared += 1;
      }
    } catch { /* private mode */ }
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
