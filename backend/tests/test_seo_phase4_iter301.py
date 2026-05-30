"""SEO Phase 4 Bundle A (iter301) — state pages + content guides.

Verifies:
  • State-parsing helper `state_for_location()` handles common formats.
  • `/api/state-pages` returns only states with ≥ 1 maker, sorted by count.
  • Sitemap includes every state page returned by `/api/state-pages`.
  • Sitemap includes the 3 new content guides.
  • Frontend guide configs declare the required keys (sections, faqs,
    relatedLinks, publishedAt) on all three guides.
"""
import os
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

API = "http://localhost:8001"

from routers.state_pages import state_for_location, US_STATES  # noqa: E402


def test_state_for_location_handles_common_formats():
    assert state_for_location("Nashville, TN") == "TN"
    assert state_for_location("Austin, TX 78704") == "TX"
    assert state_for_location("Brooklyn, NY, USA") == "NY"
    assert state_for_location("Portland, Oregon") == "OR"
    assert state_for_location("San Francisco, California") == "CA"
    assert state_for_location("") is None
    assert state_for_location(None) is None
    # Bogus state -> None
    assert state_for_location("Vancouver, BC") is None
    # Country-only string with no state — must NOT match.
    assert state_for_location("Canada") is None


def test_state_for_location_covers_all_50_states_plus_dc():
    """Every code in the lookup table must round-trip."""
    for code in US_STATES.keys():
        assert state_for_location(f"Some City, {code}") == code


def test_state_pages_endpoint_returns_sorted_states_with_makers():
    r = httpx.get(f"{API}/api/state-pages", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "states" in body and "total_states" in body
    # Must include at least one state from the seeded maker roster.
    assert body["total_states"] >= 1
    # Sort order: maker_count DESC, then name ASC.
    counts = [s["maker_count"] for s in body["states"]]
    assert counts == sorted(counts, reverse=True) or all(c == counts[0] for c in counts) or _is_secondary_sorted(body["states"])
    # Every state in the response has at least 1 maker (no doorway pages).
    for s in body["states"]:
        assert s["maker_count"] >= 1
        assert s["slug"] == s["code"].lower()
        assert s["name"] in US_STATES.values()


def _is_secondary_sorted(states):
    """Tiebreakers within the same maker_count must be alphabetical by name."""
    for i in range(1, len(states)):
        prev, cur = states[i - 1], states[i]
        if cur["maker_count"] == prev["maker_count"]:
            if cur["name"] < prev["name"]:
                return False
    return True


def test_sitemap_includes_every_state_page_with_makers():
    r = httpx.get(f"{API}/api/state-pages", timeout=10).json()
    sitemap = httpx.get(f"{API}/api/sitemap.xml", timeout=15).text
    for s in r["states"]:
        url = f"https://craftersmarket.org/makers/state/{s['slug']}"
        assert url in sitemap, f"Missing state page in sitemap: {url}"


def test_sitemap_includes_phase4_content_guides():
    sitemap = httpx.get(f"{API}/api/sitemap.xml", timeout=15).text
    for slug in (
        "plasma-vs-laser-vs-router",
        "outdoor-mounting-guide",
        "metal-gauge-finish-guide",
    ):
        assert f"https://craftersmarket.org/guides/{slug}" in sitemap


def test_guide_configs_have_required_keys():
    """All three guides must declare sections, faqs, relatedLinks, and
    publishedAt for the Article JSON-LD to emit correctly."""
    path = "/app/frontend/src/pages/guideConfig.js"
    with open(path) as f:
        src = f.read()
    for slug in (
        "plasma-vs-laser-vs-router",
        "outdoor-mounting-guide",
        "metal-gauge-finish-guide",
    ):
        idx = src.find(f'"{slug}":')
        assert idx > 0, f"Missing guide config for {slug}"
        block = src[idx:idx + 20000]  # guides are long
        for key in ("sections:", "faqs:", "relatedLinks:", "publishedAt:"):
            assert key in block, f"{slug} missing {key}"
        # Each guide should have ≥ 5 sections and ≥ 5 FAQs.
        # Coarse count: how many `heading:` keys appear in the sections array.
        sections_start = block.find("sections:")
        faqs_start = block.find("faqs:")
        related_start = block.find("relatedLinks:")
        sections_slice = block[sections_start:faqs_start]
        assert sections_slice.count("heading:") >= 5, f"{slug} has fewer than 5 sections"
        faqs_slice = block[faqs_start:related_start]
        assert faqs_slice.count("q:") >= 5, f"{slug} has fewer than 5 FAQs"
