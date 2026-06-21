/**
 * iter413bk — Single shared event_id per conversion fire.
 *
 * When a single user action (e.g. submitting the maker application)
 * fans out to multiple ad networks (Google Ads + Bing UET + Meta Pixel),
 * each network should receive the SAME deduplication id so:
 *
 *   • Meta Conversions API (server-side) can dedup against the browser
 *     Pixel fire later — same eventID across both = single attributed
 *     conversion, not two.
 *   • Google Ads counts only one purchase even if gtag fires twice
 *     (browser + future server-side enhanced conversions).
 *   • Bing UET dedupes when the offline-conversions CSV is uploaded.
 *
 * Usage at the call site:
 *
 *   const eventId = mintEventId();
 *   trackConversion("signup_maker", { event_id: eventId, event_label: "founding_access" });
 *   uetTrack       ("submit_lead",  { event_id: eventId, event_label: "founding_access" });
 *   trackMeta      ("signup_maker", { event_id: eventId, event_label: "founding_access" });
 *
 * The three wrappers each read `event_id` from params and forward it
 * to the network-native field name (transaction_id / event_id / eventID).
 */

export function mintEventId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    try { return crypto.randomUUID(); } catch { /* fall through */ }
  }
  return `cm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
