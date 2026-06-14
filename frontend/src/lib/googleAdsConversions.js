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

const AW_ID = "AW-11257134570";

// Fill these in with the conversion labels issued by Google Ads.
// Format: 'AbCd_-EfGh1234' (the part after the slash in
// "AW-11257134570/AbCd_-EfGh1234"). Leave empty string to keep the
// event a no-op until you have the label.
const CONVERSION_LABELS = {
  purchase:           "",   // CheckoutSuccess (on paid)
  signup_buyer:       "",   // Community/buyer registration completion
  signup_maker:       "",   // Maker application submitted
  add_to_cart:        "",   // PDP add-to-cart click
  lead_custom_order:  "",   // Custom-order request submitted
  lead_contact:       "",   // Public contact-form submission
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
      window.gtag("event", "conversion", {
        send_to: `${AW_ID}/${label}`,
        ...params,
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
  }));
}
