"""End-to-end regression for maker CSV review imports (iter183).

Walks the full lifecycle:
  1. Maker logs in and uploads a CSV.
  2. Inserted rows show up in db.reviews tagged with source + batch_id.
  3. Re-uploading the same CSV skips every row as a duplicate.
  4. PATCH ?published_publicly=false flips visibility; GET /api/reviews
     stops returning the imported rows (but native rows still appear).
  5. DELETE removes the entire batch — both reviews + batch summary.
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


async def _maker_jwt(maker_slug: str = "williams-cnc") -> str:
    """Mint a maker JWT directly so we don't depend on Mailgun or
    magic-link plumbing in CI."""
    from maker_auth import issue_session_jwt
    return issue_session_jwt(maker_slug, f"{maker_slug}@test.local")


CSV_BODY = (
    "Date,Buyer Username,Rating,Review,Item\n"
    "2025-08-12,sarah_b,5,Absolutely stunning craftsmanship - shipped fast!,custom-metal-sign-eagle\n"
    "2025-09-01,Tony R.,4,Solid piece. Minor scratch on arrival but maker fixed it.,patriot-flag\n"
    "2025-09-15,mike_d,5,Worth every penny - second order incoming.,\n"
    "bad row no rating,,,,\n"
    "2025-10-05,Lena,5 stars,Etsy customer here - finally on a real marketplace!,wedding-gift-cross\n"
    "2025-10-12,Riley,5,,custom-sign-2\n"      # star-only — now imports cleanly
)


def _csv_file(body: str = CSV_BODY) -> tuple:
    return ("export.csv", io.BytesIO(body.encode("utf-8")), "text/csv")


@pytest.mark.asyncio
async def test_csv_import_full_lifecycle():
    jwt = await _maker_jwt()
    headers = {"Authorization": f"Bearer {jwt}"}

    # ── 1. Upload ────────────────────────────────────────────────
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import",
            headers=headers,
            files={"file": _csv_file()},
            data={"source": "etsy", "published_publicly": "true"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inserted"] == 5, body              # 5 valid rows (incl star-only Riley); 1 bad skipped
    assert body["skipped_duplicates"] == 0
    assert body["error_count"] >= 1                 # the malformed row
    assert body["source"] == "etsy"
    batch_id = body["batch_id"]

    # ── 2. Reviews land in the maker's feed with source tag ─────
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{API}/api/reviews",
            params={"maker_slug": "williams-cnc", "limit": 50},
        )
    public_rows = r.json()
    imported = [row for row in public_rows if row.get("imported_batch_id") == batch_id]
    assert len(imported) == 5, f"expected 5 imported rows, got {len(imported)}"
    assert all(row["source"] == "etsy" for row in imported)
    assert all(row["published_publicly"] is True for row in imported)
    # Rating parsing: "5 stars" → 5
    assert any(row["name"] == "Lena" and row["rating"] == 5 for row in imported)
    # Star-only placeholder lands as a clean review
    riley = next((r for r in imported if r["name"] == "Riley"), None)
    assert riley is not None and "no comment" in riley["text"].lower()

    # ── 3. Re-uploading the same CSV → all rows dedupe ───────────
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import",
            headers=headers,
            files={"file": _csv_file()},
            data={"source": "etsy", "published_publicly": "true"},
        )
    body2 = r.json()
    assert body2["inserted"] == 0, body2
    assert body2["skipped_duplicates"] == 5

    # ── 4. Hide the batch → public reviews drop those rows ───────
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.patch(
            f"{API}/api/maker/reviews/imports/{batch_id}",
            headers=headers,
            json={"published_publicly": False},
        )
    assert r.status_code == 200, r.text

    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{API}/api/reviews",
            params={"maker_slug": "williams-cnc", "limit": 100},
        )
    after_hide = r.json()
    assert not any(row.get("imported_batch_id") == batch_id for row in after_hide), \
        "Hidden batch must not appear in public /api/reviews response"

    # ── 5. List shows the batch ──────────────────────────────────
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/maker/reviews/imports", headers=headers)
    listing = r.json()
    assert any(b["batch_id"] == batch_id for b in listing["items"])

    # ── 6. Delete the batch → all rows + summary gone ────────────
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.delete(
            f"{API}/api/maker/reviews/imports/{batch_id}", headers=headers,
        )
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == 5

    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/maker/reviews/imports", headers=headers)
    listing_after = r.json()
    assert not any(b["batch_id"] == batch_id for b in listing_after["items"])


@pytest.mark.asyncio
async def test_csv_import_rejects_missing_columns():
    jwt = await _maker_jwt()
    headers = {"Authorization": f"Bearer {jwt}"}
    bad = "foo,bar,baz\n1,2,3\n"
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import",
            headers=headers,
            files={"file": ("bad.csv", io.BytesIO(bad.encode()), "text/csv")},
        )
    assert r.status_code == 422
    assert "missing required columns" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_csv_import_requires_maker_auth():
    """No JWT → 401."""
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import",
            files={"file": _csv_file()},
        )
    assert r.status_code in (401, 403)



# ───── Etsy JSON support (iter187) ─────────────────────────────────────────

ETSY_JSON_BODY = (
    '[\n'
    '  {"reviewer": "Suann", "date_reviewed": "11/02/2025", "star_rating": 5,'
    '   "message": "Knife was beautifully made", "order_id": 3753700265},\n'
    '  {"reviewer": "Eugen", "date_reviewed": "10/16/2025", "star_rating": 1,'
    '   "message": "Verloren gegangen", "order_id": 3742003137},\n'
    '  {"reviewer": "Brian", "date_reviewed": "09/30/2025", "star_rating": 5,'
    '   "message": "", "order_id": 3700000000},\n'
    '  {"reviewer": "", "date_reviewed": "09/29/2025", "star_rating": 5,'
    '   "message": "Anonymous review", "order_id": 3700000001}\n'
    ']\n'
)


@pytest.mark.asyncio
async def test_json_import_etsy_native_format():
    """Etsy's native export is JSON (not CSV) — verify the JSON path
    handles every Etsy field name correctly + treats missing `message`
    as a 5-star placeholder instead of an error."""
    jwt = await _maker_jwt()
    headers = {"Authorization": f"Bearer {jwt}"}
    from core import db
    await db.reviews.delete_many({"maker_slug": "williams-cnc",
                                  "source": {"$ne": None}})
    await db.review_import_batches.delete_many({"maker_slug": "williams-cnc"})

    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import",
            headers=headers,
            files={"file": ("reviews.json",
                            io.BytesIO(ETSY_JSON_BODY.encode()),
                            "application/json")},
            data={"source": "etsy"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    # 3 valid rows: Suann, Eugen, Brian (Brian's empty message → placeholder).
    # 4th row is missing the reviewer → counted as an error.
    assert body["inserted"] == 3, body
    assert body["error_count"] == 1
    assert body["source"] == "etsy"

    # Brian got the star-only placeholder
    rows = await db.reviews.find(
        {"maker_slug": "williams-cnc", "name": "Brian"},
        {"_id": 0, "text": 1},
    ).to_list(1)
    assert rows and "no comment" in rows[0]["text"].lower()

    # Cleanup
    await db.reviews.delete_many({"maker_slug": "williams-cnc",
                                  "source": {"$ne": None}})
    await db.review_import_batches.delete_many({"maker_slug": "williams-cnc"})


@pytest.mark.asyncio
async def test_json_import_handles_wrapped_object():
    """Some platforms wrap the array: `{"reviews": [...]}`. Verify we unwrap."""
    jwt = await _maker_jwt()
    headers = {"Authorization": f"Bearer {jwt}"}
    from core import db
    await db.reviews.delete_many({"maker_slug": "williams-cnc",
                                  "source": {"$ne": None}})

    body = (
        '{"reviews": [{"reviewer": "Wrapped-' + uuid.uuid4().hex[:6] + '",'
        ' "star_rating": 4, "message": "Found in nested key",'
        ' "date_reviewed": "2025-07-01"}]}'
    )
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import",
            headers=headers,
            files={"file": ("wrapped.json", io.BytesIO(body.encode()),
                            "application/json")},
        )
    assert r.status_code == 200, r.text
    assert r.json()["inserted"] == 1

    # Cleanup
    await db.reviews.delete_many({"maker_slug": "williams-cnc",
                                  "source": {"$ne": None}})


@pytest.mark.asyncio
async def test_json_import_rejects_malformed():
    jwt = await _maker_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import",
            headers={"Authorization": f"Bearer {jwt}"},
            files={"file": ("bad.json",
                            io.BytesIO(b"{not valid json"),
                            "application/json")},
        )
    assert r.status_code == 400
    assert "json parse error" in r.json()["detail"].lower()
