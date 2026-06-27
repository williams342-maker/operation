// iter413co — Category-aware Technique taxonomy.
//
// Loretta Alvarado's seller feedback (Fiber Arts founder): the Technique
// dropdown was CNC-only (PLASMA / LASER / ROUTER / FORGE / CUSTOM),
// which makes no sense for Fiber, Pottery, Leather, Jewelry, Glass,
// Paper, Mixed Media, etc. This module replaces that single-list with
// a category-aware lookup so each maker sees techniques relevant to
// their craft. "Custom" was also renamed to "Other" — "Custom" implied
// made-to-order products, "Other" correctly communicates "my technique
// isn't in this list."
//
// Storage contract: `Product.technique` is a free-form string in the
// backend (models.py). Adding/removing keys is non-breaking — historical
// listings keep working. Filters (`/shop?technique=X`) treat the value
// as a substring/prefix match, so older PLASMA/LASER/etc. URLs still
// resolve.
//
// Maintenance: when adding a new entry to CATEGORIES (in
// `MakerListingEditor/constants.js`), also add a matching entry here.
// Categories without an explicit map fall back to `DEFAULT_TECHNIQUES`
// which is a generic safe list.

const DEFAULT_TECHNIQUES = ["Mixed Media", "Hand-Made", "Machine-Made", "Other"];

// Category → ordered technique list. Lower-case-insensitive lookup so
// minor casing drift doesn't break the dropdown.
export const TECHNIQUES_BY_CATEGORY = {
  // ── Metal-forward ──────────────────────────────────────────────
  "Wall Art":            ["Plasma", "Laser", "Painting", "Photography", "Mixed Media", "Embroidery", "Wood Burning", "Other"],
  "Custom Signs":        ["Plasma", "Laser", "Router", "CNC", "Hand-Painted", "Vinyl", "Wood Burning", "Other"],
  "Outdoor Art":         ["Plasma", "Laser", "Forge", "Stone Carving", "Mosaic", "Cast", "Other"],
  "Business Signage":    ["Plasma", "Laser", "Router", "Vinyl", "Hand-Painted", "Engraving", "Other"],
  "Address Numbers":     ["Plasma", "Laser", "Forge", "Cast", "Hand-Painted", "Other"],
  "Garden & Yard Art":   ["Plasma", "Laser", "Forge", "Stone Carving", "Mosaic", "Mixed Media", "Other"],
  "Memorial & Tribute":  ["Engraving", "Forge", "Calligraphy", "Stone Carving", "Mixed Media", "Other"],

  // ── Wood-forward ───────────────────────────────────────────────
  "Woodworking":         ["Hand Carving", "Scroll Saw", "Router", "Wood Turning", "Pyrography", "CNC", "Joinery", "Other"],
  "Furniture":           ["Hand Carving", "Joinery", "Wood Turning", "CNC", "Upholstery", "Mixed Media", "Other"],
  "Kitchen & Bar":       ["Wood Turning", "Forge", "Engraving", "Pottery", "Resin", "Other"],

  // ── 3D / sculptural ────────────────────────────────────────────
  "Sculpture":           ["Forge", "Stone Carving", "Wood Carving", "Cast", "Mixed Media", "Mosaic", "Other"],
  "Lighting & Lamps":    ["Glassblowing", "Stained Glass", "Metalwork", "Wood", "Resin", "Mixed Media", "Other"],

  // ── Soft goods / wearables ─────────────────────────────────────
  "Home Decor":          ["Hand-Painted", "Macramé", "Mosaic", "Embroidery", "Quilting", "Mixed Media", "Other"],
  "Wedding Gifts":       ["Engraving", "Embroidery", "Calligraphy", "Hand-Painted", "Mixed Media", "Other"],
  "Jewelry & Wearables": ["Wire Wrapping", "Silversmithing", "Resin", "Lost Wax Casting", "Enameling", "Electroforming", "Embroidery", "Beading", "Other"],
  "Fiber & Textiles":    ["Embroidery", "Thread Painting", "Quilting", "Crochet", "Knitting", "Weaving", "Needle Felting", "Macramé", "Mixed Media", "Other"],
  "Leather Goods":       ["Tooling", "Hand Stitching", "Carving", "Dyeing", "Braiding", "Burnishing", "Other"],

  // ── Earth & clay ───────────────────────────────────────────────
  "Pottery & Ceramics":  ["Wheel Throwing", "Hand Building", "Slip Casting", "Raku", "Glazing", "Sgraffito", "Other"],

  // ── Seasonal & catch-all ───────────────────────────────────────
  "Holiday & Seasonal":  ["Mixed Media", "Embroidery", "Plasma", "Laser", "Hand-Painted", "Wood Burning", "Other"],
  "Other":               DEFAULT_TECHNIQUES,

  // ── iter413co — Newly added categories per Loretta's feedback ──
  "Paper Crafts":        ["Origami", "Quilling", "Papier-Mâché", "Bookbinding", "Hand-Cut", "Mixed Media", "Other"],
  "Mixed Media":         ["Collage", "Assemblage", "Resin", "Hand-Painted", "Embroidery", "Other"],
  "Glass":               ["Glassblowing", "Stained Glass", "Fused Glass", "Lampwork", "Etching", "Mosaic", "Other"],
};

/**
 * Returns the technique list for the given category. Case-insensitive
 * match, falls back to DEFAULT_TECHNIQUES when the category isn't mapped.
 */
export function techniquesForCategory(category) {
  if (!category) return DEFAULT_TECHNIQUES;
  // First try exact match (fast path).
  if (TECHNIQUES_BY_CATEGORY[category]) return TECHNIQUES_BY_CATEGORY[category];
  // Then case-insensitive match.
  const lc = String(category).toLowerCase();
  for (const k of Object.keys(TECHNIQUES_BY_CATEGORY)) {
    if (k.toLowerCase() === lc) return TECHNIQUES_BY_CATEGORY[k];
  }
  return DEFAULT_TECHNIQUES;
}

/**
 * Flat de-duplicated list of every technique across every category.
 * Used by surfaces that need to render technique-related copy/SEO
 * without knowing the category yet (e.g. `MeetTheMakers` legend, the
 * apply form before category selection).
 */
export const ALL_TECHNIQUES = Array.from(
  new Set(
    Object.values(TECHNIQUES_BY_CATEGORY).flat(),
  ),
).sort();
