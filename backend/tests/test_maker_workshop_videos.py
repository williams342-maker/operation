"""Regression: Maker workshop videos (iter186)."""
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


# ───── URL parser unit tests ──────────────────────────────────────────────

@pytest.mark.parametrize("url, provider, vid", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ?t=42", "youtube", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/shorts/abc123XYZ_-", "youtube", "abc123XYZ_-"),
    ("https://www.youtube.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"),
    ("youtu.be/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"),  # no scheme
    ("https://vimeo.com/123456789", "vimeo", "123456789"),
    ("https://player.vimeo.com/video/987654321", "vimeo", "987654321"),
])
def test_parse_video_url_known_shapes(url, provider, vid):
    from routers.maker_workshop_videos import parse_video_url
    p = parse_video_url(url)
    assert p is not None, f"Failed to parse: {url}"
    assert p["provider"] == provider
    assert p["video_id"] == vid


@pytest.mark.parametrize("url", [
    "",
    "not a url",
    "https://twitch.tv/somebody",       # unsupported host
    "https://www.youtube.com/",         # no video id
    "https://vimeo.com/notanumber",     # bad vimeo id
    "https://www.youtube.com/watch?v=", # blank id
])
def test_parse_video_url_rejects_bad_inputs(url):
    from routers.maker_workshop_videos import parse_video_url
    assert parse_video_url(url) is None


# ───── Endpoint lifecycle ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_workshop_video_full_lifecycle():
    """add → list → reorder → delete, all under one maker."""
    jwt = await _maker_jwt()
    h = {"Authorization": f"Bearer {jwt}"}

    # Clean slate so prior runs don't pollute the cap.
    from core import db
    await db.makers.update_one({"slug": "williams-cnc"},
                               {"$set": {"workshop_videos": []}})

    urls = [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/9bZkp7q19f0",
        "https://vimeo.com/76979871",
    ]

    added_ids: list[str] = []
    async with httpx.AsyncClient(timeout=30) as c:
        for u in urls:
            r = await c.post(
                f"{API}/api/maker/workshop-videos", headers=h,
                json={"url": u, "title": f"Demo for {u[-6:]}"},
            )
            assert r.status_code == 200, r.text
            added_ids.append(r.json()["video"]["id"])

    # List
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/maker/workshop-videos", headers=h)
    body = r.json()
    assert len(body["items"]) == 3
    assert body["max"] == 6
    # Order matches insertion.
    assert [v["id"] for v in body["items"]] == added_ids

    # Reorder — reverse
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.patch(
            f"{API}/api/maker/workshop-videos/reorder", headers=h,
            json={"video_ids": list(reversed(added_ids))},
        )
    assert r.status_code == 200
    assert [v["id"] for v in r.json()["items"]] == list(reversed(added_ids))

    # Duplicate rejected
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/workshop-videos", headers=h,
            json={"url": urls[0]},
        )
    assert r.status_code == 409
    assert "already added" in r.json()["detail"].lower()

    # Public maker doc surfaces the videos (so the public profile can render).
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/makers/williams-cnc")
    pub = r.json()
    assert len(pub.get("workshop_videos") or []) == 3

    # Delete by row id
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.delete(
            f"{API}/api/maker/workshop-videos/{added_ids[0]}", headers=h,
        )
    assert r.status_code == 200
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/maker/workshop-videos", headers=h)
    assert len(r.json()["items"]) == 2

    # Cleanup
    await db.makers.update_one({"slug": "williams-cnc"},
                               {"$set": {"workshop_videos": []}})


@pytest.mark.asyncio
async def test_workshop_video_rejects_bad_url():
    jwt = await _maker_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/workshop-videos",
            headers={"Authorization": f"Bearer {jwt}"},
            json={"url": "https://twitch.tv/somebody"},
        )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_workshop_video_enforces_cap():
    """7th add → 409."""
    jwt = await _maker_jwt()
    h = {"Authorization": f"Bearer {jwt}"}
    from core import db
    await db.makers.update_one({"slug": "williams-cnc"},
                               {"$set": {"workshop_videos": []}})

    # 11 distinct YouTube IDs (chars from `[A-Za-z0-9_-]`).
    ids = ["aBcDef00001", "aBcDef00002", "aBcDef00003", "aBcDef00004",
           "aBcDef00005", "aBcDef00006", "aBcDef00007"]
    async with httpx.AsyncClient(timeout=30) as c:
        for i, vid in enumerate(ids):
            r = await c.post(
                f"{API}/api/maker/workshop-videos", headers=h,
                json={"url": f"https://youtu.be/{vid}"},
            )
            if i < 6:
                assert r.status_code == 200, f"row {i}: {r.text}"
            else:
                # 7th → cap rejection
                assert r.status_code == 409
                assert "cap" in r.json()["detail"].lower()

    # Cleanup
    await db.makers.update_one({"slug": "williams-cnc"},
                               {"$set": {"workshop_videos": []}})


@pytest.mark.asyncio
async def test_workshop_video_requires_maker_auth():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/maker/workshop-videos")
    assert r.status_code in (401, 403)
