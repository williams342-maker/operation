/**
 * iter413ce — TikTok Pixel event helper.
 *
 * The pixel itself is loaded by the inline snippet in `public/index.html`
 * (sdkid `D8UP6SJC77UCR7H8US60`). This module exposes a thin `tiktokTrack()`
 * wrapper that mirrors how `trackConversion()` works for Google Ads — every
 * funnel surface fires through one place so the event taxonomy stays
 * consistent and we can swap pixels later without hunting through call sites.
 *
 * TikTok's "Standard Events" reference:
 *   https://business-api.tiktok.com/portal/docs?id=1771101027431425
 *
 * Mapping from our internal action names → TikTok standard events:
 *   purchase            → CompletePayment    (value + currency + transaction_id)
 *   add_to_cart         → AddToCart          (value + currency + content_id + content_name)
 *   signup_buyer        → CompleteRegistration
 *   signup_maker        → CompleteRegistration  (with content_name='maker_application')
 *   lead_custom_order   → SubmitForm
 *   lead_contact        → Contact
 *
 * Safe to call before the pixel SDK finishes loading — the snippet
 * installs a queue stub that buffers events until the SDK arrives.
 */

const EVENT_MAP = {
  purchase: "CompletePayment",
  add_to_cart: "AddToCart",
  signup_buyer: "CompleteRegistration",
  signup_maker: "CompleteRegistration",
  lead_custom_order: "SubmitForm",
  lead_contact: "Contact",
};

export function tiktokTrack(action, params = {}) {
  const evt = EVENT_MAP[action];
  if (!evt) return;
  try {
    if (typeof window !== "undefined" && window.ttq?.track) {
      // iter413bk — `event_id` (our caller's vocab) is the dedup key
      // shared with Meta CAPI and Google Ads. TikTok accepts it under
      // `event_id` directly, used to dedupe with Events API (server-side).
      const { event_id, value, currency, transaction_id, content_id, content_name, ...rest } = params;
      const payload = {};
      if (value != null) payload.value = Number(value);
      if (currency) payload.currency = currency;
      if (transaction_id) payload.transaction_id = transaction_id;
      if (content_id) payload.content_id = String(content_id);
      if (content_name) payload.content_name = String(content_name);
      // Pass any extras (event_label etc.) through untouched.
      Object.assign(payload, rest);
      const opts = event_id ? { event_id: String(event_id) } : undefined;
      window.ttq.track(evt, payload, opts);
    }
  } catch { /* never block UX */ }
}
