"""iter413cv — Compass brand application across customer-facing surfaces.

Verifies:
  • Email `_shell()` includes the new "Ask Compass" CTA + deep-link.
  • Crafters Market masthead remains the parent brand on emails.
  • Existing email branding contract (iter413ah) still green.
  • /brand/* SVG assets HTTP 200 with correct content-type.
  • index.html now declares the SVG favicon link.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")
FRONTEND_BASE = BASE_URL  # in this env they share host


def test_email_shell_introduces_compass():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from email_service import _shell
    html = _shell("Test", "Intro line", "<p>body</p>")
    # Soft Compass intro at the foot.
    assert "Ask Compass" in html, "Email shell missing Compass CTA"
    assert "/?compass=1" in html, "Email shell missing deep-link target"
    assert "your marketplace assistant" in html.lower()
    # Crafters Market remains the masthead brand.
    assert "Crafters Market" in html, "Crafters Market masthead missing"
    assert "Built on craft · Driven by makers" in html, "Brand tagline missing"


def test_email_shell_respects_frontend_url_for_compass_link(monkeypatch):
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    import importlib
    import email_service
    monkeypatch.setenv("FRONTEND_URL", "https://test.craftersmarket.org")
    importlib.reload(email_service)
    html = email_service._shell("X", "y", "<p>z</p>")
    assert "https://test.craftersmarket.org/?compass=1" in html
    # Reset env to avoid bleeding into later tests.
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    importlib.reload(email_service)


@pytest.mark.parametrize("path,expected_ct", [
    ("/brand/compass-master.svg", "image/svg"),
    ("/brand/compass-light.svg", "image/svg"),
    ("/brand/compass-dark.svg", "image/svg"),
    ("/brand/compass-brand.svg", "image/svg"),
    ("/brand/compass-avatar.svg", "image/svg"),
    ("/brand/compass-favicon.svg", "image/svg"),
])
def test_brand_assets_served(path: str, expected_ct: str):
    r = requests.get(f"{FRONTEND_BASE}{path}", timeout=10)
    assert r.status_code == 200, f"{path} returned {r.status_code}"
    ct = r.headers.get("Content-Type", "")
    assert expected_ct in ct, f"{path} content-type={ct}"


def test_index_html_declares_svg_favicon():
    r = requests.get(f"{FRONTEND_BASE}/", timeout=15)
    assert r.status_code == 200
    body = r.text
    assert '/brand/compass-favicon.svg' in body, "SVG favicon link missing from index.html"
    assert 'rel="mask-icon"' in body and '/brand/compass-master.svg' in body, "Safari mask-icon missing"
