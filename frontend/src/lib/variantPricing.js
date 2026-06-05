/**
 * iter334r — Variant pricing helpers.
 * iter334s — A/B test: "From $X" vs "$X – $Y" headline framing.
 *
 * Single source of truth for "what does this product cost on the shop
 * card / search result / cart line?" so the badge displays match what
 * the buyer actually pays at checkout.
 *
 * A/B test (iter334s)
 * -------------------
 * When the listing has variants with disparate prices AND base price = 0,
 * each session is bucketed 50/50 into "from" or "range". The card
 * renders "From $23" or "$23 – $32" accordingly. Bucket is sticky for
 * the session (localStorage key `ab_pricing_label`) so a visitor doesn't
 * see the framing change mid-browse.
 *
 * Exposure + click events flow to GA4 (`window.gtag`) and Microsoft Ads
 * UET (`window.uetq`) so we can measure CTR per variant in Bing/GA.
 * Exposure fires once per session, gated on consent (lib/consent.js).
 */

const AB_STORAGE_KEY = "ab_pricing_label";
const AB_VARIANTS = ["from", "range"];

/** Pick and cache a sticky variant ('from' | 'range') for this session.
 *  Falls back to 'from' when running outside a browser (SSR/test). */
export function getPricingLabelVariant() {
  if (typeof window === "undefined" || !window.localStorage) return "from";
  try {
    let v = window.localStorage.getItem(AB_STORAGE_KEY);
    if (!AB_VARIANTS.includes(v)) {
      v = AB_VARIANTS[Math.floor(Math.random() * AB_VARIANTS.length)];
      window.localStorage.setItem(AB_STORAGE_KEY, v);
    }
    return v;
  } catch {
    return "from";
  }
}

/** Fire the impression event ONCE per session to GA4 + UET.
 *  Idempotent — repeat calls are a no-op. */
let _exposureFired = false;
export function trackPricingLabelExposure() {
  if (_exposureFired) return;
  if (typeof window === "undefined") return;
  _exposureFired = true;
  const variant = getPricingLabelVariant();
  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", "experiment_view", {
        experiment_id: "pricing_label",
        variant_id: variant,
      });
      // Also set as a user_property so every downstream GA4 event is
      // segmentable by variant without extra plumbing.
      window.gtag("set", "user_properties", { ab_pricing_label: variant });
    }
    if (window.uetq && typeof window.uetq.push === "function") {
      window.uetq.push("event", "ab_pricing_label_view", {
        event_category: "experiment",
        event_label: variant,
      });
    }
  } catch { /* noop */ }
}

/** Fire when a buyer clicks through on a card showing the experiment
 *  framing. Idempotent per (variant, slug) pair so a flickering hover
 *  doesn't over-count. */
const _clickFired = new Set();
export function trackPricingLabelClick(slug) {
  if (typeof window === "undefined") return;
  const variant = getPricingLabelVariant();
  const key = `${variant}|${slug}`;
  if (_clickFired.has(key)) return;
  _clickFired.add(key);
  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", "ab_pricing_label_click", {
        experiment_id: "pricing_label",
        variant_id: variant,
        slug,
      });
    }
    if (window.uetq && typeof window.uetq.push === "function") {
      window.uetq.push("event", "ab_pricing_label_click", {
        event_category: "experiment",
        event_label: variant,
        event_value: slug,
      });
    }
    // Also POST to our backend so admin tooling has a 1st-party tally
    // independent of GA4 sampling and UET aggregation lag.
    const base = process.env.REACT_APP_BACKEND_URL;
    if (base) {
      fetch(`${base}/api/experiments/pricing-label/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "click", variant, slug }),
        keepalive: true,
      }).catch(() => {});
    }
  } catch { /* noop */ }
}

/** Compute effective unit price for a single (product, variant) pair. */
export function effectiveVariantPrice(basePrice, variant) {
  if (!variant) return Number(basePrice || 0);
  if (Number(variant.price) > 0) return Number(variant.price);
  return Number(basePrice || 0) + Number(variant.price_delta || 0);
}

/** Return (min, max) effective prices across a product's variants.
 *  Falls back to (base, base) when no variants exist. */
export function listingPriceRange(product) {
  const base = Number(product?.price || 0);
  const variants = product?.variants || [];
  if (!variants.length) return [base, base];
  const prices = variants
    .map((v) => effectiveVariantPrice(base, v))
    .filter((p) => p > 0);
  if (!prices.length) return [base, base];
  return [Math.min(...prices), Math.max(...prices)];
}

/** Display string for shop cards.
 *  - Base price set → use it (e.g. `"$45"`)
 *  - Base price 0, variants with distinct prices → bucketed by A/B test
 *    into `"From $23"` OR `"$23 – $32"`
 *  - All variants priced the same → single price (e.g. `"$32"`)
 *  - Nothing priced → `"—"`
 */
export function formatPriceDisplay(product) {
  const base = Number(product?.price || 0);
  const [min, max] = listingPriceRange(product);
  if (max <= 0) return "—";
  if (base > 0) return `$${Math.round(base)}`;
  if (min === max) return `$${Math.round(min)}`;
  // ── A/B branch (iter334s) ─────────────────────────────────────────
  trackPricingLabelExposure();
  return getPricingLabelVariant() === "range"
    ? `$${Math.round(min)} – $${Math.round(max)}`
    : `From $${Math.round(min)}`;
}
