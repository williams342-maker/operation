"""iter413bz — 404 referrer beacon + admin top-stale-links surface."""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def admin_jwt():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token
    super_email = (os.environ.get("ADMIN_EMAILS") or os.environ.get("OPS_EMAIL") or "team@craftersmarket.org").split(",")[0].strip()
    tok = issue_admin_magic_token(super_email)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def H(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


def _cleanup_test_paths(paths):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.not_found_log.delete_many({"path": {"$in": list(paths)}})
        client.close()

    asyncio.run(_go())


def test_beacon_is_public_no_auth_required():
    path = f"/iter413bz-public-{uuid.uuid4().hex[:8]}"
    try:
        r = requests.post(
            f"{BASE_URL}/api/not-found/log",
            json={"path": path, "referer": "https://example.com/post/123", "signed_in_role": "maker"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
    finally:
        _cleanup_test_paths({path})


def test_admin_top_links_requires_admin():
    r = requests.get(f"{BASE_URL}/api/admin/not-found/recent", timeout=15)
    assert r.status_code in (401, 403)


def test_admin_top_links_dedupes_by_path_and_returns_hits(H):
    path = f"/iter413bz-cluster-{uuid.uuid4().hex[:8]}"
    try:
        # Fire 3 beacons against the same path, varying role / referer.
        for role, ref in [
            ("maker", "https://craftersmarket.org/email/digest"),
            ("anon",  "https://craftersmarket.org/email/digest"),
            ("maker", ""),
        ]:
            requests.post(
                f"{BASE_URL}/api/not-found/log",
                json={"path": path, "referer": ref, "signed_in_role": role},
                timeout=15,
            )
        r = requests.get(f"{BASE_URL}/api/admin/not-found/recent", headers=H, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["window"] == "7d"
        assert isinstance(body["total_24h"], int)
        row = next((x for x in body["rows"] if x["path"] == path), None)
        assert row is not None, f"expected a row for path {path!r} in /admin/not-found/recent"
        assert row["hits"] == 3
        assert "maker" in row["roles"]
        assert row["sample_referer"]
    finally:
        _cleanup_test_paths({path})


def test_payload_field_caps_defend_against_abuse():
    """Oversized path / referer must be truncated, not 500."""
    path = f"/iter413bz-bigpayload-{uuid.uuid4().hex[:6]}"
    try:
        r = requests.post(
            f"{BASE_URL}/api/not-found/log",
            json={
                "path":          path + ("A" * 2000),
                "referer":       "https://" + ("B" * 2000),
                "signed_in_role": "X" * 200,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
    finally:
        _cleanup_test_paths({path + ("A" * 2000), path})
