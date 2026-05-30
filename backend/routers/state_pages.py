"""State landing-page support (iter301 / Phase 4 Bundle A).

Exposes one endpoint:
  GET /api/state-pages
    → list of states that have ≥ 1 maker, with maker counts.

Why this lives in a dedicated module:
  • The sitemap consults this list to include only state pages that
    have substantive content. Empty doorway pages tank SEO; we'd rather
    ship 13 dense pages than 50 thin ones.
  • The frontend `StatePage.jsx` resolves a 2-letter code (e.g. "tx")
    to the full state name + maker list at render time.
  • The `state_for_location()` helper is reused by sitemap + frontend
    state-page logic so the parsing is consistent.

The 50-state lookup table is checked at module load — no DB lookup,
no hot-path cost.
"""
from fastapi import APIRouter

from core import db

router = APIRouter()


# ISO-3166-2 US state codes (50 + DC). Single source of truth.
US_STATES: dict[str, str] = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut",
    "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
}
_NAME_TO_CODE: dict[str, str] = {v.lower(): k for k, v in US_STATES.items()}


def state_for_location(location: str | None) -> str | None:
    """Return the 2-letter state code for a maker location string,
    or None if no state can be extracted.

    Tolerates: "City, ST", "City, State", "City, State, Country",
    "City, ST 12345", and just "ST" or "State" on its own.
    """
    if not location:
        return None
    # Split on commas; check tokens right-to-left for a state match.
    tokens = [t.strip() for t in location.split(",") if t.strip()]
    for tok in reversed(tokens):
        # Try 2-letter uppercase match (most common: "Nashville, TN").
        # Also handle "TN 37207" — strip trailing digits.
        head = tok.split()[0] if tok else ""
        if len(head) == 2 and head.upper() in US_STATES:
            return head.upper()
        # Try full-name match ("Nashville, Tennessee").
        code = _NAME_TO_CODE.get(tok.lower())
        if code:
            return code
    return None


@router.get("/state-pages")
async def list_state_pages() -> dict:
    """Public read endpoint — returns every state that has ≥ 1 maker,
    sorted by maker count desc, then alphabetical.

    Consumed by the React frontend's `StatePage.jsx` route and the
    sitemap generator. Cheap query — only reads `slug` and `location`
    from the makers collection.
    """
    makers = await db.makers.find(
        {}, {"_id": 0, "slug": 1, "name": 1, "location": 1,
             "is_veteran_owned": 1, "techniques": 1, "rating": 1,
             "tagline": 1, "headline": 1, "portrait": 1,
             "banner_image_url": 1, "cover": 1},
    ).to_list(2000)

    by_state: dict[str, list] = {}
    for m in makers:
        code = state_for_location(m.get("location"))
        if not code:
            continue
        by_state.setdefault(code, []).append(m)

    out = [
        {
            "code": code,
            "slug": code.lower(),
            "name": US_STATES[code],
            "maker_count": len(makers_in),
            "makers": makers_in,
        }
        for code, makers_in in by_state.items()
    ]
    out.sort(key=lambda r: (-r["maker_count"], r["name"]))
    return {"states": out, "total_states": len(out)}
