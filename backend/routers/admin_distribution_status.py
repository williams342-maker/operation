"""iter317 — Cloudflare Worker + Meta Commerce readiness probes.

Admin-only diagnostics for the two external-distribution surfaces the
user has currently parked:

  1. Cloudflare prerender Worker — probes the live site with a
     Googlebot user-agent and checks whether the response body looks
     like our prerender HTML (has `og-prerender` marker) vs the raw
     React SPA shell. If it's the SPA shell, the Worker isn't bound
     to the route yet and crawlers are getting un-indexable JS.
  2. Meta Commerce Manager — confirms the `/api/meta/feed.csv` route
     is healthy + counts the rows so the operator knows what to
     expect when they paste the URL into Meta's catalog importer.

Read-only. Both probes time out fast (3s) so the admin dashboard
never hangs waiting for a dead third-party.
"""
from __future__ import annotations
from config import env_get

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends

from maker_auth import require_capability

router = APIRouter()
log = logging.getLogger("crafters.admin.distribution")

# Hostnames we'd expect the Worker to be bound to in production. We
# probe whichever is reachable; both should return prerender HTML for
# crawler user-agents.
PROBE_HOSTS = [
    "https://craftersmarket.org",
    "https://www.craftersmarket.org",
]
PROBE_PATHS = ["/shop", "/makers"]  # both have prerender routes wired
GOOGLEBOT_UA = (
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
)
PRERENDER_MARKER = "og-prerender"  # set in `_render_prerender_html`


async def _probe_cloudflare_worker() -> dict[str, Any]:
    """Hit each probe host with a Googlebot UA and look for the
    prerender HTML marker in the response."""
    results: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as cli:
        for host in PROBE_HOSTS:
            for path in PROBE_PATHS:
                url = f"{host}{path}"
                row: dict[str, Any] = {"url": url}
                try:
                    r = await cli.get(url, headers={"User-Agent": GOOGLEBOT_UA})
                    text = r.text or ""
                    row["status"] = r.status_code
                    has_marker = PRERENDER_MARKER in text
                    # SPA shell heuristic — React build always emits an
                    # empty <div id="root"> (with or without attrs) before
                    # the JS bundle hydrates. If we got 200 without our
                    # prerender marker AND we see the root div anywhere,
                    # call it a shell. (The minified production HTML
                    # writes `<div id="root">` without the explicit
                    # closing tag on the same line, so just check for
                    # the opening tag.)
                    row["has_prerender_marker"] = has_marker
                    row["is_spa_shell"] = (
                        not has_marker
                        and 'id="root"' in text
                    )
                    row["bytes"] = len(text)
                except Exception as e:
                    row["error"] = type(e).__name__
                results.append(row)

    # Aggregate verdict
    successes = [r for r in results if r.get("has_prerender_marker")]
    shells = [r for r in results if r.get("is_spa_shell")]
    if successes and not shells:
        verdict = "active"
    elif shells and not successes:
        verdict = "not_deployed"
    elif successes and shells:
        verdict = "partial"  # bound to one host but not the other
    else:
        verdict = "unknown"

    return {
        "verdict": verdict,
        "probes": results,
        "deploy_runbook_url": "https://github.com/craftersmarket/craftersmarket/blob/main/cloudflare/README.md",
        # Local copy of the runbook + worker script.
        "worker_script_path": "/app/cloudflare/prerender-router.worker.js",
        "readme_path": "/app/cloudflare/README.md",
    }


async def _probe_meta_feed() -> dict[str, Any]:
    """Hit our own /api/meta/feed.csv route and count rows."""
    site = (env_get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    if site.endswith(".emergentagent.com"):
        site = "https://craftersmarket.org"
    url = f"{site}/api/meta/feed.csv"
    async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as cli:
        try:
            r = await cli.get(url, headers={"User-Agent": "CraftersAdminProbe/1.0"})
            text = r.text or ""
            # Subtract 1 for header row.
            rows = max(0, text.count("\n") - 1)
            return {
                "verdict": "live" if r.status_code == 200 and rows > 0 else "empty" if r.status_code == 200 else "broken",
                "status": r.status_code,
                "feed_url": url,
                "row_count": rows,
                "bytes": len(text),
                "next_step": (
                    "Paste this feed URL into Meta Commerce Manager → "
                    "Catalog → Data sources → Schedule URL upload."
                ),
                "meta_dashboard_url": "https://business.facebook.com/commerce/catalogs",
            }
        except Exception as e:
            return {
                "verdict": "unreachable",
                "feed_url": url,
                "error": type(e).__name__,
                "meta_dashboard_url": "https://business.facebook.com/commerce/catalogs",
            }


@router.get("/admin/distribution/status")
async def admin_distribution_status(
    _: dict = Depends(require_capability("content", "marketplace")),
):
    """Combined readiness probes for both Cloudflare Worker + Meta
    Commerce Manager. Useful when the operator is ready to unblock
    either parked task."""
    cf_task = asyncio.create_task(_probe_cloudflare_worker())
    meta_task = asyncio.create_task(_probe_meta_feed())
    cloudflare = await cf_task
    meta = await meta_task
    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "cloudflare_worker": cloudflare,
        "meta_commerce": meta,
    }
