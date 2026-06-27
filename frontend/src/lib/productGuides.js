// iter413cp — Configurable Product Guides registry.
//
// Loretta Alvarado's seller feedback (Fiber Arts founder): the Outdoor
// Mounting Guide was appearing on indoor fiber artwork because the old
// `pickGuideForProduct()` logic relied on keyword matching ("garden",
// "outdoor", etc.) without checking category eligibility. A piece
// described as "perfect gift for a garden lover" would incorrectly
// surface the outdoor-mounting guide on an indoor textile listing.
//
// New model:
//   • Each guide declares the categories it APPLIES to and the
//     categories it's EXCLUDED from.
//   • Eligibility is a hard gate — even if keywords match, an excluded
//     category never shows the guide.
//   • Designed to be admin-editable later: this static config can be
//     replaced with a Mongo-backed source under the same shape without
//     changing call sites that go through `pickGuidesForProduct()`.
//
// Storage contract: guides themselves still live in `pages/guideConfig.js`
// (the long-form content + SEO meta). This module is purely the
// eligibility / matching layer.

const _hasAnyKeyword = (haystack, needles) => {
  const h = (haystack || "").toLowerCase();
  return needles.some((n) => h.includes(n));
};

// Registry: ordered by priority (most-specific wins). Each entry:
//   slug          → /guides/<slug> URL
//   title, blurb  → card copy
//   categories    → list of CATEGORIES that may surface this guide
//                   (empty array = surface for any category)
//   excludeCategories → hard-block list — never surface here even if
//                       a keyword would otherwise match
//   keywords      → keywords that further narrow within `categories`
//                   (empty = surface for the whole category)
//   requiresKeywords → when true, BOTH category match AND keyword
//                      match are required (default false = category
//                      alone is enough).
export const PRODUCT_GUIDES = [
  {
    slug: "metal-gauge-finish-guide",
    title: "Metal Gauge & Finish Guide",
    blurb: "Pick the right gauge and finish to handle your climate.",
    categories: ["Outdoor Art", "Custom Signs", "Business Signage", "Address Numbers", "Garden & Yard Art", "Wall Art", "Memorial & Tribute", "Sculpture"],
    excludeCategories: ["Fiber & Textiles", "Pottery & Ceramics", "Paper Crafts", "Leather Goods", "Jewelry & Wearables", "Mixed Media"],
    keywords: ["steel", "metal", "aluminum", "copper", "brass", "iron"],
    requiresKeywords: true,
  },
  {
    slug: "outdoor-mounting-guide",
    title: "Outdoor Mounting Guide",
    blurb: "Anchor, seal, and weatherproof your piece so it lasts.",
    // iter413cp — Loretta's fix. Outdoor mounting is ONLY relevant to
    // pieces that genuinely go outside. Hard-exclude fiber, paper,
    // pottery (frost-sensitive), jewelry, etc.
    categories: ["Outdoor Art", "Garden & Yard Art", "Address Numbers", "Custom Signs", "Business Signage", "Memorial & Tribute", "Sculpture"],
    excludeCategories: [
      "Fiber & Textiles", "Wall Art", "Paper Crafts", "Mixed Media",
      "Pottery & Ceramics", "Jewelry & Wearables", "Leather Goods",
      "Wedding Gifts", "Kitchen & Bar", "Furniture", "Lighting & Lamps",
      "Glass", "Holiday & Seasonal", "Home Decor", "Other",
    ],
    keywords: ["outdoor", "weatherproof", "garden", "yard", "exterior", "mailbox"],
    requiresKeywords: false,  // category alone is enough
  },
  {
    slug: "plasma-vs-laser-vs-router",
    title: "Plasma vs Laser vs Router",
    blurb: "Why this technique for this piece — and when each one wins.",
    categories: ["Wall Art", "Custom Signs", "Business Signage", "Address Numbers", "Outdoor Art", "Garden & Yard Art", "Memorial & Tribute"],
    excludeCategories: [],
    keywords: ["plasma", "laser", "router", "cnc", "laser cutting", "laser engraving"],
    requiresKeywords: true,
  },

  // ── Future guide stubs (Loretta's framework expansion) ────────────
  // These slugs will resolve to the long-form pages once they're
  // authored in pages/guideConfig.js. Until then the eligibility
  // matchers are live so we surface the cards as soon as the content
  // lands. Comment them out in the meantime to avoid 404 confusion.
  //
  // { slug: "indoor-care-guide",        title: "Indoor Care Guide",        ... categories: ["Wall Art","Home Decor","Fiber & Textiles","Paper Crafts","Mixed Media"] }
  // { slug: "cleaning-instructions",    title: "Cleaning Instructions",    ... categories: ["Pottery & Ceramics","Kitchen & Bar","Glass","Leather Goods","Fiber & Textiles"] }
  // { slug: "assembly-required",        title: "Assembly Required",        ... requiresKeywords: true, keywords: ["assembly","kit","unassembled"] }
  // { slug: "gift-information",         title: "Gift Information",         ... categories: ["Wedding Gifts","Memorial & Tribute","Holiday & Seasonal","Jewelry & Wearables"] }
  // { slug: "food-safe-guide",          title: "Food Safe Guide",          ... categories: ["Pottery & Ceramics","Kitchen & Bar","Woodworking"] requiresKeywords: true, keywords: ["food safe","cutting board","plate","mug","bowl"] }
  // { slug: "care-instructions",        title: "Care Instructions",        ... categories: ["Fiber & Textiles","Leather Goods","Jewelry & Wearables","Pottery & Ceramics"] }
];

/**
 * Returns the single best guide for a product (highest-priority match)
 * or null. The legacy `pickGuideForProduct()` shape is preserved so
 * existing call sites in `GuideCrossLinkCard.jsx` keep working.
 */
export function pickGuideForProduct(product) {
  if (!product) return null;
  const cat = product.category || "";
  const haystack = [
    cat,
    product.title || "",
    product.description || "",
    (product.tags || []).join(" "),
    product.technique || "",
  ].join(" ");

  for (const g of PRODUCT_GUIDES) {
    // Hard exclusion check first — never surface for a forbidden category.
    if (g.excludeCategories?.includes(cat)) continue;
    // Category gate: must be in the allow-list (or allow-list empty).
    const categoryAllowed = !g.categories?.length || g.categories.includes(cat);
    if (!categoryAllowed) continue;
    // Keyword gate: required vs optional.
    if (g.requiresKeywords) {
      if (!g.keywords?.length || !_hasAnyKeyword(haystack, g.keywords)) continue;
    }
    return { slug: g.slug, title: g.title, blurb: g.blurb };
  }
  return null;
}

/**
 * Returns ALL matching guides for a product (used by future multi-guide
 * surfaces; for now the PDP card consumes only `pickGuideForProduct()`).
 */
export function pickGuidesForProduct(product) {
  if (!product) return [];
  const cat = product.category || "";
  const haystack = [
    cat,
    product.title || "",
    product.description || "",
    (product.tags || []).join(" "),
    product.technique || "",
  ].join(" ");
  const out = [];
  for (const g of PRODUCT_GUIDES) {
    if (g.excludeCategories?.includes(cat)) continue;
    const categoryAllowed = !g.categories?.length || g.categories.includes(cat);
    if (!categoryAllowed) continue;
    if (g.requiresKeywords) {
      if (!g.keywords?.length || !_hasAnyKeyword(haystack, g.keywords)) continue;
    }
    out.push({ slug: g.slug, title: g.title, blurb: g.blurb });
  }
  return out;
}
