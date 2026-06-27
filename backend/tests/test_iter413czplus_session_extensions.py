"""iter413cz+ — Future-proofed Verification Session schema.

Locks the EXTENSION of the iter413cz contract:
  • new structured fields (platform_area, participants, severity, tags,
    linked_refs, resolution_status, follow_up_owner, metadata)
  • enum validation surfaces 400 with a helpful enum list
  • PATCH endpoint mutates only supplied fields (no implicit nulling)
  • PATCH metadata MERGES (does not replace) so callers can incrementally enrich
  • close() can promote follow-up state
  • list() filters on new attributes
  • per-turn enrichment (category, severity, ai_confidence, attachments, tags)

These tests do NOT re-assert the original iter413cz lifecycle (covered
in test_iter413cz_verification_sessions.py)."""
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

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://active-project-4.preview.emergentagent.com"
).rstrip("/")


@pytest.fixture()
def admin_jwt():
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify",
                      json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _h(jwt):
    return {"Authorization": f"Bearer {jwt}"}


def _start_session(jwt, **overrides):
    payload = {
        "verification_type": "feature_validation",
        "title": "iter413cz+ extension probe",
        "feature_area": "quality_engine",
    }
    payload.update(overrides)
    r = requests.post(
        f"{BASE_URL}/api/admin/verification-sessions/start",
        headers=_h(jwt), json=payload, timeout=20,
    )
    return r


def _cleanup(session_id):
    async def _wipe():
        from motor.motor_asyncio import AsyncIOMotorClient
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        await c[os.environ["DB_NAME"]].verification_sessions.delete_one({"id": session_id})
        c.close()
    asyncio.run(_wipe())


def test_new_fields_persist_on_start(admin_jwt):
    r = _start_session(
        admin_jwt,
        title="iter413cz+ all fields",
        platform_area="compass",
        participants=[
            {"type": "seller", "identifier": "iron-and-oak"},
            {"type": "admin", "name": "team"},
        ],
        severity="medium",
        tags=["Compass", "v2 design", "Compass"],   # dedup + lowercase test
        linked_refs={"iteration": "iter413cz", "github_issue": 142},
        resolution_status="open",
        follow_up_owner="team@craftersmarket.org",
        metadata={"customer_segment": "early_access", "build_id": "abc123"},
    )
    assert r.status_code == 200, r.text
    s = r.json()["session"]
    try:
        assert s["platform_area"] == "compass"
        assert len(s["participants"]) == 2
        assert s["severity"] == "medium"
        assert s["tags"] == ["compass", "v2 design"]   # lowercase + dedup
        assert s["linked_refs"] == {"iteration": "iter413cz", "github_issue": 142}
        assert s["resolution_status"] == "open"
        assert s["follow_up_owner"] == "team@craftersmarket.org"
        assert s["metadata"]["customer_segment"] == "early_access"
    finally:
        _cleanup(s["id"])


@pytest.mark.parametrize("bad_field,bad_value,err_fragment", [
    ("platform_area", "not_a_real_area", "platform_area"),
    ("severity", "extreme", "severity"),
    ("resolution_status", "totally_open", "resolution_status"),
])
def test_enum_validation_returns_400(admin_jwt, bad_field, bad_value, err_fragment):
    r = _start_session(admin_jwt, **{bad_field: bad_value})
    assert r.status_code == 400
    assert err_fragment in r.json()["detail"]


def test_participant_type_validated(admin_jwt):
    r = _start_session(admin_jwt, participants=[{"type": "alien", "name": "x"}])
    assert r.status_code == 400
    assert "participant.type" in r.json()["detail"]


def test_patch_only_writes_supplied_fields(admin_jwt):
    r = _start_session(admin_jwt, severity="low", tags=["original"])
    s_id = r.json()["session"]["id"]
    try:
        # PATCH: bump severity but DON'T touch tags
        p = requests.patch(
            f"{BASE_URL}/api/admin/verification-sessions/{s_id}",
            headers=_h(admin_jwt), json={"severity": "high"}, timeout=15,
        )
        assert p.status_code == 200
        s2 = p.json()["session"]
        assert s2["severity"] == "high"
        assert s2["tags"] == ["original"]   # untouched
    finally:
        _cleanup(s_id)


def test_patch_metadata_merges(admin_jwt):
    r = _start_session(admin_jwt, metadata={"a": 1, "b": 2})
    s_id = r.json()["session"]["id"]
    try:
        # PATCH adds "c", updates "a", leaves "b" untouched
        p = requests.patch(
            f"{BASE_URL}/api/admin/verification-sessions/{s_id}",
            headers=_h(admin_jwt), json={"metadata": {"a": 99, "c": 3}}, timeout=15,
        )
        assert p.status_code == 200
        meta = p.json()["session"]["metadata"]
        assert meta == {"a": 99, "b": 2, "c": 3}
    finally:
        _cleanup(s_id)


def test_patch_requires_at_least_one_field(admin_jwt):
    r = _start_session(admin_jwt)
    s_id = r.json()["session"]["id"]
    try:
        p = requests.patch(
            f"{BASE_URL}/api/admin/verification-sessions/{s_id}",
            headers=_h(admin_jwt), json={}, timeout=15,
        )
        assert p.status_code == 400
    finally:
        _cleanup(s_id)


def test_close_can_promote_follow_up_state(admin_jwt):
    r = _start_session(admin_jwt)
    s_id = r.json()["session"]["id"]
    try:
        c = requests.post(
            f"{BASE_URL}/api/admin/verification-sessions/{s_id}/close",
            headers=_h(admin_jwt),
            json={
                "completion_status": "failed",
                "summary": "Found 2 issues, need triage.",
                "resolution_status": "in_progress",
                "follow_up_owner": "ops@craftersmarket.org",
            }, timeout=15,
        )
        assert c.status_code == 200
        closed = c.json()["session"]
        assert closed["completion_status"] == "failed"
        assert closed["resolution_status"] == "in_progress"
        assert closed["follow_up_owner"] == "ops@craftersmarket.org"
    finally:
        _cleanup(s_id)


def test_per_turn_enrichment_persists(admin_jwt):
    r = _start_session(admin_jwt)
    s_id = r.json()["session"]["id"]
    try:
        t = requests.post(
            f"{BASE_URL}/api/admin/verification-sessions/{s_id}/turns",
            headers=_h(admin_jwt),
            json={
                "kind": "issue", "author": "admin",
                "text": "Score endpoint returned 500 on missing image field.",
                "category": "bug",
                "severity": "high",
                "ai_confidence": 0.92,
                "attachments": [{"url": "https://cdn/x.png", "kind": "screenshot"}],
                "tags": ["api", "Listing Quality"],   # dedup + lowercase
            }, timeout=15,
        )
        assert t.status_code == 200, t.text
        turn = t.json()["turn"]
        assert turn["category"] == "bug"
        assert turn["severity"] == "high"
        assert turn["ai_confidence"] == 0.92
        assert turn["tags"] == ["api", "listing quality"]
        assert turn["attachments"][0]["url"].endswith(".png")
    finally:
        _cleanup(s_id)


def test_issue_category_validated_against_canonical_set(admin_jwt):
    r = _start_session(admin_jwt)
    s_id = r.json()["session"]["id"]
    try:
        t = requests.post(
            f"{BASE_URL}/api/admin/verification-sessions/{s_id}/turns",
            headers=_h(admin_jwt),
            json={
                "kind": "issue", "author": "admin", "text": "x",
                "category": "wat_is_this",   # invalid
            }, timeout=15,
        )
        assert t.status_code == 400
        assert "category" in t.json()["detail"]
    finally:
        _cleanup(s_id)


def test_list_filters_on_new_attributes(admin_jwt):
    # Seed two sessions: one with tag 'targeted', one without.
    r1 = _start_session(admin_jwt, tags=["targeted-iter413czplus"],
                        platform_area="compass", severity="high",
                        resolution_status="in_progress",
                        follow_up_owner="ops@craftersmarket.org")
    r2 = _start_session(admin_jwt, tags=["ignored"])
    ids = (r1.json()["session"]["id"], r2.json()["session"]["id"])
    try:
        # Filter by tag
        r = requests.get(
            f"{BASE_URL}/api/admin/verification-sessions?tag=targeted-iter413czplus",
            headers=_h(admin_jwt), timeout=15,
        )
        slugs = {x["id"] for x in r.json()["rows"]}
        assert ids[0] in slugs
        assert ids[1] not in slugs
        # Filter by platform_area
        r = requests.get(
            f"{BASE_URL}/api/admin/verification-sessions?platform_area=compass&tag=targeted-iter413czplus",
            headers=_h(admin_jwt), timeout=15,
        )
        ids_found = {x["id"] for x in r.json()["rows"]}
        assert ids[0] in ids_found
        # Filter by severity
        r = requests.get(
            f"{BASE_URL}/api/admin/verification-sessions?severity=high&tag=targeted-iter413czplus",
            headers=_h(admin_jwt), timeout=15,
        )
        ids_found = {x["id"] for x in r.json()["rows"]}
        assert ids[0] in ids_found
        # Filter by follow_up_owner
        r = requests.get(
            f"{BASE_URL}/api/admin/verification-sessions?follow_up_owner=ops@craftersmarket.org&tag=targeted-iter413czplus",
            headers=_h(admin_jwt), timeout=15,
        )
        ids_found = {x["id"] for x in r.json()["rows"]}
        assert ids[0] in ids_found
    finally:
        for sid in ids:
            _cleanup(sid)
