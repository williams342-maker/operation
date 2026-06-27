"""iter413df — Impact Engine + Compass Coaching integration.

Locks:
  • Pure prioritization (Impact Engine ranking)
  • Per-rule effort + edit_link template registration
  • {slug} interpolation in edit_link
  • Coaching endpoints (maker-self / admin-any)
  • Compass automatically injects the coaching plan when a maker on a
    listing page asks for advice
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

import quality  # noqa: F401  — register rules
from quality.engine import evaluate, register_rule, RuleResult
from quality.impact import prioritize

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://active-project-4.preview.emergentagent.com"
).rstrip("/")


# ── Pure prioritization contract ──────────────────────────────────────
def test_perfect_listing_has_no_actions():
    subject = {
        "image": "x", "images": ["a","b","c","d","e"],
        "description": "a" * 320,
        "listing_video": {"url": "u"},
        "shipping_profile_id": "p",
        "title": "Hand-Forged Brass Pour Spout",
        "slug": "perfect-listing",
        "meta_description": "Sturdy hand-forged brass spout from Vermont. " * 2,
        "materials": ["brass", "leather", "linseed"],
    }
    card = evaluate("listing_quality", None, subject)
    plan = prioritize(card, identifier="perfect-listing")
    assert plan["actions"] == []
    assert plan["next_action"] is None
    assert "perfect score" in plan["summary"].lower()


def test_empty_listing_ranks_highest_points_first():
    """All rules failing — Impact Engine must rank by points_gain desc."""
    card = evaluate("listing_quality", "v1", {})
    plan = prioritize(card, identifier="iron-spout")
    assert plan["actions"], "expected ranked actions"
    # points_gain must be non-increasing
    gains = [a["points_gain"] for a in plan["actions"]]
    assert gains == sorted(gains, reverse=True), gains
    # next_action == first action
    assert plan["next_action"]["rule_id"] == plan["actions"][0]["rule_id"]


def test_edit_link_interpolates_slug():
    card = evaluate("listing_quality", "v1", {})
    plan = prioritize(card, identifier="iron-spout")
    for a in plan["actions"]:
        # Listing rules all have edit_link_template — must be interpolated.
        assert "/maker/listings/iron-spout/edit#" in a["edit_link"], a


def test_edit_link_blank_when_no_identifier():
    card = evaluate("listing_quality", "v1", {})
    plan = prioritize(card, identifier=None)
    for a in plan["actions"]:
        assert a["edit_link"] == ""


def test_low_effort_beats_high_effort_at_equal_points_and_impact():
    """When two failing rules would give the same points AND same impact,
    the lower-effort one wins. We register two synthetic rules to control
    the variables precisely."""
    @register_rule(
        algorithm="iter413df_efforttest", version="v1",
        rule_id="hard_win", weight=10, label="Hard win",
        default_effort="high",
    )
    def hard(_):
        return RuleResult(passed=False, score=0,
                           recommendation="hard", estimated_impact="medium")

    @register_rule(
        algorithm="iter413df_efforttest", version="v1",
        rule_id="easy_win", weight=10, label="Easy win",
        default_effort="low",
    )
    def easy(_):
        return RuleResult(passed=False, score=0,
                           recommendation="easy", estimated_impact="medium")

    card = evaluate("iter413df_efforttest", "v1", {})
    plan = prioritize(card)
    # Same points (10), same impact (medium) — easy (low effort) wins.
    assert plan["next_action"]["rule_id"] == "easy_win", plan["actions"]


def test_partial_listing_summary_mentions_top_recommendation():
    """The summary string must surface the highest-leverage move so the
    dashboard hero AND Compass can use the same one-liner."""
    subject = {
        "image": "x",
        "images": ["a", "b"],   # photo_count failing
        "description": "a" * 320,
        "shipping_profile_id": "p",
        "title": "Brass Spout",
        "slug": "brass-spout",
        "meta_description": "x" * 100,
        "materials": ["brass", "leather", "linseed"],
        # NO listing_video — highest single-rule loss (15 pts).
    }
    card = evaluate("listing_quality", "v1", subject)
    plan = prioritize(card, identifier="brass-spout")
    # The biggest gain at 15 pts (product_video) should be quoted.
    assert "60-second product video" in plan["summary"] or "video" in plan["summary"].lower(), plan["summary"]


# ── HTTP endpoint contract ────────────────────────────────────────────
@pytest.fixture()
def listing_owner():
    from motor.motor_asyncio import AsyncIOMotorClient
    from maker_auth import issue_magic_token
    maker_slug = f"impact-{uuid.uuid4().hex[:6]}"
    email = f"{maker_slug}@test.com"
    listing_slug = f"impact-{uuid.uuid4().hex[:8]}"

    async def _seed():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.makers.insert_one({
            "id": str(uuid.uuid4()), "slug": maker_slug, "email": email,
            "name": "Impact Test", "shop_name": "Impact Test", "initials": "IT",
            "status": "approved", "tier": "standard",
            "subscription_status": "free", "session_version": 0,
        })
        await db.products.insert_one({
            "id": str(uuid.uuid4()), "slug": listing_slug,
            "maker_slug": maker_slug,
            "title": "Brass Pour Spout",
            "description": "Tiny.",  # < 40 chars — fails description
            "image": "https://cdn/x.jpg",
            "images": ["a"],
            "shipping_profile_id": None,
            "meta_description": "",
            "materials": [],
            "deleted_at": None,
        })
        c.close()
    asyncio.run(_seed())

    tok = issue_magic_token(email)
    jwt = requests.post(f"{BASE_URL}/api/maker/auth/verify",
                        json={"token": tok}, timeout=15).json()["token"]
    yield maker_slug, listing_slug, jwt

    async def _wipe():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.makers.delete_one({"slug": maker_slug})
        await db.products.delete_one({"slug": listing_slug})
        c.close()
    asyncio.run(_wipe())


def test_coaching_endpoint_returns_ranked_actions(listing_owner):
    _, listing_slug, jwt = listing_owner
    r = requests.get(
        f"{BASE_URL}/api/maker/listings/{listing_slug}/coaching",
        headers={"Authorization": f"Bearer {jwt}"}, timeout=20,
    )
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["algorithm"] == "listing_quality"
    assert plan["version"] == "v1"
    assert plan["next_action"] is not None
    assert plan["next_action"]["points_gain"] > 0
    assert "/maker/listings/" in plan["next_action"]["edit_link"]
    # Action set must include points_gain + effort + impact (all the
    # fields the dashboard/Compass need).
    for a in plan["actions"]:
        assert {"rule_id", "label", "recommendation", "points_gain",
                "estimated_impact", "effort", "edit_link"}.issubset(a.keys())


def test_coaching_endpoint_owner_gated(listing_owner):
    _, listing_slug, _ = listing_owner
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
        other_jwt = requests.post(f"{BASE_URL}/api/maker/auth/verify",
                                  json={"token": tok}, timeout=15).json()["token"]
        r = requests.get(
            f"{BASE_URL}/api/maker/listings/{listing_slug}/coaching",
            headers={"Authorization": f"Bearer {other_jwt}"}, timeout=20,
        )
        assert r.status_code == 403
    finally:
        async def _wipe():
            c = AsyncIOMotorClient(os.environ["MONGO_URL"])
            await c[os.environ["DB_NAME"]].makers.delete_one({"slug": other_slug})
            c.close()
        asyncio.run(_wipe())


def test_admin_coaching_endpoint(listing_owner):
    from maker_auth import issue_admin_magic_token
    _, listing_slug, _ = listing_owner
    tok = issue_admin_magic_token("team@craftersmarket.org")
    admin_jwt = requests.post(f"{BASE_URL}/api/admin/auth/verify",
                              json={"token": tok}, timeout=15).json()["token"]
    r = requests.get(
        f"{BASE_URL}/api/admin/listings/{listing_slug}/coaching",
        headers={"Authorization": f"Bearer {admin_jwt}"}, timeout=20,
    )
    assert r.status_code == 200
    plan = r.json()
    assert plan["version"] == "v1"
    assert plan["next_action"] is not None


# ── Compass auto-coaching integration ────────────────────────────────
def test_compass_loads_coaching_from_page_url(listing_owner):
    """Maker asking 'how do I improve this listing?' on the edit page
    must get an answer that quotes the next_action AND surfaces the
    edit_link — proving the prompt-side coaching injection works."""
    _, listing_slug, _ = listing_owner
    r = requests.post(
        f"{BASE_URL}/api/help/chat",
        json={
            "message": "How can I improve this listing? What should I do next to make a sale?",
            "user_role": "maker",
            "page_url": f"/maker/listings/{listing_slug}/edit",
        },
        timeout=60,
    )
    assert r.status_code == 200, r.text
    reply = r.json()["reply"].lower()
    # Compass must reference at least one concrete recommendation
    # (the seeded listing fails MANY rules — we expect the LLM to
    # quote at least one of them).
    coaching_signals = [
        "video", "photo", "description", "materials",
        "shipping", "seo", "meta", "title",
    ]
    assert any(s in reply for s in coaching_signals), (
        f"Compass coaching reply lacked any rule keyword: {reply[:300]!r}"
    )
    # Must include the deep-link.
    assert f"/maker/listings/{listing_slug}/edit#" in r.json()["reply"], (
        f"Compass coaching reply lacked deep-link: {r.json()['reply'][:400]!r}"
    )


def test_compass_no_coaching_for_visitor(listing_owner):
    """A visitor (not authenticated as the maker) must NOT receive
    the listing's coaching block — privacy + relevance guardrail."""
    _, listing_slug, _ = listing_owner
    r = requests.post(
        f"{BASE_URL}/api/help/chat",
        json={
            "message": "What should I do to improve this listing?",
            "user_role": "visitor",
            "page_url": f"/maker/listings/{listing_slug}/edit",
        },
        timeout=60,
    )
    assert r.status_code == 200
    reply = r.json()["reply"]
    # Listing-specific deep-link must NOT appear for non-makers.
    assert f"/maker/listings/{listing_slug}/edit#" not in reply
