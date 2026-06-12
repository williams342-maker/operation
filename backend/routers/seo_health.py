"""iter373 — Admin "SEO health" monitor.

Weekly (and on-demand) crawler that checks a sample of the site's OWN
public URLs the way Googlebot sees them, and flags exactly the problem
classes that burned us in GSC (iter372):

  • http_error      — sampled page isn't returning 200
  • redirect        — sampled canonical URL bounces somewhere else
  • wrong_canonical — page declares a canonical that isn't itself
                      (catches stale edge-prerender snapshots)
  • noindex_leak    — an indexable page is telling Google to drop it
  • soft_404_guard  — dead-slug probe returns 200 instead of 404
  • sitemap_*       — sitemap unreachable or suspiciously thin
  • fetch_error     — network failure while crawling

Runs are stored in `seo_health_runs`. The Monday cron alerts ops via
notify_team (Slack/Discord webhooks) + OPS_EMAIL when issues are found;
manual runs from the admin card never page anyone.

Always crawls the canonical apex (PUBLIC_SITE_URL) — that is the SEO
surface Google actually sees, regardless of which environment runs the
check.
"""
from __future__ import annotations

import asyncio
import re
import uuid

import httpx
from fastapi import APIRouter, Depends

from core import db, logger, now_iso
from maker_auth import current_admin
from routers.og_prerender import _site

router = APIRouter()

GOOGLEBOT_UA = (
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; "
    "Googlebot/2.1; +http://www.google.com/bot.html) Chrome/120.0 Safari/537.36"
)
PROBE_404_PATH = "/api/og/product/cm-seo-health-probe-404"
MAX_SAMPLE_URLS = 28
FETCH_CONCURRENCY = 5

_CANONICAL_RE = re.compile(
    r"<link[^>]+rel=[\"']canonical[\"'][^>]*href=[\"']([^\"']+)[\"']", re.I)
_CANONICAL_RE_REV = re.compile(
    r"<link[^>]+href=[\"']([^\"']+)[\"'][^>]*rel=[\"']canonical[\"']", re.I)
_ROBOTS_META_RE = re.compile(
    r"<meta[^>]+name=[\"']robots[\"'][^>]*content=[\"']([^\"']*)[\"']", re.I)


def _norm(url: str) -> str:
    """Comparison form: lowercase scheme+host, no trailing slash (except root)."""
    u = (url or "").strip()
    if "://" in u:
        scheme, rest = u.split("://", 1)
        host, _, path = rest.partition("/")
        u = f"{scheme.lower()}://{host.lower()}/{path}"
    return u.rstrip("/") or u


def _analyze_page(url: str, status: int, html: str, location: str | None = None) -> list[dict]:
    """Pure rule engine — unit-tested in test_iter373_seo_health.py."""
    if status in (301, 302, 307, 308):
        return [{"type": "redirect", "url": url,
                 "detail": f"HTTP {status} → {location or '?'}"}]
    if status != 200:
        return [{"type": "http_error", "url": url, "detail": f"HTTP {status}"}]

    issues: list[dict] = []
    m = _ROBOTS_META_RE.search(html or "")
    if m and "noindex" in m.group(1).lower():
        issues.append({"type": "noindex_leak", "url": url,
                       "detail": f'meta robots = "{m.group(1)}"'})
    c = _CANONICAL_RE.search(html or "") or _CANONICAL_RE_REV.search(html or "")
    if c and _norm(c.group(1)) != _norm(url):
        issues.append({"type": "wrong_canonical", "url": url,
                       "detail": f"canonical → {c.group(1)}"})
    return issues


async def _sample_urls(site: str) -> list[str]:
    """Core pages + a rotating sample of fresh products/makers/posts."""
    urls = [f"{site}/", f"{site}/shop", f"{site}/makers",
            f"{site}/journal", f"{site}/community", f"{site}/custom-order"]
    prods = await db.products.find(
        {"deleted_at": None, "status": {"$ne": "draft"}},
        {"_id": 0, "slug": 1},
    ).sort("created_at", -1).limit(10).to_list(10)
    urls += [f"{site}/shop/{p['slug']}" for p in prods if p.get("slug")]
    makers = await db.makers.find(
        {"deleted_at": None}, {"_id": 0, "slug": 1},
    ).limit(5).to_list(5)
    urls += [f"{site}/makers/{m['slug']}" for m in makers if m.get("slug")]
    posts = await db.blog_posts.find({}, {"_id": 0, "slug": 1}).limit(3).to_list(3)
    urls += [f"{site}/journal/{p['slug']}" for p in posts if p.get("slug")]
    return urls[:MAX_SAMPLE_URLS]


async def run_seo_health_check(trigger: str = "manual") -> dict:
    site = _site()
    started = now_iso()
    urls = await _sample_urls(site)
    issues: list[dict] = []
    sem = asyncio.Semaphore(FETCH_CONCURRENCY)

    async with httpx.AsyncClient(
        timeout=20, follow_redirects=False,
        headers={"User-Agent": GOOGLEBOT_UA},
    ) as client:

        async def check(u: str) -> list[dict]:
            async with sem:
                try:
                    r = await client.get(u)
                    return _analyze_page(
                        u, r.status_code,
                        r.text if r.status_code == 200 else "",
                        r.headers.get("location"),
                    )
                except Exception as e:
                    return [{"type": "fetch_error", "url": u, "detail": str(e)[:200]}]

        for page_issues in await asyncio.gather(*[check(u) for u in urls]):
            issues.extend(page_issues)

        # Sitemap reachability + size sanity.
        sitemap_urls = 0
        try:
            r = await client.get(f"{site}/api/sitemap.xml")
            if r.status_code != 200:
                issues.append({"type": "sitemap_error", "url": f"{site}/api/sitemap.xml",
                               "detail": f"HTTP {r.status_code}"})
            else:
                sitemap_urls = r.text.count("<loc>")
                if sitemap_urls < 10:
                    issues.append({"type": "sitemap_thin", "url": f"{site}/api/sitemap.xml",
                                   "detail": f"only {sitemap_urls} URLs in sitemap"})
        except Exception as e:
            issues.append({"type": "sitemap_error", "url": f"{site}/api/sitemap.xml",
                           "detail": str(e)[:200]})

        # Soft-404 guard: a known-dead slug must NOT come back 200.
        probe = f"{site}{PROBE_404_PATH}"
        try:
            r = await client.get(probe)
            if r.status_code == 200:
                issues.append({"type": "soft_404_guard", "url": probe,
                               "detail": "dead slug returned HTTP 200 (expected 404)"})
        except Exception as e:
            issues.append({"type": "fetch_error", "url": probe, "detail": str(e)[:200]})

    run = {
        "id": str(uuid.uuid4()),
        "site": site,
        "trigger": trigger,
        "started_at": started,
        "finished_at": now_iso(),
        "checked": len(urls) + 2,  # + sitemap + 404 probe
        "sitemap_urls": sitemap_urls,
        "issue_count": len(issues),
        "issues": issues[:50],
    }
    await db.seo_health_runs.insert_one({**run})
    logger.info("[seo-health] %s run: %d URLs, %d issue(s)",
                trigger, run["checked"], run["issue_count"])
    return run


async def job_weekly_seo_health() -> None:
    """Monday cron — run the check and page ops only when something's wrong."""
    run = await run_seo_health_check("cron")
    if run["issue_count"] == 0:
        return
    by_type: dict[str, int] = {}
    for i in run["issues"]:
        by_type[i["type"]] = by_type.get(i["type"], 0) + 1
    try:
        from notify_webhook import notify_team
        await notify_team(
            kind="seo_health",
            title=f"SEO health: {run['issue_count']} issue(s) found",
            summary=" · ".join(f"{k}×{v}" for k, v in by_type.items()),
            fields=[(i["type"], f"{i['url']} — {i['detail']}") for i in run["issues"][:8]],
            link=f"{run['site']}/admin",
        )
    except Exception:
        logger.exception("[seo-health] notify_team failed")
    try:
        from email_service import send_ops_seo_health_alert
        await send_ops_seo_health_alert(run)
    except Exception:
        logger.exception("[seo-health] ops email failed")


# ─────────────────────────── Endpoints ───────────────────────────
@router.post("/admin/seo-health/run")
async def admin_run_seo_health(admin: dict = Depends(current_admin)):
    return await run_seo_health_check("manual")


@router.get("/admin/seo-health/latest")
async def admin_seo_health_latest(admin: dict = Depends(current_admin)):
    runs = await db.seo_health_runs.find({}, {"_id": 0}).sort(
        "started_at", -1).limit(8).to_list(8)
    return {"latest": runs[0] if runs else None, "history": runs}
