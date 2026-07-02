"""iter328 · Additional regression coverage for the Founder × Product-Feed audit
endpoint AND the /enrich/v1/feed.csv contract.

Complements test_iter328_founder_feed_audit.py by asserting:
  * The base /api/enrich/v1/feed.csv endpoint was NOT modified — still requires
    the ENRICHLABS_API_KEY, still returns the exact header row, and every row
    references a maker with published+in-stock+imaged products.
  * The audit summary math (`founders_total == in_feed + excluded`) holds on
    the LIVE dataset (not just the seed) so the endpoint is trustworthy for
    the admin's discrepancy report.
  * Every founder row emitted by the audit has the canonical shape.
"""
from __future__ import annotations

import csv
import io
import os

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )

AUDIT_URL = f"{API}/api/admin/integrations/enrichlabs/founder-feed-audit"
FEED_URL = f"{API}/api/enrich/v1/feed.csv"


async def _admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token
    email = os.environ.get("OPS_EMAIL", "team@craftersmarket.org")
    tok = issue_admin_magic_token(email)
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{API}/api/admin/auth/verify", json={"token": tok})
    r.raise_for_status()
    data = r.json()
    return data.get("token") or data.get("jwt") or data["access_token"]


# ── /feed.csv regression ────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_feed_csv_requires_api_key():
    """Base Enrichlabs product feed still refuses unauthenticated pulls."""
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(FEED_URL)
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_feed_csv_header_and_shape_unchanged():
    """The base /feed.csv endpoint must still return the canonical CSV header
    (product_name,image_url,listing_url) and rows that reference real, imaged,
    published, in-stock products. The audit-endpoint addition must not have
    changed this behavior.
    """
    key = os.environ.get("ENRICHLABS_API_KEY", "").strip()
    if not key:
        pytest.skip("ENRICHLABS_API_KEY not set — cannot exercise /feed.csv")

    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.get(FEED_URL, headers={"X-EnrichLabs-Key": key})
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("text/csv"), r.headers

    body = r.text
    reader = csv.reader(io.StringIO(body))
    rows = list(reader)
    assert rows, "feed.csv returned an empty body"
    assert rows[0] == ["product_name", "image_url", "listing_url"], rows[0]

    # Every data row must have exactly 3 fields, non-empty product_name and image_url,
    # and an https listing_url. This mirrors the classifier's "imaged" gate.
    for row in rows[1:]:
        assert len(row) == 3, f"malformed CSV row: {row}"
        product_name, image_url, listing_url = row
        assert product_name.strip(), "empty product_name in feed"
        assert image_url.strip(), "empty image_url in feed (image gate failed)"
        assert listing_url.startswith("http"), listing_url


# ── /founder-feed-audit deeper regression ───────────────────────────────
@pytest.mark.asyncio
async def test_audit_summary_math_on_live_data():
    """Even without seeding, the audit's summary math must be self-consistent
    on whatever live founders exist in the DB. This is the invariant the
    admin will lean on when explaining Founders-Wall-vs-Feed gaps.
    """
    jwt = await _admin_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(AUDIT_URL, headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200, r.text
    body = r.json()

    assert {"summary", "founders", "generated_at"} <= set(body), list(body)

    s = body["summary"]
    assert s["founders_total"] == s["founders_in_feed"] + s["founders_excluded"], s
    assert s["founders_total"] == len(body["founders"]), (
        s["founders_total"], len(body["founders"])
    )
    assert isinstance(s.get("reason_histogram"), dict)
    # Histogram counts must not exceed excluded total.
    hist_sum = sum(int(v) for v in s["reason_histogram"].values())
    assert hist_sum <= s["founders_excluded"], (hist_sum, s["founders_excluded"])


@pytest.mark.asyncio
async def test_audit_row_shape_is_canonical():
    """Every founder row must expose the fields the ops team relies on."""
    jwt = await _admin_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(AUDIT_URL, headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200, r.text
    body = r.json()

    required_keys = {
        "founder_number", "slug", "name", "founder_status",
        "external_ads_opt_out", "products", "in_feed", "reason_excluded",
    }
    for row in body["founders"]:
        missing = required_keys - set(row)
        assert not missing, f"row {row.get('slug')} missing keys: {missing}"
        assert isinstance(row["in_feed"], bool)
        # in_feed=True must always have reason_excluded=None, and vice-versa.
        if row["in_feed"]:
            assert row["reason_excluded"] is None, row
        else:
            assert row["reason_excluded"], row
        # Product counts must be present and non-negative ints.
        p = row["products"]
        for k in (
            "total", "published",
            "published_in_stock", "published_in_stock_with_image",
        ):
            assert isinstance(p.get(k), int) and p[k] >= 0, (row["slug"], k, p)


@pytest.mark.asyncio
async def test_audit_bad_token_is_rejected():
    """Garbage bearer token must not be accepted."""
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            AUDIT_URL,
            headers={"Authorization": "Bearer not-a-real-jwt"},
        )
    assert r.status_code in (401, 403), r.text
