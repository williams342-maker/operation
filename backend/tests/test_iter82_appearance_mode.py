"""
Iter82 — Maker Dashboard light-mode toggle persistence.

Covers the new `appearance_mode` field on the maker doc and confirms it
round-trips through the maker profile PATCH endpoint.
"""
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


def _jwt() -> str:
    tok = issue_magic_token(EMAIL)
    r = requests.post(f"{API}/api/maker/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def test_appearance_mode_toggle():
    h = {"Authorization": f"Bearer {_jwt()}"}

    # Default fetch — value should be either "dark" or absent (legacy doc).
    me = requests.get(f"{API}/api/maker/me", headers=h, timeout=10).json()
    initial = me.get("appearance_mode") or "dark"

    # Flip to light
    r = requests.patch(
        f"{API}/api/maker/profile", headers=h,
        json={"appearance_mode": "light"}, timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("appearance_mode") == "light"

    # Flip back to dark
    r = requests.patch(
        f"{API}/api/maker/profile", headers=h,
        json={"appearance_mode": "dark"}, timeout=15,
    )
    assert r.status_code == 200
    assert r.json().get("appearance_mode") == "dark"

    # Restore caller's original setting so the test is non-destructive.
    requests.patch(
        f"{API}/api/maker/profile", headers=h,
        json={"appearance_mode": initial}, timeout=15,
    )


if __name__ == "__main__":
    test_appearance_mode_toggle(); print("✓ appearance_mode toggle persists")
    print("\niter82 check passed.")
