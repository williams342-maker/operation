"""iter453 — Digital Products Phase 4 + Maker Agreement tests."""
import io
import uuid
import zipfile
from datetime import datetime, timezone

import pytest
import pytest_asyncio

from httpx import ASGITransport, AsyncClient
from server import app
from core import db, now_iso
from maker_auth import issue_session_jwt
from routers.digital_products import scan_digital_file

PFX = "digitest"
pytestmark = pytest.mark.asyncio
M1 = f"{PFX}-forge"
M2 = f"{PFX}-rival"
AUTH = {"Authorization": f"Bearer {issue_session_jwt(M1, f'{M1}@t.co', role='maker')}"}
AUTH2 = {"Authorization": f"Bearer {issue_session_jwt(M2, f'{M2}@t.co', role='maker')}"}
BUYER_EMAIL = f"{PFX}-buyer@t.co"
BUYER = {"Authorization": f"Bearer {issue_session_jwt('buyer', BUYER_EMAIL, role='buyer')}"}


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def _clean():
    async def wipe():
        rx = {"$regex": f"^{PFX}-"}
        await db.products.delete_many({"maker_slug": rx})
        await db.makers.delete_many({"slug": rx})
        await db.digital_upload_sessions.delete_many({"maker_slug": rx})
        await db.payment_transactions.delete_many({"session_id": rx})
        await db.download_history.delete_many({"session_id": rx})
        await db.maker_agreement_acceptances.delete_many({"maker_slug": rx})
        await db.community_users.delete_many({"email": BUYER_EMAIL})
    await wipe()
    for m in (M1, M2):
        await db.makers.insert_one(
            {"slug": m, "name": m, "email": f"{m}@t.co", "created_at": now_iso()})
    yield
    await wipe()


async def _prod(maker=M1, listing_type="digital", files=None, **extra):
    slug = f"{PFX}-{uuid.uuid4().hex[:8]}"
    await db.products.insert_one({
        "id": uuid.uuid4().hex, "slug": slug, "title": "Digital Thing",
        "price": 12.0, "maker_slug": maker, "status": "published",
        "listing_type": listing_type, "digital_files": files or [],
        "created_at": now_iso(), **extra})
    return slug


# ── Heuristic scanner ─────────────────────────────────────────────────────────

def _zip_bytes(members: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in members.items():
            z.writestr(name, data)
    return buf.getvalue()


def test_scan_accepts_valid_files():
    assert scan_digital_file(b"%PDF-1.7 rest", "pdf")[0] == "clean"
    assert scan_digital_file(b"\x89PNG\r\n\x1a\n data", "png")[0] == "clean"
    assert scan_digital_file(b"solid cube\nfacet normal", "stl")[0] == "clean"
    assert scan_digital_file(_zip_bytes({"design.svg": b"<svg/>"}), "zip")[0] == "clean"


def test_scan_blocks_threats():
    assert scan_digital_file(b"MZ\x90\x00 pe payload", "pdf")[0] == "blocked"
    assert scan_digital_file(b"#!/bin/sh\nrm -rf /", "svg")[0] == "blocked"
    assert scan_digital_file(b"GIF89a not a pdf", "pdf")[0] == "blocked"
    s, r = scan_digital_file(_zip_bytes({"tool.exe": b"MZ junk"}), "zip")
    assert s == "blocked" and ".exe" in r
    assert scan_digital_file(b"", "pdf")[0] == "blocked"


# ── Chunked upload flow ───────────────────────────────────────────────────────

async def _chunked_upload(client, slug, filename, data, chunks=2,
                          replace_file_id=None, release_notes=None):
    n = max(1, chunks)
    r = await client.post(f"/api/maker/listings/{slug}/digital-uploads/init",
                          json={"filename": filename, "size_bytes": len(data),
                                "total_chunks": n,
                                "replace_file_id": replace_file_id,
                                "release_notes": release_notes},
                          headers=AUTH)
    if r.status_code != 200:
        return r
    uid = r.json()["upload_id"]
    size = (len(data) + n - 1) // n
    for i in range(n):
        rr = await client.put(
            f"/api/maker/listings/{slug}/digital-uploads/{uid}/chunks/{i}",
            content=data[i * size:(i + 1) * size],
            headers={**AUTH, "Content-Type": "application/octet-stream"})
        assert rr.status_code == 200
    return await client.post(
        f"/api/maker/listings/{slug}/digital-uploads/{uid}/complete", headers=AUTH)


async def test_chunked_upload_end_to_end(client):
    slug = await _prod()
    data = b"%PDF-1.7 " + b"x" * 5000
    r = await _chunked_upload(client, slug, "plans.pdf", data, chunks=3)
    assert r.status_code == 200
    entry = r.json()
    assert entry["version"] == 1 and entry["scan"]["status"] == "clean"
    assert entry["size_bytes"] == len(data)
    prod = await db.products.find_one({"slug": slug}, {"_id": 0, "digital_files": 1})
    assert len(prod["digital_files"]) == 1


async def test_upload_rejects_bad_ext_and_blocked_content(client):
    slug = await _prod()
    r = await client.post(f"/api/maker/listings/{slug}/digital-uploads/init",
                          json={"filename": "virus.exe", "size_bytes": 10,
                                "total_chunks": 1}, headers=AUTH)
    assert r.status_code == 400
    r = await _chunked_upload(client, slug, "fake.pdf", b"MZ evil payload", chunks=1)
    assert r.status_code == 422 and "security scan" in r.json()["detail"]
    prod = await db.products.find_one({"slug": slug}, {"_id": 0, "digital_files": 1})
    assert prod["digital_files"] == []


async def test_upload_enforces_ownership_and_file_cap(client):
    slug = await _prod(maker=M2)
    r = await client.post(f"/api/maker/listings/{slug}/digital-uploads/init",
                          json={"filename": "a.pdf", "size_bytes": 10,
                                "total_chunks": 1}, headers=AUTH)
    assert r.status_code == 403
    files = [{"id": uuid.uuid4().hex, "filename": f"f{i}.pdf", "url": "u",
              "ext": "pdf"} for i in range(5)]
    slug2 = await _prod(files=files)
    r = await client.post(f"/api/maker/listings/{slug2}/digital-uploads/init",
                          json={"filename": "one-more.pdf", "size_bytes": 10,
                                "total_chunks": 1}, headers=AUTH)
    assert r.status_code == 400 and "Maximum 5" in r.json()["detail"]


async def test_versioned_replace_with_release_notes(client):
    slug = await _prod()
    r = await _chunked_upload(client, slug, "v1.pdf", b"%PDF-1.7 first", chunks=1)
    fid = r.json()["id"]
    r = await _chunked_upload(client, slug, "v2.pdf", b"%PDF-1.7 second edition",
                              chunks=1, replace_file_id=fid,
                              release_notes="Fixed kerf widths")
    assert r.status_code == 200
    e = r.json()
    assert e["id"] == fid and e["version"] == 2
    assert len(e["versions"]) == 2
    assert e["versions"][1]["release_notes"] == "Fixed kerf widths"
    assert e["versions"][0]["version"] == 1  # history preserved


async def test_digital_settings_patch(client):
    slug = await _prod()
    r = await client.patch(f"/api/maker/listings/{slug}/digital-settings",
                           json={"download_limit": 10, "download_ttl_days": 60},
                           headers=AUTH)
    assert r.status_code == 200
    assert r.json()["download_limit"] == 10 and r.json()["download_ttl_days"] == 60
    r = await client.patch(f"/api/maker/listings/{slug}/digital-settings",
                           json={"clear_limit": True}, headers=AUTH)
    assert r.json()["download_limit"] is None


# ── Buyer purchases + downloads ───────────────────────────────────────────────

async def _paid_tx(product_slug, file_id, email=BUYER_EMAIL, downloads=0):
    sid = f"{PFX}-sess-{uuid.uuid4().hex[:8]}"
    await db.payment_transactions.insert_one({
        "session_id": sid, "payment_status": "paid", "amount": 12.0,
        "customer_email": email, "created_at": now_iso(),
        "summary": "Digital Thing",
        "digital_downloads": [{
            "file_id": file_id, "filename": "plans.pdf", "ext": "pdf",
            "size_bytes": 1000, "product_slug": product_slug,
            "product_title": "Digital Thing", "downloads": downloads}]})
    return sid


async def test_buyer_purchases_scoped_to_email(client):
    fid = uuid.uuid4().hex
    slug = await _prod(files=[{"id": fid, "filename": "plans.pdf", "ext": "pdf",
                               "url": "https://cdn.example/x.pdf"}])
    mine = await _paid_tx(slug, fid)
    await _paid_tx(slug, fid, email="someone-else@t.co")
    r = await client.get("/api/buyer/purchases", headers=BUYER)
    assert r.status_code == 200
    ids = [p["session_id"] for p in r.json()["purchases"]]
    assert mine in ids and len(ids) == 1
    r = await client.get("/api/buyer/purchases")
    assert r.status_code in (401, 403)


async def test_buyer_fresh_links_and_ownership(client):
    fid = uuid.uuid4().hex
    slug = await _prod(files=[{"id": fid, "filename": "plans.pdf", "ext": "pdf",
                               "url": "https://cdn.example/x.pdf"}],
                       download_ttl_days=90)
    sid = await _paid_tx(slug, fid)
    r = await client.post(f"/api/buyer/purchases/{sid}/download-links", headers=BUYER)
    assert r.status_code == 200
    links = r.json()["links"]
    assert len(links) == 1 and links[0]["token"]
    import time
    # 90-day TTL override honored (±ample slack)
    assert links[0]["expires_at_unix"] > time.time() + 80 * 24 * 3600
    other = {"Authorization": f"Bearer {issue_session_jwt('b2', 'not-owner@t.co', role='buyer')}"}
    r = await client.post(f"/api/buyer/purchases/{sid}/download-links", headers=other)
    assert r.status_code == 404


async def test_download_limit_and_history(client):
    fid = uuid.uuid4().hex
    slug = await _prod(files=[{"id": fid, "filename": "plans.pdf", "ext": "pdf",
                               "url": "https://cdn.example/x.pdf"}],
                       download_limit=1)
    sid = await _paid_tx(slug, fid)
    from digital_delivery import mint_download_token
    token, _ = mint_download_token(sid, fid)
    r = await client.get(f"/api/checkout/downloads/{token}", follow_redirects=False)
    assert r.status_code == 302
    hist = await db.download_history.find({"session_id": sid}).to_list(5)
    assert len(hist) == 1 and hist[0]["file_id"] == fid
    r = await client.get(f"/api/checkout/downloads/{token}", follow_redirects=False)
    assert r.status_code == 403 and "limit" in r.json()["detail"].lower()


async def test_download_blocked_scan_gate(client):
    fid = uuid.uuid4().hex
    slug = await _prod(files=[{"id": fid, "filename": "x.pdf", "ext": "pdf",
                               "url": "https://cdn.example/x.pdf",
                               "scan": {"status": "blocked"}}])
    sid = await _paid_tx(slug, fid)
    from digital_delivery import mint_download_token
    token, _ = mint_download_token(sid, fid)
    r = await client.get(f"/api/checkout/downloads/{token}", follow_redirects=False)
    assert r.status_code == 410


# ── Maker agreement ───────────────────────────────────────────────────────────

async def test_agreement_status_accept_flow(client):
    r = await client.get("/api/maker/agreement/status", headers=AUTH)
    assert r.status_code == 200
    d = r.json()
    assert d["requires_acceptance"] is True and d["current_version"] == "1.0"
    r = await client.post("/api/maker/agreement/accept",
                          json={"version": "1.0"},
                          headers={**AUTH, "user-agent": "pytest-UA",
                                   "x-forwarded-for": "203.0.113.9, 10.0.0.1"})
    assert r.status_code == 201
    acc = r.json()["acceptance"]
    assert acc["version"] == "1.0" and acc["ip"] == "203.0.113.9"
    assert acc["user_agent"] == "pytest-UA"
    r = await client.get("/api/maker/agreement/status", headers=AUTH)
    assert r.json()["requires_acceptance"] is False


async def test_agreement_append_only_and_version_mismatch(client):
    for _ in range(2):
        r = await client.post("/api/maker/agreement/accept",
                              json={"version": "1.0"}, headers=AUTH)
        assert r.status_code == 201
    rows = await db.maker_agreement_acceptances.find(
        {"maker_slug": M1}).to_list(10)
    assert len(rows) == 2  # never overwritten
    r = await client.post("/api/maker/agreement/accept",
                          json={"version": "0.9"}, headers=AUTH)
    assert r.status_code == 409


async def test_agreement_admin_audit_view(client):
    await client.post("/api/maker/agreement/accept",
                      json={"version": "1.0"}, headers=AUTH)
    r = await client.get("/api/admin/agreement/acceptances")
    assert r.status_code in (401, 403)
    admin = {"Authorization": f"Bearer {issue_session_jwt('admin', 'team@craftersmarket.org', role='admin')}"}
    r = await client.get("/api/admin/agreement/acceptances", headers=admin)
    assert r.status_code == 200
    d = r.json()
    assert d["current_version"] == "1.0"
    assert any(a["maker_slug"] == M1 for a in d["acceptances"])
    assert d["makers_by_version"].get("1.0", 0) >= 1
    r = await client.get("/api/admin/agreement/acceptances?version=9.9", headers=admin)
    assert all(a["version"] == "9.9" for a in r.json()["acceptances"])
