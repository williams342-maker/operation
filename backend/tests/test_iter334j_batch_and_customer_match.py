"""iter334j — Batch AI Price Check + Bing Customer Match hashed-email.

Covers:
  1. Hashed email helper produces the canonical SHA-256 of lower(trim(email)).
  2. `/api/checkout/status/{session_id}` returns `email_sha256` on paid txns.
  3. Batch endpoint creates a job row + returns a job_id.
  4. Batch endpoint reuses an in-flight job (`already_running`).
  5. Batch job-status endpoint returns the job for the owning maker only.
  6. Cross-maker job lookup returns 404 (security).
"""
from __future__ import annotations
import asyncio
import hashlib
import os
import uuid
from datetime import datetime, timezone

import pytest
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

pytestmark = pytest.mark.asyncio


def _canonical_hash(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


# ── checkout status email_sha256 ───────────────────────────────────────
async def test_checkout_status_returns_email_sha256_on_paid():
    """A paid transaction in `payment_transactions` should produce the
    canonical SHA-256 of the buyer's lower-trimmed email."""
    from core import db
    from server import app

    sid = f"cs_test_iter334j_{uuid.uuid4().hex[:12]}"
    raw_email = "  TestBuyer@Example.COM  "
    expected = _canonical_hash(raw_email)
    await db.payment_transactions.insert_one({
        "session_id": sid,
        "payment_status": "paid",
        "status": "complete",
        "amount": 145.0,
        "currency": "usd",
        "customer_email": raw_email,
        "items": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get(f"/api/checkout/status/{sid}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["payment_status"] == "paid"
        assert body["email_sha256"] == expected
        # Length sanity — SHA-256 hex is exactly 64 chars.
        assert len(body["email_sha256"]) == 64
    finally:
        await db.payment_transactions.delete_one({"session_id": sid})


async def test_checkout_status_omits_email_sha256_when_no_email():
    """If the transaction has no `customer_email`, the response should
    still succeed but with `email_sha256: null`."""
    from core import db
    from server import app

    sid = f"cs_test_iter334j_{uuid.uuid4().hex[:12]}"
    await db.payment_transactions.insert_one({
        "session_id": sid,
        "payment_status": "paid",
        "status": "complete",
        "amount": 12.5,
        "currency": "usd",
        "customer_email": "",     # explicit empty
        "items": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get(f"/api/checkout/status/{sid}")
        assert r.status_code == 200
        body = r.json()
        assert body.get("email_sha256") is None
    finally:
        await db.payment_transactions.delete_one({"session_id": sid})


# ── batch price-compare ────────────────────────────────────────────────
async def _make_test_maker(slug=None):
    from core import db
    slug = slug or f"batch-maker-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "Batch Maker", "email": f"{slug}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return slug


def _jwt(slug):
    from maker_auth import issue_session_jwt
    return issue_session_jwt(slug, f"{slug}@t.com")


async def test_batch_endpoint_creates_job_row():
    from core import db
    from server import app
    slug = await _make_test_maker()
    token = _jwt(slug)
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post("/api/maker/price-compare/batch", json={},
                              headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] in ("queued", "running")
        assert body["job_id"].startswith(f"batch-{slug}")
        # Job row exists in DB.
        job = await db.price_compare_jobs.find_one({"_id": body["job_id"]}, {"_id": 0})
        assert job is not None
        assert job["maker_slug"] == slug
        # Give the background task a beat to either finish or no-op (no published listings).
        await asyncio.sleep(0.3)
    finally:
        await db.makers.delete_one({"slug": slug})
        await db.price_compare_jobs.delete_many({"maker_slug": slug})


async def test_batch_endpoint_returns_already_running_on_double_invoke():
    """Concurrent batches per maker should collapse to a single job."""
    from core import db
    from server import app
    slug = await _make_test_maker()
    token = _jwt(slug)
    # Seed an in-flight job manually so the second POST hits the
    # `already_running` branch deterministically.
    job_id = f"batch-{slug}-{uuid.uuid4().hex[:10]}"
    await db.price_compare_jobs.insert_one({
        "_id": job_id, "maker_slug": slug, "status": "running",
        "total": 5, "completed": 2, "results": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "started_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post("/api/maker/price-compare/batch", json={},
                              headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "already_running"
        assert body["job_id"] == job_id
        assert body["completed"] == 2
    finally:
        await db.makers.delete_one({"slug": slug})
        await db.price_compare_jobs.delete_many({"maker_slug": slug})


async def test_job_status_404_for_other_maker():
    """Maker A should never see Maker B's job, even with a valid id."""
    from core import db
    from server import app
    a = await _make_test_maker("aaa-" + uuid.uuid4().hex[:6])
    b = await _make_test_maker("bbb-" + uuid.uuid4().hex[:6])
    token_b = _jwt(b)
    job_id = f"batch-{a}-{uuid.uuid4().hex[:10]}"
    await db.price_compare_jobs.insert_one({
        "_id": job_id, "maker_slug": a, "status": "done",
        "total": 0, "completed": 0, "results": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get(f"/api/maker/price-compare/jobs/{job_id}",
                             headers={"Authorization": f"Bearer {token_b}"})
        assert r.status_code == 404
    finally:
        await db.makers.delete_one({"slug": a})
        await db.makers.delete_one({"slug": b})
        await db.price_compare_jobs.delete_many({"_id": job_id})


async def test_job_status_404_for_unknown_id():
    from server import app
    slug = await _make_test_maker()
    token = _jwt(slug)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/maker/price-compare/jobs/batch-nope-nope",
                             headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 404
    finally:
        from core import db
        await db.makers.delete_one({"slug": slug})


async def test_batch_endpoint_requires_maker_jwt():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/maker/price-compare/batch", json={})
        assert r.status_code in (401, 403)
