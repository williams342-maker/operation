"""
Test the eager listing-image upload endpoint added to fix the slow / failing
product save flow on production. The editor used to ship base64 images
inside the create/update JSON which timed out at the ingress when listings
had several large photos.

Covers:
  1. POST /api/maker/uploads/listing-image rejects unauthenticated callers.
  2. Authenticated upload returns { url, size }, and the URL points at R2.
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

# 1×1 transparent PNG (smallest valid PNG).
TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c63f80f000000ff00010100050000000049454e44ae426082"
)


def _jwt() -> str:
    magic = issue_magic_token(EMAIL)
    r = requests.post(f"{API}/api/maker/auth/verify", json={"token": magic}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def test_unauth_listing_image_upload_rejected():
    r = requests.post(f"{API}/api/maker/uploads/listing-image", timeout=10)
    assert r.status_code == 401, (r.status_code, r.text)


def test_listing_image_upload_returns_url():
    jwt = _jwt()
    h = {"Authorization": f"Bearer {jwt}"}
    files = {"file": ("t.png", io.BytesIO(TINY_PNG), "image/png")}
    r = requests.post(
        f"{API}/api/maker/uploads/listing-image", headers=h, files=files, timeout=30,
    )
    assert r.status_code == 200, (r.status_code, r.text)
    body = r.json()
    assert "url" in body and body["url"].startswith("http"), body
    # Listing photos are written under products/<maker-slug>/…
    assert "/products/" in body["url"], body
    assert body.get("size") == len(TINY_PNG), body


def test_listing_image_upload_rejects_oversized():
    jwt = _jwt()
    h = {"Authorization": f"Bearer {jwt}"}
    # 11 MB of junk — past the 10MB cap.
    big = io.BytesIO(b"\x00" * (11 * 1024 * 1024))
    files = {"file": ("big.png", big, "image/png")}
    r = requests.post(
        f"{API}/api/maker/uploads/listing-image", headers=h, files=files, timeout=30,
    )
    assert r.status_code == 400, (r.status_code, r.text)
    assert "10 MB" in r.text or "smaller" in r.text.lower(), r.text
