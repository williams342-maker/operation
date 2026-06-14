"""iter413ad — Pinterest Rich Pin validator endpoint contract.

Locks down the new `POST /api/admin/seo-agent/pinterest-validate`
endpoint that powers the "Validate Rich Pins" button in the SEO Agent
admin tab. Pinterest doesn't expose a public validator API, so this
endpoint fetches the page server-side, parses OG + article:* meta tags,
and reports what Pinterest's crawler would see.

Contract pinned:
  • Endpoint exists + auth-gates correctly (admin-only).
  • Same-origin guard rejects external hosts (anti-SSRF).
  • Happy-path against the apex homepage returns the expected shape:
    checks list, og:type, all_required_present, missing_required,
    debugger_url that points at Pinterest's URL Debugger.
  • Tag parser handles both attribute orders (property-first +
    content-first) so React-rendered HTML works either way.
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
ENDPOINT = f"{API}/admin/seo-agent/pinterest-validate"


@pytest.fixture(scope="module")
def headers():
    email = os.environ.get("OPS_EMAIL") or "team@craftersmarket.org"
    magic = issue_admin_magic_token(email)
    r = requests.post(f"{API}/admin/auth/verify", json={"token": magic}, timeout=15)
    assert r.status_code == 200, r.text
    jwt = r.json()["token"]
    return {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}


def test_pinterest_validate_requires_admin():
    """No bearer token → 401/403."""
    r = requests.post(ENDPOINT, json={"url": "https://craftersmarket.org/"}, timeout=10)
    assert r.status_code in (401, 403)


def test_pinterest_validate_rejects_external_host(headers):
    """Anti-SSRF: only same-origin URLs allowed."""
    r = requests.post(
        ENDPOINT,
        json={"url": "https://example.com/"},
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 400
    assert "not allowed" in r.text.lower()


def test_pinterest_validate_rejects_empty_url(headers):
    r = requests.post(ENDPOINT, json={"url": ""}, headers=headers, timeout=10)
    assert r.status_code == 400


def test_pinterest_validate_homepage_shape(headers):
    """Happy path: apex homepage returns a fully-shaped response."""
    r = requests.post(
        ENDPOINT,
        json={"url": "https://craftersmarket.org/"},
        headers=headers,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    # Top-level keys we render in the UI
    for k in (
        "url", "fetched_url", "status_code", "fetch_error",
        "og_type", "rules_applied", "checks",
        "all_required_present", "missing_required", "debugger_url",
    ):
        assert k in d, f"missing key: {k}"
    # Pinterest URL Debugger link must point at the official tool
    assert d["debugger_url"].startswith("https://developers.pinterest.com/tools/url-debugger/")
    # Per-tag checks list
    assert isinstance(d["checks"], list)
    assert len(d["checks"]) > 0
    for c in d["checks"]:
        for k in ("tag", "required", "present", "value"):
            assert k in c
        assert isinstance(c["required"], bool)
        assert isinstance(c["present"], bool)
    # At minimum og:type, og:title, og:description, og:url, og:image must
    # be in the checks list (they're the required tags for any og:type).
    tags = {c["tag"] for c in d["checks"]}
    for required in ("og:type", "og:title", "og:description", "og:url", "og:image"):
        assert required in tags, f"missing required tag in checks: {required}"


def test_pinterest_validate_meta_parser_handles_both_attr_orders():
    """The internal meta-tag regex must capture both common React-rendered
    attribute orders (property-first and content-first)."""
    from routers.seo_agent import _parse_meta_tags

    html = '''
      <meta property="og:title" content="A property-first title" />
      <meta content="A content-first description" name="og:description" />
      <meta name="article:section" content="Design Files">
    '''
    metas = _parse_meta_tags(html)
    assert metas.get("og:title") == "A property-first title"
    assert metas.get("og:description") == "A content-first description"
    assert metas.get("article:section") == "Design Files"
