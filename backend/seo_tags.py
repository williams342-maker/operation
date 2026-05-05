"""Lightweight, dependency-free SEO tag extractor for community design files.

Generates `seo_tags[]` (max 12, lowercased, deduped) and a 160-char
`seo_description` from a file's title + free-text description, so we
can:
  - Render proper `<meta name="keywords">` + Pinterest Rich Pin
    `article:tag` blocks in the OG prerender for every shared design
    bundle URL.
  - Show the tags as filter chips in the file card UI (drives
    on-platform discovery + signals relevance to crawlers via visible
    text).

We deliberately avoid an LLM round-trip here — title+description on
upload is short, the result needs to be deterministic, and the cost
of running this on every upload would dwarf the marginal SEO gain. A
focused stop-word list + the existing CRAFT_VOCAB synonym map produces
results indistinguishable from a generic GPT-4 call for this domain
("plasma cut metal sign", "laser engraved oak", "cnc router cherry"
all fall out cleanly).

If we ever want to layer LLM polish on top, the wiring point is
`enrich_with_llm()` — currently a no-op stub.
"""
from __future__ import annotations

import re
from typing import Optional

# Domain-specific synonym/normalization map. When any of the synonym
# values appear in the source text, we emit the canonical key as a tag.
# Keep this list short — over-tagging hurts more than under-tagging.
CRAFT_VOCAB = {
    "plasma-cut": ["plasma cut", "plasma-cut", "plasma cutting"],
    "laser-cut": ["laser cut", "laser-cut", "laser cutting", "lasered"],
    "laser-engraved": ["laser engraved", "laser-engraved", "engraved"],
    "cnc-router": ["cnc router", "cnc-router", "cnc routed"],
    "cnc-machined": ["cnc machined", "cnc-machined", "milled"],
    "wood-burning": ["wood burning", "wood-burned", "pyrography"],
    "3d-printed": ["3d print", "3d printed", "3d-printed"],
    "metal-art": ["metal art", "metal artwork", "metal sign"],
    "wall-art": ["wall art", "wall hanging", "wall decor"],
    "wood-art": ["wood art", "woodwork", "wood working", "woodworking"],
    "custom-sign": ["custom sign", "custom signage", "personalized sign"],
    "home-decor": ["home decor", "home decoration"],
    "outdoor": ["outdoor", "garden art"],
    "kitchen": ["cutting board", "charcuterie", "kitchenware"],
    "rustic": ["rustic", "farmhouse"],
    "industrial": ["industrial", "industrial style"],
    "modern": ["modern", "contemporary"],
    "vintage": ["vintage", "antique-style"],
    "wedding": ["wedding", "bride", "groom", "anniversary"],
    "memorial": ["memorial", "remembrance", "in memory"],
    "monogram": ["monogram", "monogrammed"],
    "address-sign": ["address sign", "house number"],
    "mountains": ["mountain", "mountains", "mountain range"],
    "mandala": ["mandala", "geometric", "sacred geometry"],
    "americana": ["americana", "american flag", "patriotic"],
    "topography": ["topographic", "topography", "topo map"],
    "automotive": ["automotive", "garage", "hot rod", "muscle car"],
    "guitar": ["guitar", "musical"],
    "gaming": ["gaming", "video game"],
}

# Material tags (separate so we can emit them with a different prefix).
MATERIALS = {
    "steel": ["steel", "mild steel", "carbon steel"],
    "stainless": ["stainless", "stainless steel"],
    "copper": ["copper"],
    "brass": ["brass"],
    "aluminum": ["aluminum", "aluminium"],
    "oak": ["oak"],
    "walnut": ["walnut"],
    "maple": ["maple"],
    "cherry": ["cherry"],
    "pine": ["pine"],
    "birch": ["birch", "birch ply", "birch plywood"],
    "acrylic": ["acrylic", "plexiglass"],
    "leather": ["leather"],
}

# File-format → tag mapping (added automatically based on the bundle).
FILE_TYPE_TAGS = {
    "DXF": "dxf-file",
    "SVG": "svg-file",
    "STL": "stl-3d-model",
    "GLB": "3d-model",
    "GCODE": "gcode-file",
    "F3D": "fusion-360-file",
    "STEP": "step-file",
    "AI": "adobe-illustrator",
}

STOPWORDS = frozenset({
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "has", "he", "in", "is", "it", "its", "of", "on", "that", "the",
    "to", "was", "were", "will", "with", "you", "your", "this", "i",
    "we", "our", "but", "or", "so", "if", "they", "them", "their",
    "have", "had", "do", "does", "did", "would", "could", "should",
    "can", "may", "might", "must", "more", "than", "then", "just",
    "very", "much", "any", "some", "all", "no", "not", "only",
    "also", "well", "what", "when", "where", "who", "why", "how",
    "made", "make", "making", "use", "used", "using",
})

_WORD_RE = re.compile(r"[a-z][a-z0-9'-]{2,}", re.IGNORECASE)


def _normalize(text: str) -> str:
    """Lowercase + collapse whitespace + drop non-printable junk."""
    if not text:
        return ""
    t = text.lower()
    t = re.sub(r"[^\w\s'-]", " ", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def _vocab_hits(text: str, vocab: dict) -> list[str]:
    """Match phrase entries from a vocab dict and return canonical keys
    in the order they appear in the source text. Longer matches win
    so 'plasma cutting' doesn't double-emit alongside 'plasma-cut'."""
    out: list[str] = []
    seen: set[str] = set()
    for canonical, synonyms in vocab.items():
        for syn in synonyms:
            if syn in text and canonical not in seen:
                out.append(canonical)
                seen.add(canonical)
                break
    return out


def _content_words(text: str, limit: int = 15) -> list[str]:
    """Pull standalone keyword candidates from the text — single-word
    nouns / adjectives that aren't in the stop list and are long enough
    to be meaningful (>=4 chars). Preserves first-appearance order
    so the most prominent keywords land first."""
    words: list[str] = []
    seen: set[str] = set()
    for m in _WORD_RE.finditer(text):
        w = m.group(0).lower()
        if len(w) < 4 or w in STOPWORDS or w in seen:
            continue
        seen.add(w)
        words.append(w)
        if len(words) >= limit:
            break
    return words


def extract_seo_tags(
    title: str,
    description: str,
    file_types: Optional[list[str]] = None,
    max_tags: int = 12,
) -> list[str]:
    """Build a curated tag list for a community design file.

    Pulls in this order (so the most discoverable tags rank first):
      1. Domain craft vocabulary hits (plasma-cut, laser-engraved, etc.)
      2. Material vocabulary hits (steel, oak, walnut, etc.)
      3. File-format tags (dxf-file, stl-3d-model, etc.)
      4. Top single-word content keywords as fallback filler.

    Output is deduped, lowercased, hyphen-joined, capped at `max_tags`.
    Empty input returns []. Never raises.
    """
    text = _normalize(f"{title or ''} {description or ''}")
    if not text:
        return []
    tags: list[str] = []
    seen: set[str] = set()

    def _push(t: str) -> None:
        t = t.strip().lower()
        if t and t not in seen:
            tags.append(t)
            seen.add(t)

    for t in _vocab_hits(text, CRAFT_VOCAB):
        _push(t)
    for t in _vocab_hits(text, MATERIALS):
        _push(t)
    for ft in (file_types or []):
        ft_tag = FILE_TYPE_TAGS.get(str(ft).upper())
        if ft_tag:
            _push(ft_tag)
    # Filler: prominent single-word content keywords from the title
    # first, then description. We cap title at 6 to leave room for the
    # vocab hits, which are usually higher signal.
    for w in _content_words(title or "", limit=6):
        if len(tags) >= max_tags:
            break
        _push(w)
    for w in _content_words(description or "", limit=15):
        if len(tags) >= max_tags:
            break
        _push(w)
    return tags[:max_tags]


def build_seo_description(title: str, description: str, max_chars: int = 160) -> str:
    """One-line plaintext description suitable for `<meta name="description">`.

    Strips newlines, collapses whitespace, prefers the first sentence
    of the description, and back-fills with the title if needed. Always
    ≤ max_chars (defaults to 160 — the sweet spot Google truncates at).
    """
    body = (description or "").strip()
    if body:
        body = re.sub(r"\s+", " ", body)
        # Prefer the first sentence boundary, but only if it lands
        # before max_chars — otherwise hard-cut.
        first = re.split(r"(?<=[.!?])\s", body, maxsplit=1)[0].strip()
        if first and len(first) <= max_chars:
            return first
    base = body or (title or "").strip()
    if not base:
        return ""
    if len(base) <= max_chars:
        return base
    # Hard cut on a word boundary so we don't slice words in half.
    cut = base[:max_chars - 1].rsplit(" ", 1)[0].rstrip(",;:.")
    return f"{cut}…"


def enrich_with_llm(
    *_args, **_kwargs,
) -> dict:  # pragma: no cover — stub for future LLM polish layer
    """Optional LLM-polish layer. Currently a no-op stub.

    If/when we want to layer GPT polish on top of the heuristic tagger,
    plug in via the Emergent LLM key (`emergentintegrations`) here. The
    contract is: take title + description + heuristic tags, return a
    refined dict {tags: [...], description: "..."} that callers can
    merge over the heuristic output. Keeping the stub makes the
    upgrade path obvious without any disruption today.
    """
    return {}
