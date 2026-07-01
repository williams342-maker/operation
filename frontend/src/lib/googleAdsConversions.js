/**
 * iter413ab — Google Ads conversion event firing.
 *
 * Centralized helper so every funnel surface fires conversions through
 * the same gtag wrapper. When you create a conversion action in
 * Google Ads → Tools → Measurement → Conversions, Google issues a
 * unique label per action — paste each one into the CONVERSION_LABELS
 * map below.
 *
 * Until labels are filled in, `trackConversion()` is a no-op (logs to
 * console in dev so you can see when a conversion WOULD have fired).
 *
 * Usage:
 *   import { trackConversion } from "@/lib/googleAdsConversions";
 *   trackConversion("purchase", { value: 89.50, currency: "USD",
 *                                  transaction_id: order.id });
 */

const AW_ID = "AW-18195416932";

// Fill these in with the conversion labels issued by Google Ads.
// Format: 'AbCd_-EfGh1234' (the part after the slash in
// "AW-18195416932/AbCd_-EfGh1234"). Leave empty string to keep the
// event a no-op until you have the label.
//
// iter413dp — BLOCKED on user retrieving labels from Google Ads.
// The three explicit placeholders below map to the funnel events
// the marketing team asked for:
//   - GOOGLE_ADS_CONVERSION_LABEL_SIGNUP      → "signup_buyer"
//   - GOOGLE_ADS_CONVERSION_LABEL_APPLICATION → "signup_maker"
//   - GOOGLE_ADS_CONVERSION_LABEL_PURCHASE    → "purchase"
// When labels arrive, paste each string into the matching slot.
const GOOGLE_ADS_CONVERSION_LABEL_SIGNUP      = "";  // pending
const GOOGLE_ADS_CONVERSION_LABEL_APPLICATION = "";  // pending
const GOOGLE_ADS_CONVERSION_LABEL_PURCHASE    = "";  // pending

const CONVERSION_LABELS = {
  purchase:           GOOGLE_ADS_CONVERSION_LABEL_PURCHASE,       // CheckoutSuccess (on paid)
  signup_buyer:       GOOGLE_ADS_CONVERSION_LABEL_SIGNUP,         // Community/buyer registration completion
  signup_maker:       GOOGLE_ADS_CONVERSION_LABEL_APPLICATION,    // Maker application submitted
  add_to_cart:        "",   // PDP add-to-cart click (secondary)
  lead_custom_order:  "",   // Custom-order request submitted (secondary)
  lead_contact:       "",   // Public contact-form submission (secondary)
};

export function trackConversion(action, params = {}) {
  const label = CONVERSION_LABELS[action];
  if (!label) {
    // Dev-only signal so future engineers see what fired before labels were wired.
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.info(`[gads] conversion '${action}' fired pre-label — params:`, params);
    }
    return;
  }
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      // iter413bk — `event_id` (our caller's vocab) maps to gtag's
      // `transaction_id` field, which gtag dedupes on. Strip the
      // alias so we don't ship a duplicate key.
      const { event_id, ...rest } = params;
      window.gtag("event", "conversion", {
        send_to: `${AW_ID}/${label}`,
        ...(event_id ? { transaction_id: event_id } : {}),
        ...rest,
      });
    }
  } catch { /* gtag best-effort — never block the UX */ }
}

/** Lookup whether a given conversion action has a label wired. Useful
 *  for the admin "Conversion Coverage" report (future) — shows which
 *  funnel steps are still missing tracking. */
export function listConversionStatus() {
  return Object.entries(CONVERSION_LABELS).map(([action, label]) => ({
    action,
    wired: !!label,
    // Redacted preview so the admin UI can confirm visually that the
    // pasted value isn't a typo, without leaking the whole label (it's
    // not secret, but a tidy first/last 3 chars is enough for sanity).
    label_preview: label
      ? (label.length <= 6 ? label : `${label.slice(0, 3)}…${label.slice(-3)}`)
      : "",
  }));
}
