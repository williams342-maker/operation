"""iter221 regression — orphan-seed guard on /api/community/files.

Covers the same defense pattern as iter218 (clips) but scoped to the
community design-files library. The bug being fixed: production was
rendering a broken-image card for a design whose `/seed-designs/<slug>/
preview.jpg` never reached the deploy artifact (Nano Banana preview gen
half-failed). The new guard hides any such orphan row from the public
listing and gives admin a targeted purge endpoint.
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests

API_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://active-project-4.preview.emergentagent.com"
API = f"{API_URL.rstrip('/')}/api"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _admin_headers():
    from maker_auth import issue_session_jwt
    tok = issue_session_jwt("cm-admin", "admin@craftersmarket.org", role="admin")
    return {"Authorization": f"Bearer {tok}"}


def _sync_db():
    """Sync pymongo handle for test fixtures (avoids motor loop-closed)."""
    from pymongo import MongoClient
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _base_design(slug: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "title": slug,
        "description": slug,
        "file_type": "svg",
        "download_url": f"/seed-designs/{slug}/design.svg",
        "thumbnail_url": f"/seed-designs/{slug}/preview.jpg",
        "category": "Wall Art",
        "tags": [],
        "uploader_role": "workshop",
        "uploader_id": "workshop-team",
        "maker_name": "Workshop Team",
        "downloads": 0,
        "is_seed": True,
        "ai_generated": True,
        "variants": [],
        "size_bytes": 0,
        "quarantined_at": None,
        "created_at": _now_iso(),
    }


@pytest.fixture
def cleanup():
    slugs = ["iter221-orphan", "iter221-verified", "iter221-external", "iter221-organic"]
    yield slugs
    db = _sync_db()
    for s in slugs:
        db.design_files.delete_many({"slug": s})


def test_orphan_seed_hidden_from_public(cleanup):
    """Orphan = is_seed=true, no file_verified, local thumbnail_url."""
    db = _sync_db()
    doc = _base_design("iter221-orphan")  # no file_verified
    db.design_files.delete_many({"slug": doc["slug"]})
    db.design_files.insert_one(doc)
    r = requests.get(f"{API}/community/files?limit=80", timeout=10)
    assert r.status_code == 200
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    slugs = [i.get("slug", "") for i in items]
    assert "iter221-orphan" not in slugs, f"orphan leaked into public feed: {slugs}"


def test_verified_seed_visible(cleanup):
    db = _sync_db()
    doc = _base_design("iter221-verified")
    doc["file_verified"] = True
    db.design_files.delete_many({"slug": doc["slug"]})
    db.design_files.insert_one(doc)
    r = requests.get(f"{API}/community/files?limit=80", timeout=10)
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    slugs = [i.get("slug", "") for i in items]
    assert "iter221-verified" in slugs


def test_external_thumbnail_seed_visible(cleanup):
    """Seeds pointing at an external https thumbnail are never orphans."""
    db = _sync_db()
    doc = _base_design("iter221-external")
    doc["thumbnail_url"] = "https://cdn.example.com/preview.jpg"
    db.design_files.delete_many({"slug": doc["slug"]})
    db.design_files.insert_one(doc)
    r = requests.get(f"{API}/community/files?limit=80", timeout=10)
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    slugs = [i.get("slug", "") for i in items]
    assert "iter221-external" in slugs


def test_organic_upload_unaffected(cleanup):
    """is_seed=false (real maker upload) bypasses the guard entirely."""
    db = _sync_db()
    doc = _base_design("iter221-organic")
    doc["is_seed"] = False
    doc["maker_slug"] = "iron-and-oak"
    db.design_files.delete_many({"slug": doc["slug"]})
    db.design_files.insert_one(doc)
    r = requests.get(f"{API}/community/files?limit=80", timeout=10)
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    slugs = [i.get("slug", "") for i in items]
    assert "iter221-organic" in slugs


def test_purge_orphans_endpoint(cleanup):
    db = _sync_db()
    orphan = _base_design("iter221-orphan")
    verified = _base_design("iter221-verified")
    verified["file_verified"] = True
    organic = _base_design("iter221-organic")
    organic["is_seed"] = False
    organic["maker_slug"] = "iron-and-oak"
    for d in (orphan, verified, organic):
        db.design_files.delete_many({"slug": d["slug"]})
        db.design_files.insert_one(d)
    r = requests.post(
        f"{API}/admin/seed/community-designs/purge-orphans",
        headers=_admin_headers(), timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["deleted"] == 1
    assert "iter221-orphan" in body["slugs"]
    # Verified + organic survive
    r2 = requests.get(f"{API}/community/files?limit=80", timeout=10)
    items = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
    slugs = [i.get("slug", "") for i in items]
    assert "iter221-verified" in slugs
    assert "iter221-organic" in slugs


def test_status_reports_orphan_count(cleanup):
    db = _sync_db()
    db.design_files.delete_many({"slug": "iter221-orphan"})
    db.design_files.insert_one(_base_design("iter221-orphan"))
    r = requests.get(f"{API}/admin/seed/community-designs/status", headers=_admin_headers(), timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "orphan_seeds" in body
    assert body["orphan_seeds"] >= 1
