"""iter413r regression — Ad Creative Workshop `site` subject contract.

The Workshop accepts three `subject_type` values: product, maker, site.
`site` is a synthetic brand-level subject used to generate self-promoting
marketplace ads (Crafters Market itself) rather than per-product or
per-maker ads. This file pins:

  1. The subjects endpoint returns a `site` entry on empty + brand queries.
  2. The subjects endpoint hides `site` on unrelated craft-term queries.
  3. The generate endpoint accepts subject_type=site without 404.

If any of these break, the brand-ad workflow silently degrades back to
product/maker only and admin loses the brand-campaign affordance.
"""
import os
import re  # noqa: F401 — kept for symmetry with iter413p contract test
import sys

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
sys.path.insert(0, "/app/backend")

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"


@pytest.fixture
def admin_headers():
    from maker_auth import issue_admin_magic_token
    email = os.environ.get("OPS_EMAIL") or "team@craftersmarket.org"
    magic = issue_admin_magic_token(email)
    r = requests.post(f"{API}/admin/auth/verify", json={"token": magic}, timeout=15)
    r.raise_for_status()
    return {
        "Authorization": f"Bearer {r.json()['token']}",
        "Content-Type": "application/json",
    }


def test_subjects_empty_query_includes_site(admin_headers):
    """Empty subject search MUST surface the brand-level `site` entry —
    that's how admin discovers the option exists."""
    r = requests.get(f"{API}/admin/ad-creative/subjects?q=&limit=3",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "site" in d, (
        "iter413r regression: subjects endpoint dropped the `site` "
        "field — admin can no longer pick the marketplace itself as a "
        "subject for self-promoting brand ads."
    )
    assert len(d["site"]) == 1, (
        f"Expected exactly 1 site entry, got {len(d['site'])}: {d['site']}"
    )
    entry = d["site"][0]
    assert entry.get("type") == "site"
    assert entry.get("slug") == "crafters-market"
    assert "marketplace" in (entry.get("title") or "").lower(), (
        f"Site title lost brand language: {entry.get('title')!r}"
    )


def test_subjects_brand_query_surfaces_site(admin_headers):
    """Brand-related search terms (brand, marketplace, site, crafters,
    self) MUST surface the site entry."""
    for q in ("brand", "marketplace", "site", "crafters", "self"):
        r = requests.get(f"{API}/admin/ad-creative/subjects?q={q}&limit=3",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("site"), (
            f"iter413r regression: query {q!r} no longer surfaces the "
            "site entry — admin can't find brand-ads via search."
        )


def test_subjects_unrelated_craft_term_hides_site(admin_headers):
    """A craft-specific search ('wood', 'pottery', etc.) MUST NOT show
    the site entry — it would clutter the picker and confuse admins
    looking for specific products. If this drifts, admin sees Crafters
    Market in every search and assumes the picker is broken."""
    for q in ("wood", "pottery", "leather"):
        r = requests.get(f"{API}/admin/ad-creative/subjects?q={q}&limit=3",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("site") == [], (
            f"iter413r regression: query {q!r} now surfaces site — "
            "the brand entry should only appear on brand-related "
            "searches or empty queries."
        )


def test_generate_accepts_site_subject_type(admin_headers):
    """Posting subject_type=site must NOT 422 (regex validation) and
    must NOT 404 (subject lookup). We don't actually require copy here
    — the LLM call can be slow and may not be available in CI. We just
    pin the contract by asserting any-2xx OR a >= 500 model error
    (which proves we got past the validation + subject-lookup layers).

    iter413r regression: a regex tightening or `_find_subject` revert
    would cause 422 or 404 — and silently kill the brand-ad workflow."""
    payload = {
        "subject_type": "site",
        "subject_slug": "crafters-market",
        "channels": ["google_search"],
        "tone": "professional",
        "generate_images": False,
        "num_image_variants": 0,
    }
    r = requests.post(f"{API}/admin/ad-creative/generate",
                      headers=admin_headers, json=payload, timeout=90)
    # 422 (Pydantic regex) and 404 (subject lookup) are the two failure
    # modes we MUST guard against. 200 + 5xx (model error) both prove
    # the validation+lookup layers accepted the site subject.
    assert r.status_code not in (422, 404), (
        f"iter413r regression: generate endpoint rejected subject_type="
        f"site with HTTP {r.status_code}. Body: {r.text[:300]}. The "
        "schema regex must accept 'site' AND _find_subject must have "
        "a `site` branch returning the SITE_SUBJECT dict."
    )


def test_generate_rejects_unknown_subject_type(admin_headers):
    """Sanity check that the regex still rejects invalid subject types
    so a typo doesn't silently fall through to a 500."""
    payload = {
        "subject_type": "totally-not-a-thing",
        "subject_slug": "x",
        "channels": ["google_search"],
        "tone": "professional",
    }
    r = requests.post(f"{API}/admin/ad-creative/generate",
                      headers=admin_headers, json=payload, timeout=15)
    assert r.status_code == 422, r.text
