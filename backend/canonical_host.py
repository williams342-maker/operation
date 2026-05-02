"""Canonical-host 301 redirect middleware.

Forces every request hitting a non-canonical hostname (e.g. `www.` subdomain,
old domain aliases, apex when the canonical is `www`, etc.) to 301-redirect
to the canonical equivalent while preserving path + query string. This is
the SEO-correct way to consolidate link equity onto ONE hostname — Google,
Bing, ChatGPT, Perplexity and every other crawler follow 301s and merge
the signals from both URLs into the canonical.

Design:
- Controlled by a single env var `CANONICAL_HOST` (e.g. `craftersmarket.org`
  or `www.craftersmarket.org`). When unset, the middleware is a silent
  no-op so preview deploys never redirect themselves into loops.
- Detects the incoming host via `X-Forwarded-Host` (Cloudflare/K8s ingress)
  with a fall-back to the raw `Host` header. Strips any `:port` before
  compare — ingress sometimes attaches one on backend-internal traffic.
- Redirects any non-canonical host that's NOT a known preview/staging
  marker. Preview hosts are intentionally skipped so `*.preview.emergentagent.com`
  requests never bounce to prod during development.
- Preserves the exact request path + query-string (including weird chars
  like `?tab=feedback&open=<uuid>` from Slack/Discord webhook deep-links).
- OPTIONS preflight requests are NEVER redirected — 301s on preflights
  break CORS in some browsers. We pass them straight through.
- Scheme is always `https` in the redirect target (no reason to ever
  301 to http:// on a canonical host in 2026).
"""
from __future__ import annotations

import os
from typing import Iterable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

# Hosts we will NEVER redirect away from — they have no canonical
# equivalent, so forcing a 301 would be worse than doing nothing.
# Matches are substring (case-insensitive) so `*.preview.emergentagent.com`
# and `localhost:3000` both land in here.
_PREVIEW_MARKERS: tuple[str, ...] = (
    ".preview.emergentagent.com",
    ".emergent.host",
    "vercel.app",
    "onrender.com",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
)


def _strip_port(host: str) -> str:
    """Drop `:port` suffix for host comparison. IPv6 literals aren't
    expected on a public hostname, so the simple `.split(':')` is fine."""
    if not host:
        return ""
    # Handle the (very rare) bare IPv6 form `[::1]:3000`.
    if host.startswith("["):
        close = host.find("]")
        return host[: close + 1] if close != -1 else host
    return host.split(":", 1)[0]


def _looks_like_preview(host: str) -> bool:
    h = (host or "").lower()
    return any(m in h for m in _PREVIEW_MARKERS)


class CanonicalHostRedirectMiddleware(BaseHTTPMiddleware):
    """301 redirects cross-host traffic to `CANONICAL_HOST`."""

    def __init__(self, app, canonical_host: str | None = None,
                 skip_markers: Iterable[str] | None = None):
        super().__init__(app)
        self.canonical_host = (canonical_host
                               or os.environ.get("CANONICAL_HOST") or "").strip().lower()
        # Allow callers/tests to augment the skip list if needed.
        self.skip_markers = tuple(skip_markers) if skip_markers else _PREVIEW_MARKERS

    def _is_preview(self, host: str) -> bool:
        h = (host or "").lower()
        return any(m in h for m in self.skip_markers)

    async def dispatch(self, request: Request, call_next) -> Response:
        # Disabled → pure pass-through. Used on preview pods and when the
        # operator hasn't opted in yet.
        if not self.canonical_host:
            return await call_next(request)

        # CORS preflight must never be redirected — browsers treat a
        # 301 on an OPTIONS preflight as a fatal error on some flows.
        if request.method == "OPTIONS":
            return await call_next(request)

        # Resolve the inbound hostname. Cloudflare + K8s both pass it
        # via X-Forwarded-Host; fall back to the raw Host header for
        # direct backend traffic (e.g. health checks on :8001). We
        # `.strip()` xfh BEFORE the `or` so whitespace-only headers
        # from a misconfigured upstream proxy fall through to Host.
        xfh = (request.headers.get("x-forwarded-host") or "").strip()
        fallback = (request.headers.get("host") or "").strip()
        host = _strip_port((xfh or fallback).lower())
        if not host:
            return await call_next(request)

        # Already canonical → pass through.
        if host == self.canonical_host:
            return await call_next(request)

        # Preview/staging/loopback hosts have no canonical equivalent.
        if self._is_preview(host):
            return await call_next(request)

        # Build the 301 target. Preserve path + query-string byte-for-byte.
        # Always force https — there's no scenario in 2026 where http://
        # is the canonical destination.
        path = request.url.path or "/"
        qs = request.url.query or ""
        target = f"https://{self.canonical_host}{path}"
        if qs:
            target = f"{target}?{qs}"
        return RedirectResponse(target, status_code=301)
