"""Category-aware Google Merchant attributes (iter366).

Merchant Center applies apparel-style attribute expectations (color /
gender / age_group / size) based on the google_product_category. Our
feed previously sent none of them, producing "Missing color/gender/
age_group" warnings on items that DO map to apparel-adjacent GPCs
(e.g. Jewelry) and feed-quality dings on boxes/decor that don't need
them at all.

This module decides, per product, which attributes to SEND and which
to SUPPRESS — never exposing irrelevant fields to sellers:

  Profile            Sends                                  Suppresses
  ─────────────────  ─────────────────────────────────────  ───────────────
  default            material, color (only if derivable)    gender, age_group, size
  jewelry_storage    material, color (Multi-color fallback) gender, age_group, size
  apparel            color (Multi-color fallback),          size (when unknown)
                     gender=Unisex, age_group=Adult

Smart color derivation (seller spec): walnut→Brown, oak→Beige,
maple→Tan, steel→Gray, black powder coat→Black; fallback Multi-color
where the category benefits. Material derives from the `materials`
field first, then title/description keywords.
"""
from __future__ import annotations

import re

# Ordered — multiword phrases first so "black powder coat" wins over
# a later bare-metal match.
_COLOR_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(p, re.IGNORECASE), c)
    for p, c in [
        (r"black\s+powder[\s\-]*coat(?:ed)?", "Black"),
        (r"\bwalnut\b", "Brown"),
        (r"\boak\b", "Beige"),
        (r"\bmaple\b", "Tan"),
        (r"\bcherry\b", "Brown"),
        (r"\bmahogany\b", "Brown"),
        (r"\bsteel\b", "Gray"),
        (r"\baluminum\b", "Gray"),
        (r"\bbrass\b", "Gold"),
        (r"\bcopper\b", "Copper"),
        (r"\bmatte\s+black\b|\bblack\s+metal\b", "Black"),
    ]
]

_MATERIAL_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(p, re.IGNORECASE), m)
    for p, m in [
        (r"\bstainless\s+steel\b|\bsteel\b", "Steel"),
        (r"\baluminum\b", "Aluminum"),
        (r"\bbrass\b", "Brass"),
        (r"\bcopper\b", "Copper"),
        (r"\bleather\b", "Leather"),
        (r"\bacrylic\b", "Acrylic"),
        (r"\bepoxy\b|\bresin\b", "Resin"),
        (r"\bceramic\b", "Ceramic"),
        (r"\bglass\b", "Glass"),
        (r"\bwalnut\b|\boak\b|\bmaple\b|\bcherry\b|\bbirch\b|\bpine\b|\bmahogany\b|\bwood(?:en)?\b|\bplywood\b|\bbamboo\b", "Wood"),
    ]
]

_STORAGE_HINT = re.compile(r"\b(box|boxes|case|chest|holder|organizer|storage|tray|stand|rack|display)\b", re.IGNORECASE)


def _haystack(p: dict) -> str:
    mats = p.get("materials")
    if isinstance(mats, (list, tuple)):
        mats = " ".join(str(m) for m in mats)
    return " ".join([
        str(p.get("title") or ""),
        str(mats or ""),
        str(p.get("description") or "")[:500],
    ])


def derive_color(p: dict) -> str | None:
    # iter369 — explicit sources first: the AI auto-fix's feed-only
    # `merchant_color`, then the maker's own colors palette from the
    # listing editor ("Custom color" is a buyer-input placeholder, skip).
    mc = (p.get("merchant_color") or "").strip()
    if mc:
        return mc[:40].title()
    palette = p.get("colors")
    if isinstance(palette, (list, tuple)):
        for c in palette:
            c = str(c).strip()
            if c and c.lower() != "custom color":
                return c[:40].title()
    hay = _haystack(p)
    for pat, color in _COLOR_RULES:
        if pat.search(hay):
            return color
    return None


def derive_material(p: dict) -> str | None:
    mats = p.get("materials")
    if isinstance(mats, (list, tuple)) and mats:
        first = str(mats[0]).strip()
        if first:
            return first[:100].title()
    elif isinstance(mats, str) and mats.strip():
        return mats.strip().split(",")[0][:100].title()
    hay = _haystack(p)
    for pat, material in _MATERIAL_RULES:
        if pat.search(hay):
            return material
    return None


def profile_for(p: dict, gpc: str = "") -> str:
    """Classify a product into an attribute profile.

    `gpc` is the resolved google_product_category breadcrumb. Jewelry
    STORAGE (boxes/organizers) is detected before the apparel check so
    "Engraved Wooden Jewelry Box" never gets gender/age_group.
    """
    gpc_l = (gpc or "").lower()
    cat_l = (p.get("category") or "").lower()
    title_l = (p.get("title") or "").lower()

    jewelry_ctx = "jewelry" in gpc_l or "jewelry" in cat_l or "jewelry" in title_l
    if jewelry_ctx and (_STORAGE_HINT.search(title_l) or "jewelry boxes" in gpc_l or "storage" in cat_l):
        return "jewelry_storage"
    # True apparel & accessories (incl. worn jewelry) — Google expects
    # the full apparel attribute set there.
    if gpc_l.startswith("apparel & accessories") or cat_l in ("apparel", "jewelry"):
        return "apparel"
    return "default"


def merchant_attributes(p: dict, gpc: str = "") -> dict:
    """Compute the category-appropriate attribute payload for one row.

    Returns {profile, attributes: {name: value}, suppressed: [names],
    warnings: [strings]} — `warnings` are internal-only (logged, never
    shown to buyers; surfaced to sellers via the feed preview).
    """
    profile = profile_for(p, gpc)
    attrs: dict[str, str] = {}
    suppressed: list[str] = []
    warnings: list[str] = []

    material = derive_material(p)
    color = derive_color(p)

    if profile == "apparel":
        attrs["color"] = color or "Multi-color"
        attrs["gender"] = "unisex"
        attrs["age_group"] = "adult"
        if material:
            attrs["material"] = material
        suppressed.append("size")  # unknown for handmade pieces — suppress, don't blank
        if not color:
            warnings.append("color fell back to Multi-color (no derivable color)")
    elif profile == "jewelry_storage":
        attrs["color"] = color or "Multi-color"
        if material:
            attrs["material"] = material
        else:
            warnings.append("material not derivable — row sent without material")
        suppressed += ["gender", "age_group", "size"]
        if not color:
            warnings.append("color fell back to Multi-color (no derivable color)")
    else:  # default — home decor, storage boxes, signs, furniture…
        if material:
            attrs["material"] = material
        if color:
            attrs["color"] = color
        suppressed += ["gender", "age_group", "size"]
        if not material:
            warnings.append("material not derivable — row sent without material")

    return {"profile": profile, "attributes": attrs, "suppressed": suppressed, "warnings": warnings}
