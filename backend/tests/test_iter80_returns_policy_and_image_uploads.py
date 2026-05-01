"""
Iter80 — Per-shop returns/exchange policy fields + Maker portrait/cover image uploads.

Covers:
  1. PATCH /api/maker/profile accepts the new structured returns-policy fields
     (accepts_returns_default, accepts_exchanges_default, return_window_days,
      return_shipping_paid_by, restocking_fee_pct, non_returnable_items)
     and persists them on the maker doc.
  2. POST /api/maker/uploads/portrait + /api/maker/uploads/cover
     authenticate, accept multipart, push bytes to R2, and persist the
     returned CDN URL onto the maker doc (`portrait` / `cover` fields).
  3. The endpoints reject unauthenticated callers (401).
"""
import io
import os
import sys
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
from maker_auth import issue_magic_token  # noqa: E402

API = os.environ.get(
    "PUBLIC_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")
EMAIL = "iron-and-oak@craftersmarket.org"

# 1×1 transparent PNG (smallest valid PNG)
TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c63f80f000000ff00010100050000000049454e44ae426082"
)


def _jwt() -> str:
    magic = issue_magic_token(EMAIL)
    r = requests.post(f"{API}/api/maker/auth/verify", json={"token": magic}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def test_unauth_uploads_rejected():
    for path in ("portrait", "cover"):
        r = requests.post(f"{API}/api/maker/uploads/{path}", timeout=10)
        assert r.status_code == 401, (path, r.status_code, r.text)


def test_portrait_and_cover_upload_persist():
    jwt = _jwt()
    h = {"Authorization": f"Bearer {jwt}"}

    for kind, expected_folder in (("portrait", "portraits"), ("cover", "covers")):
        files = {"file": (f"t.png", io.BytesIO(TINY_PNG), "image/png")}
        r = requests.post(f"{API}/api/maker/uploads/{kind}", headers=h, files=files, timeout=30)
        assert r.status_code == 200, (kind, r.status_code, r.text)
        body = r.json()
        assert "url" in body and body["url"].startswith("http")
        assert f"/{expected_folder}/" in body["url"]

        # Verify persisted on maker doc
        me = requests.get(f"{API}/api/maker/me", headers=h, timeout=10).json()
        assert me.get(kind) == body["url"], (kind, me.get(kind), body["url"])


def test_returns_policy_patch_persists():
    jwt = _jwt()
    h = {"Authorization": f"Bearer {jwt}"}
    payload = {
        "accepts_returns_default": True,
        "accepts_exchanges_default": False,
        "return_window_days": 30,
        "return_shipping_paid_by": "seller",
        "restocking_fee_pct": 10,
        "non_returnable_items": "Custom items only.",
    }
    r = requests.patch(f"{API}/api/maker/profile", headers=h, json=payload, timeout=15)
    assert r.status_code == 200, (r.status_code, r.text)
    body = r.json()
    for k, v in payload.items():
        assert body.get(k) == v, (k, body.get(k), v)


def test_bad_image_rejected():
    jwt = _jwt()
    h = {"Authorization": f"Bearer {jwt}"}
    files = {"file": ("nope.txt", io.BytesIO(b"not an image"), "text/plain")}
    r = requests.post(f"{API}/api/maker/uploads/portrait", headers=h, files=files, timeout=15)
    assert r.status_code == 400, (r.status_code, r.text)


if __name__ == "__main__":
    test_unauth_uploads_rejected(); print("✓ unauth rejected")
    test_portrait_and_cover_upload_persist(); print("✓ uploads persist")
    test_returns_policy_patch_persists(); print("✓ policy patch persists")
    test_bad_image_rejected(); print("✓ bad MIME rejected")
    print("\nAll iter80 checks passed.")
