"""iter92 — Regression guard: site_root() must never return a preview URL,
even when PUBLIC_BACKEND_URL env var is populated with a preview domain
(happens on Emergent deploys where .env is shipped as-is at build time).

Fix location: /app/backend/core.py::site_root
Root cause previously: function blindly trusted PUBLIC_BACKEND_URL.
"""
import importlib
import os
from unittest.mock import patch


class _FakeReq:
    def __init__(self, fwd_host: str = "", fwd_proto: str = "https"):
        self.headers = {}
        if fwd_host:
            self.headers["x-forwarded-host"] = fwd_host
        self.headers["x-forwarded-proto"] = fwd_proto


def _fresh_core():
    """Re-import core with current env so module-level vars pick up the patch."""
    import core
    return importlib.reload(core)


PREVIEW_MARKERS = [
    "https://active-project-4.preview.emergentagent.com",
    "https://foo.emergent.host",
    "https://my-app.vercel.app",
    "https://bar.onrender.com",
    "http://localhost:3000",
    "https://staging.example.com",
]


def test_looks_like_preview_detects_all_known_markers():
    import core
    for origin in PREVIEW_MARKERS:
        assert core._looks_like_preview(origin) is True, origin
    assert core._looks_like_preview("https://craftersmarket.org") is False
    assert core._looks_like_preview("") is True  # empty → fall through


def test_site_root_falls_back_when_backend_url_is_preview():
    """If PUBLIC_BACKEND_URL is preview AND PUBLIC_SITE_URL is unset,
    site_root must NOT return the preview URL — it must fall back to
    forwarded host (if clean) or the canonical constant."""
    env = {
        "MONGO_URL": os.environ["MONGO_URL"],
        "DB_NAME": os.environ["DB_NAME"],
        "PUBLIC_BACKEND_URL": "https://active-project-4.preview.emergentagent.com",
        "PUBLIC_SITE_URL": "",
    }
    with patch.dict(os.environ, env, clear=False):
        core = _fresh_core()
        # No forwarded host → safety net kicks in
        assert core.site_root(_FakeReq()) == core._CANONICAL_SITE_ROOT
        # Preview forwarded host → still safety net
        assert core.site_root(
            _FakeReq("active-project-4.preview.emergentagent.com")
        ) == core._CANONICAL_SITE_ROOT
        # Clean forwarded host → use it
        assert core.site_root(_FakeReq("craftersmarket.org")) == "https://craftersmarket.org"


def test_site_root_prefers_explicit_public_site_url():
    env = {
        "MONGO_URL": os.environ["MONGO_URL"],
        "DB_NAME": os.environ["DB_NAME"],
        "PUBLIC_BACKEND_URL": "https://active-project-4.preview.emergentagent.com",
        "PUBLIC_SITE_URL": "https://craftersmarket.org",
    }
    with patch.dict(os.environ, env, clear=False):
        core = _fresh_core()
        # Even with preview backend URL and preview forwarded host,
        # explicit PUBLIC_SITE_URL must win.
        assert core.site_root(
            _FakeReq("preview.emergentagent.com")
        ) == "https://craftersmarket.org"


def test_site_root_ignores_preview_public_site_url():
    """Defensive: if operator accidentally sets PUBLIC_SITE_URL to a
    preview domain, we still refuse to emit it."""
    env = {
        "MONGO_URL": os.environ["MONGO_URL"],
        "DB_NAME": os.environ["DB_NAME"],
        "PUBLIC_BACKEND_URL": "",
        "PUBLIC_SITE_URL": "https://myapp.preview.emergentagent.com",
    }
    with patch.dict(os.environ, env, clear=False):
        core = _fresh_core()
        assert core.site_root(_FakeReq()) == core._CANONICAL_SITE_ROOT
