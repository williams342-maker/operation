/**
 * iter413bj — Meta Pixel (Facebook / Instagram) conversion firing.
 *
 * Mirrors `googleAdsConversions.js` shape so every funnel surface fires
 * Meta events through the same wrapper. Until `PIXEL_ID` is filled in,
 * `trackMeta()` is a no-op (logs to console in dev so engineers see
 * what WOULD have fired).
 *
 * Usage:
 *   import { trackMeta } from "@/lib/metaPixel";
 *   trackMeta("Lead", { event_label: "founding_access" });
 *
 * The pixel itself bootstraps lazily on the FIRST `trackMeta` call so
 * we don't load the SDK on every page view. Once loaded it stays for
 * the rest of the session.
 *
 * Standard Meta events used here (case-sensitive — Meta requires these):
 *   PageView · Lead · Purchase · AddToCart · InitiateCheckout · ViewContent · Contact
 */

// PASTE your Meta Pixel ID here (Meta Events Manager → your pixel →
// Settings → Pixel ID). Leave empty to keep the helper a no-op.
const PIXEL_ID = "";

// Map of our internal funnel-action keys to the Meta-standard event
// name they should fire. Keeps call-sites consistent with the Google
// Ads helper (action keys are the same vocabulary across both).
const META_EVENT_FOR_ACTION = {
  purchase:           "Purchase",
  signup_buyer:       "CompleteRegistration",
  signup_maker:       "Lead",
  add_to_cart:        "AddToCart",
  lead_custom_order:  "Lead",
  lead_contact:       "Contact",
  begin_checkout:     "InitiateCheckout",
  view_content:       "ViewContent",
};

let pixelLoaded = false;

function ensurePixel() {
  if (pixelLoaded || !PIXEL_ID) return pixelLoaded;
  if (typeof window === "undefined") return false;
  // Standard Meta Pixel snippet — see https://developers.facebook.com/docs/meta-pixel
  // Inlined so we don't ship an external script tag on pages that
  // never fire a conversion (every page already runs gtag).
  if (!window.fbq) {
    // eslint-disable-next-line
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,"script","https://connect.facebook.net/en_US/fbevents.js");
  }
  try {
    window.fbq("init", PIXEL_ID);
    window.fbq("track", "PageView");
    pixelLoaded = true;
  } catch { /* never block UX on analytics */ }
  return pixelLoaded;
}

/**
 * Fire a Meta Pixel conversion.
 *
 * @param {string} action  — one of our internal action keys (see
 *                            META_EVENT_FOR_ACTION) OR a Meta-standard
 *                            event name passed through verbatim.
 * @param {object} params  — optional event params: value, currency,
 *                            content_ids, event_label, etc.
 */
export function trackMeta(action, params = {}) {
  if (!PIXEL_ID) {
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.info(`[meta] pixel '${action}' fired pre-config — params:`, params);
    }
    return;
  }
  if (!ensurePixel()) return;
  const evt = META_EVENT_FOR_ACTION[action] || action;
  try {
    // iter413bk — Map our caller-side `event_id` vocabulary onto Meta
    // Pixel's `eventID` field (case-sensitive, exact key Meta uses for
    // browser ↔ Conversions API server-side deduplication).
    const { event_id, ...rest } = params;
    const eventID = event_id;
    if (eventID) {
      window.fbq("track", evt, rest, { eventID });
    } else {
      window.fbq("track", evt, rest);
    }
  } catch { /* best-effort */ }
}

/** Coverage report for the admin "Meta Pixel Coverage" diag card.
 *  Returns one row per known action so the admin sees at-a-glance
 *  whether the pixel is live. */
export function listMetaPixelStatus() {
  const wired = !!PIXEL_ID;
  return {
    pixel_id_wired: wired,
    pixel_id_preview: wired
      ? (PIXEL_ID.length <= 6 ? PIXEL_ID : `${PIXEL_ID.slice(0, 3)}…${PIXEL_ID.slice(-3)}`)
      : "",
    pixel_loaded: pixelLoaded,
    actions: Object.entries(META_EVENT_FOR_ACTION).map(([action, meta_event]) => ({
      action,
      meta_event,
      wired,
    })),
  };
}
