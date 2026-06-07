"""IndexNow integration — instant ping to Bing / Yandex / Naver / Seznam / Yep
that the site has changed and they should re-crawl.

Why IndexNow + not Google: Google deprecated their `google.com/ping?sitemap=`
endpoint in June 2023. The modern equivalent is the Google Search Console
Indexing API, which requires per-domain OAuth setup. IndexNow is one POST
that hits ~5 search engines at once, owner-verified by a tiny key file.
For Google specifically, surface a "Submit to Google Search Console"
deep-link in the response so the operator can do that step manually.

Protocol: https://www.indexnow.org/documentation
- POST `https://api.indexnow.org/indexnow` with JSON body
- Body: `{host, key, keyLocation, urlList: [...]}`  (max 10,000 URLs)
- Owner verification: GET `keyLocation` must return the bare key as text/plain.

Storage: the IndexNow key is generated lazily on first ping and persisted
to MongoDB `system_state/{_id: 'indexnow'}` so it survives restarts and is
shared across pods. 32-char hex (well within IndexNow's 8-128 char limit).
"""
from __future__ import annotations

import os
import secrets
from typing import Optional
from urllib.parse import urlparse

import httpx

from core import db, logger, now_iso

INDEXNOW_API = "https://api.indexnow.org/indexnow"
STATE_KEY = "indexnow"
KEY_BYTES = 16  # → 32 hex chars
MAX_URLS_PER_PING = 10_000
DEFAULT_PING_BUDGET = 50  # how many catalog URLs to submit by default


async def _get_or_create_key() -> str:
    """Return the persisted IndexNow key, generating one on first use."""
    doc = await db.system_state.find_one({"_id": STATE_KEY}, {"_id": 0, "key": 1})
    if doc and doc.get("key"):
        return doc["key"]
    key = secrets.token_hex(KEY_BYTES)
    await db.system_state.update_one(
        {"_id": STATE_KEY},
        {"$set": {"key": key, "created_at": now_iso()}},
        upsert=True,
    )
    logger.info("[indexnow] generated new key (first use)")
    return key


async def get_key() -> str:
    """Public accessor used by the key-file route."""
    return await _get_or_create_key()


def _site_root() -> str:
    """Canonical apex — never preview. The IndexNow `host` field requires
    a real public hostname; preview pods would just produce 4xx."""
    raw = (os.environ.get("PUBLIC_SITE_URL") or "").rstrip("/")
    if raw and "preview." not in raw and not raw.endswith(".emergentagent.com"):
        return raw
    return "https://craftersmarket.org"


async def _collect_recent_urls(budget: int) -> list[str]:
    """Build the URL list to submit. Anchors the homepage and shop/makers/
    journal landing pages, then fills the rest of the budget with the most
    recently-updated catalog URLs (newest first — those are the entries
    most likely to actually have new content)."""
    site = _site_root()
    urls: list[str] = [
        f"{site}/",
        f"{site}/shop",
        f"{site}/makers",
        f"{site}/journal",
        f"{site}/updates",
    ]
    remaining = max(0, budget - len(urls))
    if remaining == 0:
        return urls
    per_kind = max(1, remaining // 3)

    # Recent products
    products = await db.products.find(
        {"deleted_at": None, "status": {"$ne": "draft"}},
        {"_id": 0, "slug": 1, "created_at": 1},
    ).sort("created_at", -1).limit(per_kind).to_list(per_kind)
    for p in products:
        if p.get("slug"):
            urls.append(f"{site}/shop/{p['slug']}")

    # Makers
    makers = await db.makers.find(
        {}, {"_id": 0, "slug": 1, "created_at": 1},
    ).sort("created_at", -1).limit(per_kind).to_list(per_kind)
    for m in makers:
        if m.get("slug"):
            urls.append(f"{site}/makers/{m['slug']}")

    # Recent journal posts
    posts = await db.blog_posts.find(
        {}, {"_id": 0, "slug": 1, "created_at": 1},
    ).sort("created_at", -1).limit(per_kind).to_list(per_kind)
    for b in posts:
        if b.get("slug"):
            urls.append(f"{site}/journal/{b['slug']}")

    # Defensive sanitizer — IndexNow returns 422
    # ("URLs are not related to your site verified through the keylocation")
    # whenever ANY url's parsed host doesn't exactly match the keyLocation
    # host. Catch that here so one weird slug doesn't fail the whole batch.
    expected_host = site.replace("https://", "").replace("http://", "").rstrip("/").lower()
    cleaned: list[str] = []
    for u in urls:
        try:
            parsed = urlparse(u)
        except Exception:
            logger.warning("[indexnow] skipping unparseable url: %r", u)
            continue
        if parsed.scheme not in ("http", "https"):
            logger.warning("[indexnow] skipping non-http url: %r", u)
            continue
        if (parsed.netloc or "").lower() != expected_host:
            # Catches accidental `www.` prefixes, port mismatches, or
            # slugs that contained slashes/dots that broke the URL.
            logger.warning("[indexnow] skipping host-mismatched url: %r (expected %s)",
                           u, expected_host)
            continue
        # Reject slugs that look like they contain control chars or
        # whitespace. URL-encode if absolutely needed, but the safer
        # route is to drop — IndexNow is allergic to anything weird.
        path = parsed.path or "/"
        if any(ch in path for ch in (" ", "\t", "\n", "\r", "\\")):
            logger.warning("[indexnow] skipping path with whitespace: %r", u)
            continue
        cleaned.append(u)

    # De-dupe while preserving order; cap at 10,000 (the IndexNow per-call max).
    seen: set[str] = set()
    deduped: list[str] = []
    for u in cleaned:
        if u not in seen:
            seen.add(u)
            deduped.append(u)
    return deduped[:MAX_URLS_PER_PING]


async def ping(*, urls: Optional[list[str]] = None,
               budget: int = DEFAULT_PING_BUDGET) -> dict:
    """Fire one bulk submission to IndexNow.

    Returns a dict the admin endpoint can return verbatim:
      {ok, status, count, urls_sample, key_location, google_search_console_url, response_excerpt}

    Best-effort: never raises. Network failure or non-2xx → ok=False with
    the error captured. The IndexNow protocol treats HTTP 200 as "received,
    not necessarily indexed" — we surface the raw status so operators can
    diagnose quickly.
    """
    site = _site_root()
    host = site.replace("https://", "").replace("http://", "").rstrip("/")
    key = await _get_or_create_key()
    # iter338e — IndexNow requires the keyLocation filename to equal the
    # key value (otherwise it 422s with the misleading "URLs are not
    # related to your site verified through the keylocation parameter"
    # even when every URL matches the host). Serve via the canonical
    # `/api/indexnow/{key}.txt` route that satisfies this.
    key_location = f"{site}/api/indexnow/{key}.txt"
    url_list = list(urls) if urls else await _collect_recent_urls(budget)

    payload = {
        "host": host,
        "key": key,
        "keyLocation": key_location,
        "urlList": url_list,
    }

    status = 0
    body_excerpt = ""
    error = ""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(INDEXNOW_API, json=payload,
                                  headers={"Content-Type": "application/json; charset=utf-8"})
            status = r.status_code
            body_excerpt = (r.text or "")[:300]
    except httpx.TimeoutException:
        error = "timeout"
        logger.warning("[indexnow] timeout submitting %d URLs", len(url_list))
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        logger.exception("[indexnow] submission failed")

    ok = 200 <= status < 300

    # Persist a single audit row per ping so the admin can see history.
    await db.system_state.update_one(
        {"_id": STATE_KEY},
        {"$set": {
            "last_ping_at": now_iso(),
            "last_ping_status": status,
            "last_ping_count": len(url_list),
            "last_ping_ok": ok,
            "last_ping_error": error,
        }},
        upsert=True,
    )

    return {
        "ok": ok,
        "status": status,
        "error": error or None,
        "count": len(url_list),
        "urls_sample": url_list[:8],
        "key_location": key_location,
        "host": host,
        "response_excerpt": body_excerpt,
        # Google doesn't support IndexNow — surface the manual workaround
        # so operators can finish the job without leaving the dashboard.
        "google_search_console_url": (
            f"https://search.google.com/search-console/sitemaps?resource_id="
            f"{site.replace(':', '%3A').replace('/', '%2F')}"
        ),
        "next_step_for_google": (
            "Google does not support IndexNow. To nudge Google specifically, "
            "open Search Console → Sitemaps and click 'Submit' on the existing "
            "/api/sitemap.xml entry."
        ),
    }


async def status() -> dict:
    """Return the last-ping state for the admin diagnostic card."""
    doc = await db.system_state.find_one(
        {"_id": STATE_KEY},
        {"_id": 0, "key": 1, "last_ping_at": 1, "last_ping_status": 1,
         "last_ping_count": 1, "last_ping_ok": 1, "last_ping_error": 1,
         "created_at": 1},
    ) or {}
    site = _site_root()
    return {
        "key_configured": bool(doc.get("key")),
        "key_location": f"{site}/api/indexnow/{doc.get('key')}.txt" if doc.get("key") else None,
        "key_created_at": doc.get("created_at"),
        "last_ping_at": doc.get("last_ping_at"),
        "last_ping_status": doc.get("last_ping_status"),
        "last_ping_count": doc.get("last_ping_count"),
        "last_ping_ok": doc.get("last_ping_ok"),
        "last_ping_error": doc.get("last_ping_error"),
    }


# ============================================================================
# Auto-ping hooks — fire-and-forget. Called from BackgroundTasks on content
# publish events (product publish/renew, blog post create, maker join).
# Throttled per URL via `indexnow_url_log` so spammy republishing doesn't
# burn through IndexNow's per-day quota.
# ============================================================================

AUTO_PING_THROTTLE_MIN = 30  # don't re-ping the same URL more than once / 30 min


async def submit_urls(urls: list[str], reason: str = "auto") -> dict | None:
    """Fire-and-forget IndexNow ping for a small set of URLs (1-20). Skips
    URLs pinged within the last AUTO_PING_THROTTLE_MIN minutes.

    Returns the ping result, or None when nothing was pinged after
    throttling. Never raises — safe to call from BackgroundTasks."""
    from datetime import datetime, timedelta, timezone
    try:
        if not urls:
            return None
        # Throttle: skip URLs we've pinged recently.
        cutoff_iso = (datetime.now(timezone.utc)
                      - timedelta(minutes=AUTO_PING_THROTTLE_MIN)).isoformat()
        recent = await db.indexnow_url_log.find(
            {"url": {"$in": list(urls)}, "ts": {"$gte": cutoff_iso}},
            {"_id": 0, "url": 1},
        ).to_list(len(urls))
        recent_set = {r["url"] for r in recent}
        fresh = [u for u in urls if u not in recent_set]
        if not fresh:
            logger.info("[indexnow/auto] all %d urls throttled (reason=%s)",
                        len(urls), reason)
            return None

        result = await ping(urls=fresh)
        # Log every URL we actually submitted (independent of IndexNow's
        # accept status — throttling is "did we try", not "did it land").
        ts = now_iso()
        await db.indexnow_url_log.insert_many(
            [{"url": u, "ts": ts, "reason": reason,
              "status": result.get("status"), "ok": result.get("ok")}
             for u in fresh],
        )
        logger.info("[indexnow/auto] pinged %d url(s) (reason=%s, status=%s)",
                    len(fresh), reason, result.get("status"))
        return result
    except Exception as e:
        logger.exception("[indexnow/auto] submit_urls failed: %s", e)
        return None


def url_for_product(slug: str) -> str:
    return f"{_site_root()}/shop/{slug}"


def url_for_maker(slug: str) -> str:
    return f"{_site_root()}/makers/{slug}"


def url_for_journal(slug: str) -> str:
    return f"{_site_root()}/journal/{slug}"
