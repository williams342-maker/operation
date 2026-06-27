"""iter413de — Versioned Quality Scoring Engine contract.

Locks the BEHAVIOR of the scoring engine (registration, versioning,
per-rule isolation, crash resilience) AND the listing_quality@v1
rule set (cover_photo, photo_count, description, product_video,
shipping, seo, materials).

The engine must:
  • Allow multiple versions of the same algorithm to coexist.
  • Default to the pinned version when callers don't supply one.
  • Isolate rule crashes — one bad rule MUST NOT break the scorecard.
  • Return a stable, render-ready shape every time.
  • Always return numeric `score` ≤ rule `weight` even if a buggy
    rule tries to over-score.
"""
from __future__ import annotations

import os
import sys
import asyncio
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

import quality  # noqa: F401  — registers v1 rules + default version
from quality.engine import (
    evaluate, register_rule, set_default_version, RuleResult,
    registered_algorithms,
)

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://active-project-4.preview.emergentagent.com"
).rstrip("/")


# ── Pure engine contract ──────────────────────────────────────────────
def test_listing_v1_is_registered_and_default():
    cards = registered_algorithms()
    assert ("listing_quality", "v1") in cards


def test_perfect_listing_scores_100():
    """A listing meeting every v1 rule must hit 100%."""
    subject = {
        "image": "https://cdn/x.jpg",
        "images": ["a", "b", "c", "d", "e"],
        "description": "a" * 320,
        "listing_video": {"url": "https://cdn/v.mp4"},
        "shipping_profile_id": "prof_1",
        "title": "Hand-Forged Brass Pour Spout",
        "slug": "hand-forged-brass-pour-spout",
        "meta_description": "Sturdy hand-forged brass spout, hand-finished in Vermont. " * 2,
        "materials": ["brass", "leather", "linseed oil"],
    }
    r = evaluate("listing_quality", None, subject)
    assert r["algorithm"] == "listing_quality"
    assert r["version"] == "v1"
    assert r["percent"] == 100.0, r
    assert all(rule["passed"] for rule in r["rules"])


def test_empty_listing_scores_low():
    r = evaluate("listing_quality", "v1", {})
    assert r["percent"] < 30, r["percent"]
    # All zero-score rules must surface a recommendation.
    failing = [x for x in r["rules"] if not x["passed"]]
    assert failing, "expected at least one failing rule"
    for rule in failing:
        if rule["score"] == 0:
            assert rule["recommendation"], (
                f"failing rule {rule['rule_id']} must include a recommendation"
            )


def test_partial_listing_partial_score():
    """Mid-tier listing with photos + thin description gets partial credit."""
    subject = {
        "image": "https://cdn/x.jpg",
        "images": ["a", "b", "c"],
        "description": "Solid little spout, hand-poured.",   # < 120 chars
        "shipping_profile_id": "prof_1",
        "title": "Brass Pour Spout",
        "slug": "brass-pour-spout",
        "meta_description": "",
        "materials": ["brass"],
    }
    r = evaluate("listing_quality", "v1", subject)
    assert 30 < r["percent"] < 90, r["percent"]


def test_rule_crash_isolated():
    """A rule that raises must not poison the whole scorecard."""
    # Register a crashing rule against an isolated algorithm so we
    # never pollute the production listing_quality scorecard.
    @register_rule(
        algorithm="iter413de_crashtest", version="v1",
        rule_id="bad_rule", weight=10, label="Bad",
    )
    def bad(_subject):
        raise RuntimeError("boom")

    @register_rule(
        algorithm="iter413de_crashtest", version="v1",
        rule_id="good_rule", weight=10, label="Good",
    )
    def good(_subject):
        return RuleResult(passed=True, score=10, explanation="ok")

    r = evaluate("iter413de_crashtest", "v1", {})
    assert r["max_score"] == 20
    assert r["score"] == 10                # only the good rule contributed
    bad_row = next(x for x in r["rules"] if x["rule_id"] == "bad_rule")
    assert bad_row["passed"] is False
    assert bad_row["score"] == 0
    assert "rule crashed" in bad_row["explanation"]


def test_versions_coexist():
    """v1 and v2 of the SAME algorithm must score independently."""
    @register_rule(
        algorithm="iter413de_versions", version="v1",
        rule_id="r1", weight=10, label="R1",
    )
    def r1(_):
        return RuleResult(passed=True, score=10)

    @register_rule(
        algorithm="iter413de_versions", version="v2",
        rule_id="r1", weight=10, label="R1",
    )
    def r1_v2(_):
        return RuleResult(passed=True, score=5)

    @register_rule(
        algorithm="iter413de_versions", version="v2",
        rule_id="r2", weight=10, label="R2",
    )
    def r2_v2(_):
        return RuleResult(passed=True, score=10)

    v1 = evaluate("iter413de_versions", "v1", {})
    v2 = evaluate("iter413de_versions", "v2", {})
    assert v1["max_score"] == 10 and v1["score"] == 10
    assert v2["max_score"] == 20 and v2["score"] == 15
    assert v1["version"] == "v1"
    assert v2["version"] == "v2"


def test_score_capped_at_rule_weight():
    """A misbehaving rule that returns score > weight must be clamped."""
    @register_rule(
        algorithm="iter413de_capping", version="v1",
        rule_id="over", weight=5, label="Over",
    )
    def over(_):
        return RuleResult(passed=True, score=999)

    r = evaluate("iter413de_capping", "v1", {})
    assert r["score"] == 5  # clamped to weight


# ── HTTP endpoint contract ────────────────────────────────────────────
def _make_jwt(email: str) -> str:
    from maker_auth import issue_magic_token
    tok = issue_magic_token(email)
    r = requests.post(f"{BASE_URL}/api/maker/auth/verify",
                      json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _make_admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify",
                      json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture()
def listing_and_maker():
    """Seed a maker + listing, return (maker_slug, listing_slug, jwt)."""
    from motor.motor_asyncio import AsyncIOMotorClient
    maker_slug = f"qs-{uuid.uuid4().hex[:6]}"
    email = f"{maker_slug}@test.com"
    listing_slug = f"qs-listing-{uuid.uuid4().hex[:6]}"

    async def _seed():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.makers.insert_one({
            "id": str(uuid.uuid4()), "slug": maker_slug, "email": email,
            "name": "QS Test", "shop_name": "QS Test",
            "initials": "QS", "location": "Test", "bio": "test",
            "portrait": "", "cover": "",
            "status": "approved", "tier": "standard",
            "subscription_status": "free", "session_version": 0,
        })
        await db.products.insert_one({
            "id": str(uuid.uuid4()), "slug": listing_slug,
            "maker_slug": maker_slug,
            "title": "Hand-Forged Brass Pour Spout",
            "description": "Sturdy hand-forged brass spout, hand-finished in Vermont. "
                           "Made for kitchen pours and barware. " * 4,
            "image": "https://cdn/x.jpg",
            "images": ["a","b","c","d","e"],
            "listing_video": {"url": "https://cdn/v.mp4"},
            "shipping_profile_id": "prof_1",
            "meta_description": "Sturdy hand-forged brass spout, hand-finished in Vermont. " * 2,
            "materials": ["brass", "leather", "linseed oil"],
            "deleted_at": None,
        })
        c.close()
    asyncio.run(_seed())
    jwt = _make_jwt(email)
    yield maker_slug, listing_slug, jwt

    async def _wipe():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.makers.delete_one({"slug": maker_slug})
        await db.products.delete_one({"slug": listing_slug})
        c.close()
    asyncio.run(_wipe())


def test_maker_can_read_own_listing_quality(listing_and_maker):
    maker_slug, listing_slug, jwt = listing_and_maker
    r = requests.get(
        f"{BASE_URL}/api/maker/listings/{listing_slug}/quality-score",
        headers={"Authorization": f"Bearer {jwt}"}, timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["algorithm"] == "listing_quality"
    assert body["version"] == "v1"
    assert body["percent"] == 100.0
    assert {x["rule_id"] for x in body["rules"]} == {
        "cover_photo", "photo_count", "description",
        "product_video", "shipping", "seo", "materials",
    }


def test_maker_cannot_read_other_listing(listing_and_maker):
    _, listing_slug, _ = listing_and_maker
    # Mint a separate maker's JWT.
    from maker_auth import issue_magic_token
    from motor.motor_asyncio import AsyncIOMotorClient
    other_email = f"other-{uuid.uuid4().hex[:6]}@test.com"
    other_slug = f"other-{uuid.uuid4().hex[:6]}"

    async def _seed_other():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        await c[os.environ["DB_NAME"]].makers.insert_one({
            "id": str(uuid.uuid4()), "slug": other_slug, "email": other_email,
            "name": "Other", "shop_name": "Other", "initials": "OT",
            "status": "approved", "tier": "standard",
            "subscription_status": "free", "session_version": 0,
        })
        c.close()
    asyncio.run(_seed_other())
    try:
        tok = issue_magic_token(other_email)
        other_jwt = requests.post(
            f"{BASE_URL}/api/maker/auth/verify",
            json={"token": tok}, timeout=15,
        ).json()["token"]
        r = requests.get(
            f"{BASE_URL}/api/maker/listings/{listing_slug}/quality-score",
            headers={"Authorization": f"Bearer {other_jwt}"}, timeout=20,
        )
        assert r.status_code == 403
    finally:
        async def _wipe_other():
            c = AsyncIOMotorClient(os.environ["MONGO_URL"])
            await c[os.environ["DB_NAME"]].makers.delete_one({"slug": other_slug})
            c.close()
        asyncio.run(_wipe_other())


def test_admin_can_read_any_listing_quality(listing_and_maker):
    _, listing_slug, _ = listing_and_maker
    admin_jwt = _make_admin_jwt()
    r = requests.get(
        f"{BASE_URL}/api/admin/listings/{listing_slug}/quality-score",
        headers={"Authorization": f"Bearer {admin_jwt}"}, timeout=20,
    )
    assert r.status_code == 200
    assert r.json()["version"] == "v1"


def test_scorecards_introspection_endpoint():
    r = requests.get(f"{BASE_URL}/api/quality/scorecards", timeout=15)
    assert r.status_code == 200
    cards = r.json()["scorecards"]
    pairs = [(c["algorithm"], c["version"]) for c in cards]
    assert ("listing_quality", "v1") in pairs


def test_404_for_unknown_listing():
    admin_jwt = _make_admin_jwt()
    r = requests.get(
        f"{BASE_URL}/api/admin/listings/__nonexistent__/quality-score",
        headers={"Authorization": f"Bearer {admin_jwt}"}, timeout=20,
    )
    assert r.status_code == 404
