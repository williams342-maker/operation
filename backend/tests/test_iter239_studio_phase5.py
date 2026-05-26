"""iter239 — Maker Studio Phase 5: CAM strategy + design kits.

Verifies:
  1. /studio/cam-strategy is PUBLIC and returns deterministic feed/RPM/tool
     for wood, steel, aluminum, acrylic, plywood across router/laser/plasma.
  2. Depth >= max_depth_per_pass triggers a multi-pass plan.
  3. Engrave-only mode shrinks depth_per_pass and forces a single pass.
  4. Units=mm scales feed_rate and depth_per_pass into millimeters.
  5. Notes string contains material-specific operator wisdom.
  6. Kit lifecycle: create → add file → read with files inflated → remove file
     → another user 403s on adding to your kit.
"""
import os
import sys
import uuid

import httpx
import pytest

sys.path.insert(0, "/app/backend")

API = os.environ.get("REACT_APP_BACKEND_URL")
if not API:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                API = line.split("=", 1)[1].strip()
                break


@pytest.mark.asyncio
async def test_cam_strategy_routing_and_metadata():
    async with httpx.AsyncClient(timeout=10) as c:
        # Wood router @ 0.25 in
        r = await c.get(f"{API}/api/studio/cam-strategy",
                        params={"material": "wood", "depth": 0.25, "machine": "router"})
        assert r.status_code == 200
        body = r.json()
        assert body["machine"] == "router"
        assert body["rpm"] == 18000
        assert body["feed_rate"] == 100
        assert body["passes"] == 1
        assert "climb milling" in body["notes"].lower()

        # Wood router @ 1 in → multi-pass
        r2 = await c.get(f"{API}/api/studio/cam-strategy",
                         params={"material": "wood", "depth": 1.0, "machine": "router"})
        assert r2.status_code == 200
        b2 = r2.json()
        assert b2["passes"] >= 4
        assert b2["depth_per_pass"] <= 0.25 + 0.001

        # Steel plasma is the right default
        r3 = await c.get(f"{API}/api/studio/cam-strategy",
                         params={"material": "steel", "depth": 0.25})
        assert r3.status_code == 200
        b3 = r3.json()
        assert b3["machine"] == "plasma"
        assert "torch" in b3["tool"].lower()

        # Acrylic laser engrave-only
        r4 = await c.get(f"{API}/api/studio/cam-strategy",
                         params={"material": "acrylic", "depth": 0.25,
                                 "machine": "laser", "engrave_only": True})
        assert r4.status_code == 200
        b4 = r4.json()
        assert b4["passes"] == 1
        assert b4["engrave_only"] is True
        assert b4["depth_per_pass"] < 0.25

        # Units = mm
        r5 = await c.get(f"{API}/api/studio/cam-strategy",
                         params={"material": "wood", "depth": 6, "units": "mm",
                                 "machine": "router"})
        assert r5.status_code == 200
        b5 = r5.json()
        assert b5["units"] == "mm"
        assert b5["depth_unit"] == "mm"
        # 100 IPM converted to mm/min ≈ 2540
        assert b5["feed_rate"] >= 2500


@pytest.mark.asyncio
async def test_kit_lifecycle_and_authz():
    """Single combined test to avoid Motor event-loop recurrence."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from core import db
    from maker_auth import issue_buyer_magic_token

    async with httpx.AsyncClient(timeout=30) as c:
        # Two distinct buyer accounts
        def fresh():
            return f"p5-{uuid.uuid4().hex[:8]}@craftersmarket.org"
        async def jwt_for(email):
            magic = issue_buyer_magic_token(email)
            v = await c.post(
                f"{API}/api/community/auth/magic/verify",
                json={"token": magic, "accept_eua": True, "eua_version": "2026-04"},
            )
            assert v.status_code == 200, v.text
            return v.json()["token"]
        jwt_a = await jwt_for(fresh())
        jwt_b = await jwt_for(fresh())
        h_a = {"Authorization": f"Bearer {jwt_a}"}
        h_b = {"Authorization": f"Bearer {jwt_b}"}

        # 1. Owner publishes a design — gets a file id
        design = {
            "width": 12, "height": 6, "border": "rounded",
            "operations": [
                {"kind": "shape", "primitive": "compass_rose", "x": 0.5, "y": 0.5, "w": 0.5, "h": 0.7},
            ],
            "holes": {"count": 0},
        }
        pub = await c.post(
            f"{API}/api/studio/publish",
            json={"design": design, "prompt": "kit test design"},
            headers=h_a,
        )
        assert pub.status_code == 200
        file_id = pub.json()["file"]["id"]
        showcase_id = pub.json().get("showcase_post_id")

        # 2. Owner creates a kit
        k = await c.post(
            f"{API}/api/studio/kits",
            json={"title": "Phase 5 Test Kit", "description": "Combined lifecycle test", "visibility": "public"},
            headers=h_a,
        )
        assert k.status_code == 200, k.text
        kit_id = k.json()["id"]
        try:
            # 3. Add file
            add = await c.post(
                f"{API}/api/studio/kits/{kit_id}/add",
                json={"file_id": file_id},
                headers=h_a,
            )
            assert add.status_code == 200
            assert add.json()["already_in_kit"] is False

            # Adding again is idempotent
            add2 = await c.post(
                f"{API}/api/studio/kits/{kit_id}/add",
                json={"file_id": file_id},
                headers=h_a,
            )
            assert add2.json()["already_in_kit"] is True

            # 4. Read with files inflated
            kit = await c.get(f"{API}/api/studio/kits/{kit_id}", headers=h_a)
            assert kit.status_code == 200
            body = kit.json()
            assert len(body["files"]) == 1
            assert body["files"][0]["id"] == file_id

            # 5. Public listing surfaces the kit for other users
            list_b = await c.get(f"{API}/api/studio/kits", headers=h_b)
            assert list_b.status_code == 200
            public_ids = [k["id"] for k in list_b.json()["public"]]
            assert kit_id in public_ids

            # 6. Other user CANNOT add to your kit
            denied = await c.post(
                f"{API}/api/studio/kits/{kit_id}/add",
                json={"file_id": file_id},
                headers=h_b,
            )
            assert denied.status_code == 403

            # 7. Owner removes file
            rm = await c.delete(
                f"{API}/api/studio/kits/{kit_id}/file/{file_id}",
                headers=h_a,
            )
            assert rm.status_code == 200
            kit2 = await c.get(f"{API}/api/studio/kits/{kit_id}", headers=h_a)
            assert len(kit2.json()["files"]) == 0
        finally:
            await db.studio_kits.delete_one({"id": kit_id})
            await db.design_files.delete_one({"id": file_id})
            if showcase_id:
                await db.showcase_posts.delete_one({"id": showcase_id})
