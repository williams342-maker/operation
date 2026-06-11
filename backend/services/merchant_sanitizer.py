"""Google Merchant feed sanitizer (iter365).

Google Merchant Center classifies products via title/description keywords
(and image interpretation) and false-positives legitimate engraved knife
listings into the restricted "Guns and Parts" bucket. This module rewrites
ONLY the exported feed metadata — seller-facing titles, SEO URLs, and the
public marketplace are never touched.

Term policy (from the seller spec):
  Avoid : hunting, tactical, combat, weapon, blade, pocketknife,
          self-defense, knife/knives (the trigger nouns themselves)
  Prefer: engraved, personalized, collectible, keepsake, outdoor gift,
          custom gift, handcrafted

Resolution order for a listing's merchant title:
  1. listing `merchant_exclude`            → omit from feed
  2. category rule mode == "exclude"       → omit from feed
  3. listing `merchant_title` override     → use verbatim (seller intent)
  4. auto-optimize on (default) and        → sanitized title/description
     category rule != "sync"
  5. otherwise                             → original title/description

Category rules live in `merchant_category_rules` docs:
  { category: str, mode: "sync" | "rewrite" | "exclude" }
"""
from __future__ import annotations

import re

# Ordered longest-match-first so "hunting knife" rewrites as a phrase
# before the single-word fallbacks fire. Patterns are case-insensitive
# and word-bounded; replacements preserve leading capitalization.
_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(p, re.IGNORECASE), r)
    for p, r in [
        (r"\bhunting[\s\-]+knives\b", "outdoor keepsakes"),
        (r"\bhunting[\s\-]+knife\b", "outdoor keepsake"),
        (r"\bpocket[\s\-]*knives\b", "pocket keepsakes"),
        (r"\bpocket[\s\-]*knife\b", "pocket keepsake"),
        (r"\bself[\s\-]+defen[cs]e\b", "outdoor"),
        (r"\bknives\b", "keepsakes"),
        (r"\bknife\b", "keepsake"),
        (r"\bhunting\b", "outdoor"),
        (r"\btactical\b", "custom"),
        (r"\bcombat\b", "custom"),
        (r"\bweaponry\b", "collectibles"),
        (r"\bweapons\b", "collectibles"),
        (r"\bweapon\b", "collectible"),
        (r"\bblades\b", "keepsakes"),
        (r"\bblade\b", "keepsake"),
    ]
]

# If a rewrite happened but the title carries none of these seller-
# authored "gift" qualifiers, prefix one — mirrors the spec's preferred-
# term guidance. (Deliberately excludes keepsake/collectible since those
# usually arrive via our own replacements above.)
_SAFE_QUALIFIER = re.compile(
    r"\b(engraved|personali[sz]ed|custom|handcrafted)\b",
    re.IGNORECASE,
)


def _preserve_case(src: str, repl: str) -> str:
    if src.isupper():
        return repl.upper()
    words = src.replace("-", " ").split()
    # Title-Cased multi-word source ("Hunting Knife") → Title-Case the
    # replacement ("Outdoor Keepsake").
    if len(words) > 1 and all(w[:1].isupper() for w in words if w):
        return " ".join(w[:1].upper() + w[1:] for w in repl.split())
    if src[:1].isupper():
        return repl[:1].upper() + repl[1:]
    return repl


def sanitize_text(text: str) -> tuple[str, list[str]]:
    """Rewrite restricted terms. Returns (sanitized, hit_terms)."""
    hits: list[str] = []
    out = text or ""
    for pat, repl in _RULES:
        def _sub(m, _r=repl):
            hits.append(m.group(0))
            return _preserve_case(m.group(0), _r)
        out = pat.sub(_sub, out)
    return re.sub(r"\s{2,}", " ", out).strip(), hits


def sanitize_title(title: str) -> tuple[str, list[str]]:
    """Title variant — also injects a safe qualifier when a rewrite
    happened and none is present (e.g. 'High Carbon Steel Hunting Knife'
    → 'Personalized High Carbon Steel Outdoor Keepsake')."""
    out, hits = sanitize_text(title)
    if hits and not _SAFE_QUALIFIER.search(out):
        out = f"Personalized {out}"
    return out, hits


def resolve_merchant_listing(p: dict, rules_by_category: dict[str, str]) -> dict:
    """Decide how a product appears in the Google Merchant feed.

    `rules_by_category` maps lower-cased category → mode. Returns:
      {include, title, description, mode, hits}
    where mode ∈ excluded | category_excluded | override | rewritten | original.
    """
    title = (p.get("title") or "").strip()
    description = (p.get("description") or "").strip()

    if p.get("merchant_exclude"):
        return {"include": False, "mode": "excluded", "title": None, "description": None, "hits": []}

    rule = rules_by_category.get((p.get("category") or "").strip().lower())
    if rule == "exclude":
        return {"include": False, "mode": "category_excluded", "title": None, "description": None, "hits": []}

    auto = p.get("merchant_auto_optimize")
    auto = True if auto is None else bool(auto)

    override = (p.get("merchant_title") or "").strip()
    if override:
        # Seller wrote this deliberately for Google — use verbatim. The
        # description still gets sanitized when auto-optimize is on.
        desc, dhits = sanitize_text(description) if auto and rule != "sync" else (description, [])
        return {"include": True, "mode": "override", "title": override, "description": desc, "hits": dhits}

    if auto and rule != "sync":
        new_title, t_hits = sanitize_title(title)
        new_desc, d_hits = sanitize_text(description)
        if t_hits or d_hits:
            return {
                "include": True, "mode": "rewritten",
                "title": new_title, "description": new_desc,
                "hits": sorted({h.lower() for h in t_hits + d_hits}),
            }

    return {"include": True, "mode": "original", "title": title, "description": description, "hits": []}


async def load_category_rules(db) -> dict[str, str]:
    """Fetch the admin category-rules map (lower-cased category → mode)."""
    rules: dict[str, str] = {}
    async for d in db.merchant_category_rules.find({}, {"_id": 0, "category": 1, "mode": 1}):
        cat = (d.get("category") or "").strip().lower()
        if cat and d.get("mode") in ("sync", "rewrite", "exclude"):
            rules[cat] = d["mode"]
    return rules
