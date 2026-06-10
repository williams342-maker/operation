"""iter355 — Meta video-creative push regression tests.

Covers the new VIDEO branch in `services/ads_gateway/meta.py` plus the
`video_asset_id` plumbing in `routers/ai_ad_push.py`:

  • `_upload_advideo_chunked` walks `upload_phase=start|transfer|finish`
    against `graph-video.facebook.com` and returns the video_id.
  • `_poll_video_status` waits for `video_status=ready` and raises on
    error/timeout.
  • `_create_video_creative` posts `object_story_spec.video_data` with
    the AI headline/primary_text mapping and listing thumbnail.
  • `/admin/ad-creative/drafts/{id}/push/meta` accepts `video_asset_id`,
    validates the asset is a video, and records `creative_kind=video`.
  • Asset id pointing to an image → 400.
  • Missing asset id → 404.
"""
from __future__ import annotations

import os
import sys
import json
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ["META_AD_ACCOUNT_ID"] = "act_999"
os.environ["META_DEFAULT_PAGE_ID"] = "111"
os.environ["META_API_VERSION"] = "v20.0"
sys.path.insert(0, "/app/backend")

import pytest
import pytest_asyncio
import respx
from httpx import Response, ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


# ── Fixtures ──────────────────────────────────────────────────────────
@pytest_asyncio.fixture(autouse=True)
async def _isolate_db():
    from core import db
    await db.integration_credentials.delete_many({"_id": "meta_ads"})
    await db.integration_credentials.insert_one({
        "_id": "meta_ads",
        "access_token": "FAKE_TOKEN",
        "scope": "ads_management,ads_read,pages_show_list",
    })
    await db.ad_creative_drafts.delete_many({"_id": {"$regex": "^iter355_"}})
    await db.ad_workshop_assets.delete_many({"_id": {"$regex": "^iter355_"}})
    await db.admin_ad_pushes.delete_many({"draft_id": {"$regex": "^iter355_"}})
    await db.products.delete_many({"slug": "iter355-listing"})
    await db.products.insert_one({
        "slug": "iter355-listing",
        "title": "Test Product",
        "description": "A nice handmade test product.",
        "maker_slug": "iter355-maker",
        "images": ["https://example.com/thumb.jpg"],
        "status": "published",
        "deleted_at": None,
    })
    yield


def _admin_headers() -> dict:
    from maker_auth import issue_session_jwt
    tok = issue_session_jwt(
        "iter355-admin", "iter355-admin@craftersmarket.org",
        role="admin", session_version=0,
    )
    return {"Authorization": f"Bearer {tok}"}


def _draft_doc(draft_id: str) -> dict:
    return {
        "_id": draft_id,
        "subject_type": "product",
        "subject_slug": "iter355-listing",
        "subject_title": "Test Product",
        "landing_path": "/p/iter355-listing",
        "channels": ["meta_feed"],
        "tone": "professional",
        "copy": {
            "meta_feed": {
                "headlines": ["Crafted with Care"],
                "primary_texts": ["Pieces our makers spent days on, ready for you."],
            }
        },
    }


async def _seed_video_asset(asset_id: str, *, kind: str = "video") -> str:
    """Write a tiny on-disk file + mongo row for the workshop asset."""
    from core import db
    p = Path("/tmp") / f"{asset_id}.mp4"
    p.write_bytes(b"\x00\x00\x00\x20ftypmp42" + (b"DEAD" * 64))  # ~272 bytes
    await db.ad_workshop_assets.insert_one({
        "_id": asset_id,
        "kind": kind,
        "mime": "video/mp4" if kind == "video" else "image/jpeg",
        "size_bytes": p.stat().st_size,
        "original_filename": f"{asset_id}.mp4",
        "stored_path": str(p),
        "url": f"https://example.com/{asset_id}",
        "uploaded_at": "2026-06-10T00:00:00+00:00",
        "draft_id": None,
    })
    return str(p)


# ── Direct gateway helper coverage ─────────────────────────────────────
async def test_chunked_upload_walks_upload_phases():
    """Verifies _upload_advideo_chunked hits start → transfer → finish
    on graph-video.facebook.com and returns the video_id."""
    from services.ads_gateway.meta import _upload_advideo_chunked, GRAPH_VIDEO_BASE
    from services.ads_gateway.base import CreateCampaignSpec

    file_path = Path("/tmp/iter355_chunk_test.mp4")
    file_path.write_bytes(b"X" * 2048)

    spec = CreateCampaignSpec(
        maker_slug="m", listing_slug="l", listing_title="T",
        listing_description="D", listing_url="https://x/y",
        listing_image_url="https://x/thumb.jpg", daily_budget_cents=500,
        video_asset_path=str(file_path), video_asset_mime="video/mp4",
    )

    url = f"{GRAPH_VIDEO_BASE}/act_999/advideos"
    seen_phases: list[str] = []
    call_count = {"n": 0}

    def _route(request):
        call_count["n"] += 1
        # First call is `start` (urlencoded), middle calls are `transfer`
        # (multipart with video_file_chunk), last call is `finish`.
        body_bytes = request.read()
        try:
            body_str = body_bytes.decode("utf-8", errors="replace")
        except Exception:
            body_str = ""
        if "upload_phase=start" in body_str:
            seen_phases.append("start")
            return Response(200, json={
                "upload_session_id": "sess_1",
                "video_id": "vid_42",
                "start_offset": "0",
                "end_offset": "1024",
            })
        if b"video_file_chunk" in body_bytes:
            seen_phases.append("transfer")
            # First transfer: advance to 2048 (file size 2048 → 2nd chunk).
            # Second transfer would be detected by the test exhausting, but
            # since we set start=2048,end=2048 it exits the loop.
            return Response(200, json={
                "start_offset": "2048",
                "end_offset": "2048",
            })
        if "upload_phase=finish" in body_str:
            seen_phases.append("finish")
            return Response(200, json={"success": True})
        return Response(400, json={"error": "unmatched"})

    async with respx.mock(assert_all_called=False) as router:
        router.post(url).mock(side_effect=_route)
        import httpx
        async with httpx.AsyncClient(timeout=10) as http:
            video_id = await _upload_advideo_chunked(http, "act_999", "TKN", spec)

    assert video_id == "vid_42"
    assert seen_phases[0] == "start"
    assert "transfer" in seen_phases
    assert seen_phases[-1] == "finish"


async def test_poll_video_status_returns_when_ready():
    from services.ads_gateway.meta import _poll_video_status, GRAPH_BASE
    import services.ads_gateway.meta as meta_mod
    meta_mod.VIDEO_PROCESS_POLL_INTERVAL_SEC = 0.01  # speed up
    meta_mod.VIDEO_PROCESS_POLL_MAX_ATTEMPTS = 5

    url = f"{GRAPH_BASE}/vid_42"
    calls = {"n": 0}

    def _route(request):
        calls["n"] += 1
        body = {"status": {"video_status": "ready" if calls["n"] >= 2 else "processing"}}
        return Response(200, json=body)

    async with respx.mock(assert_all_called=False) as router:
        router.get(url).mock(side_effect=_route)
        import httpx
        async with httpx.AsyncClient(timeout=5) as http:
            await _poll_video_status(http, "TKN", "vid_42")

    assert calls["n"] >= 2


async def test_poll_video_status_raises_on_error_state():
    from services.ads_gateway.meta import _poll_video_status, GRAPH_BASE
    from services.ads_gateway.base import GatewayError
    import services.ads_gateway.meta as meta_mod
    meta_mod.VIDEO_PROCESS_POLL_INTERVAL_SEC = 0.01

    url = f"{GRAPH_BASE}/vid_42"
    async with respx.mock(assert_all_called=False) as router:
        router.get(url).mock(return_value=Response(
            200, json={"status": {"video_status": "error"}}
        ))
        import httpx
        with pytest.raises(GatewayError):
            async with httpx.AsyncClient(timeout=5) as http:
                await _poll_video_status(http, "TKN", "vid_42")


async def test_create_video_creative_posts_object_story_spec():
    from services.ads_gateway.meta import _create_video_creative, GRAPH_BASE
    from services.ads_gateway.base import CreateCampaignSpec

    spec = CreateCampaignSpec(
        maker_slug="m", listing_slug="l", listing_title="Test",
        listing_description="D",
        listing_url="https://x/y?utm=1",
        listing_image_url="https://x/thumb.jpg",
        daily_budget_cents=500,
        headlines=["Hand-Made Magic"],
        descriptions=["Crafted carefully, just for you."],
        video_asset_path="/tmp/whatever.mp4",
        video_thumbnail_url="https://x/custom.jpg",
    )

    url = f"{GRAPH_BASE}/act_999/adcreatives"
    captured: dict = {}

    def _route(request):
        body = request.read().decode("utf-8")
        captured["body"] = body
        return Response(200, json={"id": "creative_99"})

    async with respx.mock(assert_all_called=True) as router:
        router.post(url).mock(side_effect=_route)
        import httpx
        async with httpx.AsyncClient(timeout=5) as http:
            cid = await _create_video_creative(http, "act_999", "TKN", spec, "vid_42")

    assert cid == "creative_99"
    # The object_story_spec is URL-encoded JSON in the body.
    assert "object_story_spec" in captured["body"]
    # Decode the form param to verify video_data shape.
    from urllib.parse import parse_qs, unquote_plus
    params = parse_qs(captured["body"])
    spec_json = unquote_plus(params["object_story_spec"][0])
    parsed = json.loads(spec_json)
    assert parsed["page_id"] == "111"
    vd = parsed["video_data"]
    assert vd["video_id"] == "vid_42"
    assert vd["image_url"] == "https://x/custom.jpg"
    assert vd["title"] == "Hand-Made Magic"
    assert vd["message"].startswith("Crafted carefully")
    assert vd["call_to_action"]["type"] == "SHOP_NOW"
    assert vd["call_to_action"]["value"]["link"].startswith("https://x/y?utm=1&fbclid=")


# ── Router-level coverage ─────────────────────────────────────────────
async def test_push_meta_with_video_asset_marks_creative_kind():
    """End-to-end: POST /admin/ad-creative/drafts/{id}/push/meta with
    video_asset_id → the gateway's create_campaign is monkey-patched to
    confirm it received `video_asset_path`, and the push_doc records
    creative_kind=video."""
    from core import db
    from services.ads_gateway import meta as meta_mod
    from services.ads_gateway.base import CampaignHandle

    draft = _draft_doc("iter355_draft_v1")
    await db.ad_creative_drafts.insert_one(draft)
    await _seed_video_asset("iter355_vid_ok", kind="video")

    received_specs: list = []

    async def fake_create_campaign(self, spec):
        received_specs.append(spec)
        return CampaignHandle(
            channel="meta", external_id="ext_meta_77", status="paused",
            note="ok",
        )

    orig = meta_mod.MetaGateway.create_campaign
    meta_mod.MetaGateway.create_campaign = fake_create_campaign
    try:
        from server import app
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post(
                "/api/admin/ad-creative/drafts/iter355_draft_v1/push/meta",
                json={"daily_budget_cents": 1000, "video_asset_id": "iter355_vid_ok"},
                headers=_admin_headers(),
            )
    finally:
        meta_mod.MetaGateway.create_campaign = orig

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["push"]["creative_kind"] == "video"
    assert body["push"]["video_asset_id"] == "iter355_vid_ok"
    assert body["push"]["external_campaign_id"] == "ext_meta_77"
    assert "video creative" in body["message"]

    assert len(received_specs) == 1
    spec = received_specs[0]
    assert spec.video_asset_path  # gateway got the disk path
    assert spec.video_asset_mime == "video/mp4"


async def test_push_meta_rejects_image_asset_with_400():
    from core import db
    from services.ads_gateway import meta as meta_mod
    from services.ads_gateway.base import CampaignHandle

    draft = _draft_doc("iter355_draft_v2")
    await db.ad_creative_drafts.insert_one(draft)
    await _seed_video_asset("iter355_img_bad", kind="image")

    async def fake_create_campaign(self, spec):  # should not be reached
        return CampaignHandle(channel="meta", external_id="x", status="paused")
    orig = meta_mod.MetaGateway.create_campaign
    meta_mod.MetaGateway.create_campaign = fake_create_campaign
    try:
        from server import app
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post(
                "/api/admin/ad-creative/drafts/iter355_draft_v2/push/meta",
                json={"daily_budget_cents": 1000, "video_asset_id": "iter355_img_bad"},
                headers=_admin_headers(),
            )
    finally:
        meta_mod.MetaGateway.create_campaign = orig

    assert r.status_code == 400, r.text
    assert "video" in r.json()["detail"].lower()


async def test_push_meta_unknown_video_asset_returns_404():
    from core import db
    draft = _draft_doc("iter355_draft_v3")
    await db.ad_creative_drafts.insert_one(draft)

    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/admin/ad-creative/drafts/iter355_draft_v3/push/meta",
            json={"daily_budget_cents": 1000, "video_asset_id": "iter355_missing"},
            headers=_admin_headers(),
        )
    assert r.status_code == 404
