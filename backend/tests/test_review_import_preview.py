"""Regression: review-import preview endpoint (iter188).

The preview endpoint shares 95% of the import endpoint's pipeline but
writes nothing to Mongo. We verify:
  * Auth gate
  * Returns expected schema (format, totals, sample[≤5], errors)
  * No db.reviews / db.review_import_batches rows land
  * Detects format from filename extension AND content sniff
  * `would_skip_duplicate` correctly counts against existing imports
"""
import io
import uuid

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


async def _maker_jwt(slug: str = "williams-cnc") -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(slug, f"{slug}@test.local")


def _csv_body(seed: str) -> bytes:
    """5 rows seeded with a per-test uuid so reruns don't dedupe each other."""
    return (
        f"Date,Buyer Username,Rating,Review,Item\n"
        f"2025-08-12,Alice {seed},5,Stunning {seed} #1,sign-1\n"
        f"2025-09-01,Bob {seed},4,Solid {seed} #2,sign-2\n"
        f"2025-09-15,Carol {seed},5,,sign-3\n"
        f"bad row no rating,,,,\n"
        f"2025-10-05,Dan {seed},5,Great {seed} #4,sign-4\n"
    ).encode()


@pytest.mark.asyncio
async def test_preview_requires_auth():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import/preview",
            files={"file": ("x.csv", io.BytesIO(b"name,rating,text\nA,5,X\n"), "text/csv")},
        )
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_preview_returns_schema_and_writes_nothing():
    """Run preview, then assert no review/batch rows landed for this maker."""
    seed = uuid.uuid4().hex[:8]
    body = _csv_body(seed)

    jwt = await _maker_jwt()
    from core import db
    review_count_before = await db.reviews.count_documents({"maker_slug": "williams-cnc"})
    batch_count_before = await db.review_import_batches.count_documents({"maker_slug": "williams-cnc"})

    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import/preview",
            headers={"Authorization": f"Bearer {jwt}"},
            files={"file": (f"x-{seed}.csv", io.BytesIO(body), "text/csv")},
        )
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["format"] == "csv"
    assert res["total_rows"] >= 4
    assert res["would_insert"] == 4   # Carol star-only → placeholder; bad row excluded
    assert res["would_skip_duplicate"] == 0   # never imported this seed
    assert res["error_count"] >= 1
    assert 1 <= len(res["sample"]) <= 5

    # First sample row is Alice with 5★.
    s0 = res["sample"][0]
    assert s0["name"].startswith("Alice")
    assert s0["rating"] == 5

    # Carol's row should be flagged was_starred_placeholder=True.
    placeholders = [s for s in res["sample"] if s["was_starred_placeholder"]]
    assert placeholders, "star-only row missing was_starred_placeholder flag"

    # No rows landed.
    review_count_after = await db.reviews.count_documents({"maker_slug": "williams-cnc"})
    batch_count_after = await db.review_import_batches.count_documents({"maker_slug": "williams-cnc"})
    assert review_count_after == review_count_before
    assert batch_count_after == batch_count_before


@pytest.mark.asyncio
async def test_preview_detects_json_from_content_sniff():
    """Filename `.txt` but JSON-shaped content → format still detected as JSON."""
    body = (
        b'[{"reviewer":"Pat","star_rating":5,"message":"good",'
        b'"date_reviewed":"2025-01-01"}]'
    )
    jwt = await _maker_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import/preview",
            headers={"Authorization": f"Bearer {jwt}"},
            files={"file": ("export.txt", io.BytesIO(body), "text/plain")},
        )
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["format"] == "json"
    assert res["would_insert"] == 1


@pytest.mark.asyncio
async def test_preview_counts_existing_duplicates():
    """Import once, then preview the same file → would_skip_duplicate == row count."""
    seed = uuid.uuid4().hex[:8]
    body = _csv_body(seed)
    jwt = await _maker_jwt()
    h = {"Authorization": f"Bearer {jwt}"}

    # Real import.
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import",
            headers=h,
            files={"file": (f"x-{seed}.csv", io.BytesIO(body), "text/csv")},
            data={"source": "etsy"},
        )
    assert r.status_code == 200, r.text
    batch_id = r.json()["batch_id"]
    inserted = r.json()["inserted"]
    assert inserted >= 4

    # Preview against the same file → would_skip_duplicate should equal inserted.
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import/preview",
            headers=h,
            files={"file": (f"x-{seed}.csv", io.BytesIO(body), "text/csv")},
        )
    res = r.json()
    assert res["would_insert"] == 0
    assert res["would_skip_duplicate"] == inserted

    # Cleanup
    async with httpx.AsyncClient(timeout=30) as c:
        await c.delete(f"{API}/api/maker/reviews/imports/{batch_id}", headers=h)
