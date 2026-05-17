"""Tests for the weekly social-momentum digest job (iter149).

Covers:
  • Aggregates share_events by maker → emails the right makers
  • Quiet on zero — no email if a maker has 0 shares
  • Honors `social_momentum_opt_out`
  • ISO-week idempotency — re-running in the same week is a no-op
  • Top listings ranked desc by share count

Email send is monkey-patched to a capture list so we never hit Mailgun
from CI. Maker + product fixtures use a unique slug suffix per test so
parallel runs don't fight.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")


# Capture list reset by `_reset_capture` autouse fixture.
_captured_sends: list = []


@pytest.fixture(autouse=True)
def _reset_capture(monkeypatch):
    _captured_sends.clear()

    async def _fake_send(**kw):
        _captured_sends.append(kw)
        return {"status": 200, "captured": True}

    # Patch the actual email transport so nothing leaves the test box.
    import email_service
    monkeypatch.setattr(email_service, "send_social_momentum_digest", _fake_send)
    yield


async def _seed_maker(slug_suffix: str, opt_out: bool = False) -> str:
    from core import db
    slug = f"itest-maker-{slug_suffix}"
    await db.makers.delete_many({"slug": slug})
    await db.makers.insert_one({
        "slug": slug,
        "name": f"Test Maker {slug_suffix}",
        "email": f"{slug}@example.test",
        "social_momentum_opt_out": opt_out,
    })
    return slug


async def _seed_product(maker_slug: str, suffix: str, title: str = "Test product"):
    from core import db
    slug = f"itest-listing-{suffix}"
    await db.products.delete_many({"slug": slug})
    await db.products.insert_one({
        "slug": slug,
        "maker_slug": maker_slug,
        "title": title,
    })
    return slug


async def _seed_shares(slug: str, count: int):
    from core import db
    now = datetime.now(timezone.utc)
    docs = [{
        "kind": "product",
        "slug": slug,
        "ip_hash": f"hash-{i:02d}",
        "created_at": (now - timedelta(hours=i + 1)).isoformat(),
    } for i in range(count)]
    await db.share_events.insert_many(docs)


async def _cleanup(*items):
    from core import db
    for s in items:
        await db.makers.delete_many({"slug": s})
        await db.products.delete_many({"maker_slug": s})
        await db.products.delete_many({"slug": s})
        await db.share_events.delete_many({"slug": s})


@pytest.mark.asyncio
async def test_digest_emails_makers_with_shares():
    """Maker with 5 shares gets emailed; details match aggregation."""
    sfx = uuid.uuid4().hex[:8]
    maker_slug = await _seed_maker(sfx)
    listing = await _seed_product(maker_slug, sfx, title="Awesome Walnut Sign")
    await _seed_shares(listing, count=5)

    try:
        from social_momentum import run_weekly_social_momentum_digest
        result = await run_weekly_social_momentum_digest()

        assert result["makers_emailed"] == 1
        assert len(_captured_sends) == 1
        sent = _captured_sends[0]
        assert sent["email"] == f"{maker_slug}@example.test"
        assert sent["maker_slug"] == maker_slug
        assert sent["total_shares"] == 5
        assert len(sent["top_listings"]) == 1
        assert sent["top_listings"][0]["count"] == 5
        assert sent["top_listings"][0]["title"] == "Awesome Walnut Sign"
    finally:
        await _cleanup(maker_slug, listing)


@pytest.mark.asyncio
async def test_digest_quiet_on_zero():
    """A maker with no shares in the window MUST NOT receive an email."""
    sfx = uuid.uuid4().hex[:8]
    maker_slug = await _seed_maker(sfx)
    # No shares seeded — maker exists but has no activity.
    try:
        from social_momentum import run_weekly_social_momentum_digest
        result = await run_weekly_social_momentum_digest()
        assert result["makers_emailed"] == 0
        assert _captured_sends == []
    finally:
        await _cleanup(maker_slug)


@pytest.mark.asyncio
async def test_digest_honors_opt_out():
    """`social_momentum_opt_out=True` blocks the email entirely."""
    sfx = uuid.uuid4().hex[:8]
    maker_slug = await _seed_maker(sfx, opt_out=True)
    listing = await _seed_product(maker_slug, sfx)
    await _seed_shares(listing, count=3)

    try:
        from social_momentum import run_weekly_social_momentum_digest
        result = await run_weekly_social_momentum_digest()
        assert result["makers_emailed"] == 0
        assert result["skipped_opt_out"] >= 1
        assert _captured_sends == []
    finally:
        await _cleanup(maker_slug, listing)


@pytest.mark.asyncio
async def test_digest_idempotent_within_iso_week():
    """Running the digest twice in the same week sends only once."""
    sfx = uuid.uuid4().hex[:8]
    maker_slug = await _seed_maker(sfx)
    listing = await _seed_product(maker_slug, sfx)
    await _seed_shares(listing, count=2)

    try:
        from social_momentum import run_weekly_social_momentum_digest
        r1 = await run_weekly_social_momentum_digest()
        assert r1["makers_emailed"] == 1

        # Run again — should be a no-op (no second email).
        r2 = await run_weekly_social_momentum_digest()
        assert r2["makers_emailed"] == 0
        assert r2["skipped_already_sent"] >= 1
        assert len(_captured_sends) == 1, \
            f"Expected exactly one send across two runs, got {len(_captured_sends)}"
    finally:
        await _cleanup(maker_slug, listing)


@pytest.mark.asyncio
async def test_top_listings_ranked_desc_by_count():
    """Two listings under one maker — ranking respects share count."""
    sfx = uuid.uuid4().hex[:8]
    maker_slug = await _seed_maker(sfx)
    hi = await _seed_product(maker_slug, f"{sfx}-hi", title="High Volume")
    lo = await _seed_product(maker_slug, f"{sfx}-lo", title="Low Volume")
    await _seed_shares(hi, count=7)
    await _seed_shares(lo, count=2)

    try:
        from social_momentum import run_weekly_social_momentum_digest
        await run_weekly_social_momentum_digest()
        assert len(_captured_sends) == 1
        top = _captured_sends[0]["top_listings"]
        assert top[0]["slug"] == hi
        assert top[0]["count"] == 7
        assert top[1]["slug"] == lo
        assert top[1]["count"] == 2
    finally:
        await _cleanup(maker_slug, hi, lo)
