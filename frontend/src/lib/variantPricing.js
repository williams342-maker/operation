/**
 * iter334r — Variant pricing helpers.
 *
 * Single source of truth for "what does this product cost on the shop
 * card / search result / cart line?" so the badge displays match what
 * the buyer actually pays at checkout.
 *
 * Two modes:
 *   • Variants have absolute `price`  → use that
 *   • Legacy variants only have       → base + price_delta
 *     `price_delta`
 *
 * When the base price is 0 and variants exist with their own prices,
 * `formatPriceDisplay()` returns a range string ("$23 – $32") instead
 * of "$0" so cards never look broken.
 */

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

/** Display string for shop cards. Returns "$23 – $32" when the listing's
 *  base price is 0 and variants disagree, otherwise a single "$N". */
export function formatPriceDisplay(product) {
  const [min, max] = listingPriceRange(product);
  if (max <= 0) return "—";
  if (min === max || (Number(product?.price || 0) > 0)) {
    return `$${Math.round(Number(product?.price || max))}`;
  }
  return `$${Math.round(min)} – $${Math.round(max)}`;
}
