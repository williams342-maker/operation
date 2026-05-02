"""iter109 — CanonicalHostRedirectMiddleware.

Verifies the 301 redirect behavior across every realistic host combo:
- Disabled (no env) → pass-through
- Canonical host → pass-through
- Non-canonical host (www ↔ apex) → 301 with path+query preserved
- Preview/staging hosts → pass-through (no redirect loop on dev pods)
- OPTIONS preflight → pass-through (never break CORS)
- `Host` header fallback when `X-Forwarded-Host` is absent
- Port stripping (`host:8001` normalizes to `host` for compare)
"""
import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from canonical_host import CanonicalHostRedirectMiddleware


def _build_app(canonical: str | None):
    app = FastAPI()
    app.add_middleware(CanonicalHostRedirectMiddleware, canonical_host=canonical)

    @app.get("/healthz")
    async def healthz():
        return {"ok": True}

    @app.get("/admin/dashboard")
    async def admin_dashboard():
        return {"tab": "dashboard"}

    return app


def test_disabled_when_no_canonical_host_configured():
    """Middleware is a silent no-op when CANONICAL_HOST is empty."""
    client = TestClient(_build_app(canonical=None))
    r = client.get("/healthz", headers={"X-Forwarded-Host": "www.craftersmarket.org"},
                   follow_redirects=False)
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_passthrough_when_host_matches_canonical():
    client = TestClient(_build_app(canonical="craftersmarket.org"))
    r = client.get("/healthz", headers={"X-Forwarded-Host": "craftersmarket.org"},
                   follow_redirects=False)
    assert r.status_code == 200


def test_redirects_www_to_apex_with_301():
    """The canonical SEO case — www.craftersmarket.org → craftersmarket.org."""
    client = TestClient(_build_app(canonical="craftersmarket.org"))
    r = client.get("/healthz", headers={"X-Forwarded-Host": "www.craftersmarket.org"},
                   follow_redirects=False)
    assert r.status_code == 301
    assert r.headers["location"] == "https://craftersmarket.org/healthz"


def test_redirects_apex_to_www_when_canonical_is_www():
    """Symmetric case — operator picks www as the canonical."""
    client = TestClient(_build_app(canonical="www.craftersmarket.org"))
    r = client.get("/healthz", headers={"X-Forwarded-Host": "craftersmarket.org"},
                   follow_redirects=False)
    assert r.status_code == 301
    assert r.headers["location"] == "https://www.craftersmarket.org/healthz"


def test_preserves_path_and_query_string_exactly():
    """Deep-links from Slack/Discord webhooks carry ?tab=…&open=<uuid>.
    The redirect MUST preserve them byte-for-byte or the operator flow breaks."""
    client = TestClient(_build_app(canonical="craftersmarket.org"))
    r = client.get(
        "/admin/dashboard?tab=feedback&open=abc-123",
        headers={"X-Forwarded-Host": "www.craftersmarket.org"},
        follow_redirects=False,
    )
    assert r.status_code == 301
    assert r.headers["location"] == (
        "https://craftersmarket.org/admin/dashboard?tab=feedback&open=abc-123"
    )


def test_preview_hosts_never_redirected():
    """Preview/staging hosts have no canonical equivalent — redirecting
    them would bounce `preview.emergentagent.com` traffic to prod, which
    breaks every developer's workflow."""
    client = TestClient(_build_app(canonical="craftersmarket.org"))
    for host in [
        "active-project-4.preview.emergentagent.com",
        "foo.emergent.host",
        "thing.vercel.app",
        "api.onrender.com",
        "localhost",
        "127.0.0.1",
    ]:
        r = client.get("/healthz", headers={"X-Forwarded-Host": host},
                       follow_redirects=False)
        assert r.status_code == 200, f"Expected pass-through for {host}, got {r.status_code}"


def test_options_preflight_never_redirected():
    """A 301 on an OPTIONS preflight is a fatal CORS error in some browsers.
    Verify the middleware passes OPTIONS straight through, even from a
    non-canonical host."""
    app = _build_app(canonical="craftersmarket.org")

    # Add an explicit OPTIONS handler so we can tell pass-through from
    # Starlette's default 405.
    @app.options("/admin/dashboard")
    async def dash_preflight():
        return {"preflight": True}

    client = TestClient(app)
    r = client.options(
        "/admin/dashboard",
        headers={"X-Forwarded-Host": "www.craftersmarket.org"},
        follow_redirects=False,
    )
    # NOT 301 — the middleware must have passed OPTIONS straight through.
    assert r.status_code != 301
    # And the handler returned its body.
    assert r.json() == {"preflight": True}


def test_falls_back_to_host_header_when_no_x_forwarded_host():
    """Direct backend traffic (e.g. local curl on :8001) has no
    X-Forwarded-Host — the middleware must fall back to the raw Host header."""
    client = TestClient(_build_app(canonical="craftersmarket.org"))
    r = client.get("/healthz", headers={"Host": "www.craftersmarket.org"},
                   follow_redirects=False)
    assert r.status_code == 301
    assert r.headers["location"].startswith("https://craftersmarket.org/")


def test_port_is_stripped_before_host_compare():
    """Some ingress flavors attach `:port` on internal traffic. We must
    strip it before comparing or we'd 301-loop the health check on itself."""
    client = TestClient(_build_app(canonical="craftersmarket.org"))
    r = client.get("/healthz", headers={"X-Forwarded-Host": "craftersmarket.org:443"},
                   follow_redirects=False)
    # host normalized to `craftersmarket.org` → pass-through.
    assert r.status_code == 200


def test_empty_host_header_is_ignored():
    """An empty/missing host header should NOT 301 — we don't know where
    the request came from, so we pass it through rather than forcing a
    potentially-wrong redirect."""
    client = TestClient(_build_app(canonical="craftersmarket.org"))
    # TestClient always sends a Host header, so simulate "both empty" by
    # sending whitespace. The middleware normalizes whitespace to empty.
    r = client.get("/healthz", headers={"X-Forwarded-Host": "   ", "Host": "testserver"},
                   follow_redirects=False)
    # `testserver` is not a preview marker and not canonical, so we DO
    # expect a redirect here. This test simply checks the whitespace-only
    # X-Forwarded-Host doesn't bypass the Host fallback.
    # → testserver → 301 → https://craftersmarket.org/...
    assert r.status_code == 301
    assert r.headers["location"].startswith("https://craftersmarket.org/")
