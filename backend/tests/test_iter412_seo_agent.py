"""iter412 — AI SEO Growth Agent backend tests.

Smoke test for the daily-cron scanner + queue + approve/reject/rollback
flow. Uses the real /api endpoints to confirm wiring, auth, scoring,
issue surfacing, and audit history all work end-to-end.

Marked `smoke` via conftest.py SMOKE_FILES so the pre-deploy CI gate
exercises this.
"""
import os
import sys
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
sys.path.insert(0, "/app/backend")

from maker_auth import issue_admin_magic_token  # noqa: E402

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def admin_jwt():
    """Mint an admin JWT for the OPS email so the /api/admin/seo-agent
    endpoints accept us. Mirrors the production magic-link → JWT swap."""
    email = os.environ.get("OPS_EMAIL") or "team@craftersmarket.org"
    magic = issue_admin_magic_token(email)
    r = requests.post(f"{API}/admin/auth/verify", json={"token": magic}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}", "Content-Type": "application/json"}


def test_overview_requires_admin():
    r = requests.get(f"{API}/admin/seo-agent/overview", timeout=10)
    # No bearer → 401/403 (current_admin returns 401/403; either is correct)
    assert r.status_code in (401, 403)


def test_overview_returns_shape(headers):
    r = requests.get(f"{API}/admin/seo-agent/overview", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "next_scheduled_scan" in d
    assert "queue_pending" in d
    # latest_run may be None if no scan has ever happened in this DB; both OK


@pytest.fixture(scope="module")
def scan_run(headers):
    """One scan for the whole module, owned by a fixture rather than by a test.

    Two tests need a completed scan to exist. Previously only
    test_manual_scan_then_overview_reflects ran one, and
    test_history_returns_time_series simply assumed it had — its own comment
    said "at least the run from test_manual_scan_then_overview_reflects should
    be in the history". That is an order dependency between tests: when the scan
    test failed, history failed too, for a reason that had nothing to do with
    history.

    A fixture makes the dependency explicit and runs the scan once.
    """
    r = requests.post(f"{API}/admin/seo-agent/scan/run", headers=headers, timeout=180)
    assert r.status_code == 200, r.text
    return r.json()


# The scan fetches and analyses pages; the client already allows 180s for it. The
# suite-wide ceiling is 45s, so without this marker pytest killed the test at 45
# while the request was still legitimately in flight — a race between two
# timeouts, not a defect in the endpoint. 240 leaves the client's own 180 room to
# expire first and report something useful.
@pytest.mark.timeout(240)
def test_manual_scan_then_overview_reflects(headers, scan_run):
    run = scan_run
    assert set(run["scores"].keys()) == {"overall", "technical", "content", "authority"}
    assert run["counts"]["targets_scanned"] >= 0
    for s in run["scores"].values():
        assert 0 <= s <= 100, f"score out of range: {s}"

    # Overview now reflects the just-finished scan
    r = requests.get(f"{API}/admin/seo-agent/overview", headers=headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["latest_run"]["id"] == run["id"]


def test_issues_filter_by_pillar(headers):
    r = requests.get(f"{API}/admin/seo-agent/issues?pillar=content", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()["issues"]
    for i in items:
        assert i["pillar"] == "content"


def test_queue_empty_filter(headers):
    r = requests.get(f"{API}/admin/seo-agent/queue?status=rejected", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    assert "items" in r.json()
    assert r.json()["status"] == "rejected"


def test_generate_fix_404_when_no_issue(headers):
    """Bogus issue_id returns 404 cleanly — confirms the lookup path
    works without falling through to a 500."""
    r = requests.post(
        f"{API}/admin/seo-agent/generate-fix",
        headers=headers,
        json={"issue_id": "this-id-does-not-exist"},
        timeout=15,
    )
    assert r.status_code == 404, r.text


def test_queue_approve_404_when_missing(headers):
    r = requests.post(
        f"{API}/admin/seo-agent/queue/this-id-does-not-exist/approve",
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 404


def test_queue_reject_404_when_missing(headers):
    r = requests.post(
        f"{API}/admin/seo-agent/queue/this-id-does-not-exist/reject",
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 404


# iter413 — Recommendations engine + Reporting tab endpoints
def test_recommendations_returns_ranked_groups(headers):
    """After the scan in test_manual_scan_then_overview_reflects ran,
    we should have recommendations grouped by kind and sorted by
    impact-per-effort ratio."""
    r = requests.get(f"{API}/admin/seo-agent/recommendations", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "recommendations" in d
    recs = d["recommendations"]
    # Every recommendation has the impact/effort metadata + issue group
    for rec in recs:
        assert {"id", "kind", "title", "severity", "affected_count",
                "effort_minutes", "expected_traffic_pct", "fixable_via_ai",
                "impact_label", "effort_label", "issue_ids"}.issubset(rec.keys())
        assert rec["impact_label"] in {"high", "medium", "low"}
        assert rec["effort_label"] in {"high", "medium", "low"}
        assert rec["affected_count"] == len(rec["issue_ids"]) or rec["affected_count"] > len(rec["issue_ids"])


@pytest.mark.timeout(240)
def test_history_returns_time_series(headers, scan_run):
    r = requests.get(f"{API}/admin/seo-agent/history?days=30", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["window_days"] == 30
    assert isinstance(d["history"], list)
    assert "queue_activity" in d
    assert {"applied", "rejected", "rolled_back"}.issubset(d["queue_activity"].keys())
    # The scan_run fixture guarantees a completed run exists, so this is now a
    # property of the endpoint rather than of test execution order.
    assert len(d["history"]) >= 1, (
        "history is empty despite scan %s having completed" % scan_run["id"])
    # Every history point carries scores in [0..100]
    for h in d["history"]:
        for s in h["scores"].values():
            assert 0 <= s <= 100


def test_history_window_clamps(headers):
    """days param is clamped to 1..180. Falsy values fall back to the
    30-day default."""
    r = requests.get(f"{API}/admin/seo-agent/history?days=99999", headers=headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["window_days"] == 180

    # days=0 is falsy → defaults to 30, not 1.
    r = requests.get(f"{API}/admin/seo-agent/history?days=0", headers=headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["window_days"] == 30

    r = requests.get(f"{API}/admin/seo-agent/history?days=1", headers=headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["window_days"] == 1


def test_recommendations_requires_admin():
    r = requests.get(f"{API}/admin/seo-agent/recommendations", timeout=10)
    assert r.status_code in (401, 403)


def test_history_requires_admin():
    r = requests.get(f"{API}/admin/seo-agent/history", timeout=10)
    assert r.status_code in (401, 403)


# iter413c — Pillar 3 Authority + Autopilot mode
@pytest.mark.timeout(240)
def test_authority_pillar_surfaces_issues(headers, scan_run):
    """Scan should produce authority-pillar issues for makers with
    incomplete profiles + the new authority recommendations.

    Uses the shared scan_run fixture. This test previously ran a THIRD scan of
    its own, so the module paid for the same slow analysis three times and lost
    the same 45s-versus-180s race three times.
    """
    run = scan_run
    # Authority count is exposed in counts and used by the scoring
    assert "authority" in run["counts"]
    # Bundled issues include the new pillar
    auth_kinds = {i["kind"] for i in run["issues"] if i["pillar"] == "authority"}
    assert auth_kinds  # at least one authority kind present
    # Authority recommendations grouped + ranked
    auth_recs = [r for r in run["recommendations"]
                 if r["kind"].startswith("maker_") or r["kind"] == "landing_thin_relations"]
    for rec in auth_recs:
        assert rec["affected_count"] > 0


def test_config_endpoints_round_trip(headers):
    """GET returns current mode + valid modes + low-risk whitelist.
    POST persists. Re-read confirms."""
    r = requests.get(f"{API}/admin/seo-agent/config", headers=headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["mode"] in ("observe", "assist", "approve", "autopilot")
    assert set(d["valid_modes"]) == {"observe", "assist", "approve", "autopilot"}
    assert "missing_alt_text" in d["autopilot_low_risk_kinds"]

    # Flip to assist then back to approve — confirm persistence
    for mode in ("assist", "approve"):
        r = requests.post(f"{API}/admin/seo-agent/config", headers=headers,
                          json={"mode": mode}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["mode"] == mode
        r = requests.get(f"{API}/admin/seo-agent/config", headers=headers, timeout=15)
        assert r.json()["mode"] == mode


def test_config_rejects_invalid_mode(headers):
    r = requests.post(f"{API}/admin/seo-agent/config", headers=headers,
                      json={"mode": "self-destruct"}, timeout=15)
    assert r.status_code == 400


def test_config_requires_admin():
    r = requests.get(f"{API}/admin/seo-agent/config", timeout=10)
    assert r.status_code in (401, 403)
    r = requests.post(f"{API}/admin/seo-agent/config",
                      json={"mode": "assist"}, timeout=10)
    assert r.status_code in (401, 403)


def test_overview_exposes_mode(headers):
    """The Overview endpoint must return the current mode so the
    frontend selector can highlight the active option."""
    r = requests.get(f"{API}/admin/seo-agent/overview", headers=headers, timeout=15)
    assert r.status_code == 200
    assert "mode" in r.json()


# iter413d — Granular autopilot whitelist (admin opts in per kind)
def test_config_exposes_available_kinds(headers):
    """Config must expose the kinds that are eligible for autopilot —
    not just the ones currently whitelisted."""
    r = requests.get(f"{API}/admin/seo-agent/config", headers=headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "autopilot_available_kinds" in d
    assert "missing_alt_text" in d["autopilot_available_kinds"]
    assert "missing_meta_description" in d["autopilot_available_kinds"]


def test_config_whitelist_round_trip(headers):
    """POST a custom whitelist, re-GET, confirm persistence."""
    r = requests.post(
        f"{API}/admin/seo-agent/config", headers=headers,
        json={"autopilot_whitelist": ["missing_alt_text", "missing_meta_description"]},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert set(r.json()["autopilot_whitelist"]) == {"missing_alt_text", "missing_meta_description"}
    r = requests.get(f"{API}/admin/seo-agent/config", headers=headers, timeout=15)
    assert set(r.json()["autopilot_whitelist"]) == {"missing_alt_text", "missing_meta_description"}
    # Reset to single-kind default
    requests.post(f"{API}/admin/seo-agent/config", headers=headers,
                  json={"autopilot_whitelist": ["missing_alt_text"]}, timeout=15)


def test_config_whitelist_silently_drops_high_risk(headers):
    """High-risk kinds and bogus kinds must be silently dropped so the
    admin can't accidentally autopilot a content rewrite."""
    r = requests.post(
        f"{API}/admin/seo-agent/config", headers=headers,
        json={"autopilot_whitelist": [
            "missing_alt_text",
            "thin_product_description",   # high-risk — must drop
            "make_up_a_kind",             # bogus — must drop
        ]},
        timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["autopilot_whitelist"] == ["missing_alt_text"]


def test_config_post_requires_at_least_one_field(headers):
    """Empty payload returns 400 — caller must pass mode and/or whitelist."""
    r = requests.post(f"{API}/admin/seo-agent/config", headers=headers,
                      json={}, timeout=15)
    assert r.status_code == 400


# iter413g — Bulk approve endpoint (multi-select + "approve all safe")
def test_bulk_approve_requires_admin():
    r = requests.post(f"{API}/admin/seo-agent/queue/bulk-approve",
                      json={"all_safe": True}, timeout=10)
    assert r.status_code in (401, 403)


def test_bulk_approve_validates_payload(headers):
    """Empty body must 400 — caller must pass `ids` or `all_safe=true`."""
    r = requests.post(f"{API}/admin/seo-agent/queue/bulk-approve",
                      headers=headers, json={}, timeout=15)
    assert r.status_code == 400


def test_bulk_approve_safe_applies_alt_text_only():
    """Direct-DB seed: insert a pending alt-text queue entry for a real
    product, call /bulk-approve with all_safe=true, confirm only the
    safe entry was applied and the product's image_alts mutated.

    Uses pytest-asyncio via the running event loop on motor — same pattern
    test_iter412 uses elsewhere. Falls back to skip if no product fixture
    is available in the DB."""
    import asyncio
    import uuid as _uuid
    from datetime import datetime, timezone
    from core import db as _db
    from maker_auth import issue_admin_magic_token as _mint

    async def run():
        # Need at least one existing product to mutate.
        product = await _db.products.find_one({"shop_closed": {"$ne": True}}, {"_id": 0})
        if not product:
            return "no-product"

        run_id = "test-run-bulk-" + str(_uuid.uuid4())[:8]
        original_alts = product.get("image_alts") or []
        safe_id = "qtest-safe-" + str(_uuid.uuid4())[:8]
        skip_id = "qtest-skip-" + str(_uuid.uuid4())[:8]
        now = datetime.now(timezone.utc).isoformat()

        # Safe entry — additive alt-text fill.
        await _db.seo_agent_queue.insert_one({
            "id": safe_id, "run_id": run_id, "issue_id": "iss-1",
            "issue_kind": "missing_alt_text", "severity": "medium",
            "target_type": "product", "target_slug": product["slug"],
            "target_label": product.get("title"),
            "field": "image_alts",
            "before": {"image_alts": original_alts},
            "after": {"image_alts": ["bulk-test-alt-A", "bulk-test-alt-B"]},
            "status": "pending", "generated_at": now,
        })
        # Skip entry — high-risk kind, must NOT be touched by all_safe.
        await _db.seo_agent_queue.insert_one({
            "id": skip_id, "run_id": run_id, "issue_id": "iss-2",
            "issue_kind": "thin_product_description", "severity": "high",
            "target_type": "product", "target_slug": product["slug"],
            "target_label": product.get("title"),
            "field": "description",
            "before": {"description": product.get("description") or ""},
            "after": {"description": "MUST NOT APPLY"},
            "status": "pending", "generated_at": now,
        })
        return product["slug"], safe_id, skip_id, original_alts

    loop = asyncio.new_event_loop()
    try:
        seeded = loop.run_until_complete(run())
    finally:
        loop.close()
    if seeded == "no-product":
        pytest.skip("No product in DB — can't exercise bulk-approve apply path.")
    slug, safe_id, skip_id, original_alts = seeded

    # Build admin headers locally so this test is self-contained.
    email = os.environ.get("OPS_EMAIL") or "team@craftersmarket.org"
    magic = _mint(email)
    v = requests.post(f"{API}/admin/auth/verify", json={"token": magic}, timeout=15)
    h = {"Authorization": f"Bearer {v.json()['token']}", "Content-Type": "application/json"}

    r = requests.post(f"{API}/admin/seo-agent/queue/bulk-approve",
                      headers=h, json={"all_safe": True}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    # Safe entry must be in applied_ids; skip entry must NOT be — bulk
    # only touches entries whose kind is in AUTOPILOT_AVAILABLE_KINDS.
    assert safe_id in d["applied_ids"], f"safe entry not applied: {d}"
    assert skip_id not in d["applied_ids"], f"high-risk entry slipped through: {d}"

    async def verify():
        safe = await _db.seo_agent_queue.find_one({"id": safe_id}, {"_id": 0})
        skip = await _db.seo_agent_queue.find_one({"id": skip_id}, {"_id": 0})
        prod = await _db.products.find_one({"slug": slug}, {"_id": 0})
        return safe, skip, prod

    loop = asyncio.new_event_loop()
    try:
        safe, skip, prod = loop.run_until_complete(verify())
    finally:
        loop.close()
    assert safe["status"] == "applied"
    assert skip["status"] == "pending"
    assert prod.get("image_alts") == ["bulk-test-alt-A", "bulk-test-alt-B"]

    # Cleanup: restore product alts + roll the safe entry back so this
    # test is idempotent across runs.
    async def cleanup():
        await _db.products.update_one(
            {"slug": slug},
            {"$set": {"image_alts": original_alts}},
        )
        await _db.seo_agent_queue.delete_many({"id": {"$in": [safe_id, skip_id]}})
        await _db.seo_agent_audit.delete_many({"queue_id": {"$in": [safe_id, skip_id]}})

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(cleanup())
    finally:
        loop.close()


def test_bulk_approve_by_ids_applies_only_listed(headers):
    """Multi-select mode: caller passes a specific list of ids; only
    those entries are applied (bypassing the safe-kind filter)."""
    import asyncio
    import uuid as _uuid
    from datetime import datetime, timezone
    from core import db as _db

    async def seed():
        product = await _db.products.find_one({"shop_closed": {"$ne": True}}, {"_id": 0})
        if not product:
            return None
        ids = []
        now = datetime.now(timezone.utc).isoformat()
        for i in range(2):
            qid = "qtest-ids-" + str(_uuid.uuid4())[:8]
            ids.append(qid)
            await _db.seo_agent_queue.insert_one({
                "id": qid, "run_id": "test-run-ids",
                "issue_id": f"iss-ids-{i}",
                "issue_kind": "missing_alt_text", "severity": "medium",
                "target_type": "product", "target_slug": product["slug"],
                "target_label": product.get("title"),
                "field": "image_alts",
                "before": {"image_alts": product.get("image_alts") or []},
                "after": {"image_alts": [f"ids-test-{i}"]},
                "status": "pending", "generated_at": now,
            })
        return product["slug"], product.get("image_alts") or [], ids

    loop = asyncio.new_event_loop()
    try:
        seeded = loop.run_until_complete(seed())
    finally:
        loop.close()
    if not seeded:
        pytest.skip("No product to mutate.")
    slug, original_alts, ids = seeded

    # Approve only the first id; second must remain pending.
    r = requests.post(f"{API}/admin/seo-agent/queue/bulk-approve",
                      headers=headers, json={"ids": [ids[0]]}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert ids[0] in d["applied_ids"]
    assert ids[1] not in d["applied_ids"]

    async def cleanup():
        await _db.products.update_one(
            {"slug": slug}, {"$set": {"image_alts": original_alts}},
        )
        await _db.seo_agent_queue.delete_many({"id": {"$in": ids}})
        await _db.seo_agent_audit.delete_many({"queue_id": {"$in": ids}})

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(cleanup())
    finally:
        loop.close()


# iter413i — Bulk rollback (Undo snackbar companion to bulk-approve)
def test_bulk_rollback_requires_admin():
    r = requests.post(f"{API}/admin/seo-agent/queue/bulk-rollback",
                      json={"ids": ["anything"]}, timeout=10)
    assert r.status_code in (401, 403)


def test_bulk_rollback_validates_payload(headers):
    """Empty ids must 400."""
    r = requests.post(f"{API}/admin/seo-agent/queue/bulk-rollback",
                      headers=headers, json={"ids": []}, timeout=15)
    assert r.status_code == 400


def test_bulk_rollback_reverses_applied_entries(headers):
    """End-to-end: seed two pending alt-text entries → bulk-approve →
    confirm product alts mutated → bulk-rollback → confirm product alts
    reverted to original AND queue entries marked rolled_back."""
    import asyncio
    import uuid as _uuid
    from datetime import datetime, timezone
    from core import db as _db

    async def seed():
        product = await _db.products.find_one({"shop_closed": {"$ne": True}}, {"_id": 0})
        if not product:
            return None
        ids = []
        now = datetime.now(timezone.utc).isoformat()
        original = product.get("image_alts") or []
        for i in range(2):
            qid = "qtest-undo-" + str(_uuid.uuid4())[:8]
            ids.append(qid)
            await _db.seo_agent_queue.insert_one({
                "id": qid, "run_id": "test-run-undo",
                "issue_id": f"iss-undo-{i}",
                "issue_kind": "missing_alt_text", "severity": "medium",
                "target_type": "product", "target_slug": product["slug"],
                "target_label": product.get("title"),
                "field": "image_alts",
                "before": {"image_alts": original},
                "after": {"image_alts": [f"undo-test-{i}-A", f"undo-test-{i}-B"]},
                "status": "pending", "generated_at": now,
            })
        return product["slug"], original, ids

    loop = asyncio.new_event_loop()
    try:
        seeded = loop.run_until_complete(seed())
    finally:
        loop.close()
    if not seeded:
        pytest.skip("No product to mutate.")
    slug, original_alts, ids = seeded

    # 1. Bulk-approve both.
    r = requests.post(f"{API}/admin/seo-agent/queue/bulk-approve",
                      headers=headers, json={"ids": ids}, timeout=30)
    assert r.status_code == 200, r.text
    assert set(r.json()["applied_ids"]) == set(ids)

    # 2. Bulk-rollback both — undo path.
    r = requests.post(f"{API}/admin/seo-agent/queue/bulk-rollback",
                      headers=headers, json={"ids": ids}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert set(d["rolled_back_ids"]) == set(ids), d
    assert d["failed_count"] == 0

    # 3. Verify the product's image_alts reverted to original AND the
    #    queue rows now show rolled_back status.
    async def verify():
        prod = await _db.products.find_one({"slug": slug}, {"_id": 0})
        entries = await _db.seo_agent_queue.find({"id": {"$in": ids}}, {"_id": 0}).to_list(10)
        return prod, entries

    loop = asyncio.new_event_loop()
    try:
        prod, entries = loop.run_until_complete(verify())
    finally:
        loop.close()
    assert prod.get("image_alts") == original_alts, "rollback did not restore the before snapshot"
    for e in entries:
        assert e["status"] == "rolled_back"

    # Cleanup
    async def cleanup():
        await _db.seo_agent_queue.delete_many({"id": {"$in": ids}})
        await _db.seo_agent_audit.delete_many({"queue_id": {"$in": ids}})

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(cleanup())
    finally:
        loop.close()


def test_bulk_rollback_skips_non_applied(headers):
    """If a caller passes pending or already-rolled-back ids, the
    endpoint silently skips them (404 would be wrong — the endpoint is
    idempotent by design)."""
    import asyncio
    import uuid as _uuid
    from datetime import datetime, timezone
    from core import db as _db

    async def seed():
        product = await _db.products.find_one({"shop_closed": {"$ne": True}}, {"_id": 0})
        if not product:
            return None
        qid = "qtest-skip-" + str(_uuid.uuid4())[:8]
        await _db.seo_agent_queue.insert_one({
            "id": qid, "run_id": "test-run-skip",
            "issue_id": "iss-skip", "issue_kind": "missing_alt_text",
            "severity": "medium", "target_type": "product",
            "target_slug": product["slug"], "target_label": product.get("title"),
            "field": "image_alts",
            "before": {"image_alts": []}, "after": {"image_alts": ["x"]},
            "status": "pending",  # NOT applied — bulk-rollback must ignore.
            "generated_at": datetime.now(timezone.utc).isoformat(),
        })
        return qid

    loop = asyncio.new_event_loop()
    try:
        qid = loop.run_until_complete(seed())
    finally:
        loop.close()
    if not qid:
        pytest.skip("No product to mutate.")

    r = requests.post(f"{API}/admin/seo-agent/queue/bulk-rollback",
                      headers=headers, json={"ids": [qid]}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["rolled_back_count"] == 0
    assert d["failed_count"] == 0  # silently ignored, not flagged as failures

    async def cleanup():
        await _db.seo_agent_queue.delete_one({"id": qid})

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(cleanup())
    finally:
        loop.close()