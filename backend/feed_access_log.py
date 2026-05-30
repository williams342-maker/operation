"""Catalog-feed access logger (iter292).

One-line `feed_access_log` insert per crawler hit on the 3 catalog
endpoints (Pinterest / Google Merchant / Meta). Powers the admin
"Sales channel feeds" card so the operator has proof each platform's
crawler is actually fetching the data daily.

Schema (collection: `feed_access_log`):
  ts       iso8601 utc
  channel  "pinterest" | "google" | "meta"
  ua       request user-agent (≤ 300 chars, identifies the crawler)
  ip       client ip (best-effort from X-Forwarded-For)
  rows     int — how many product rows we returned

TTL 30 days so the collection never balloons; the card only needs the
most-recent hit per channel.
"""
from __future__ import annotations

from fastapi import Request

from core import db, logger, now_iso


COLLECTION = "feed_access_log"


async def ensure_indexes() -> None:
    """Idempotent. Called on backend startup."""
    try:
        await db[COLLECTION].create_index("ts", expireAfterSeconds=30 * 24 * 3600)
        await db[COLLECTION].create_index([("channel", 1), ("ts", -1)])
    except Exception as e:
        logger.warning("[feed_access_log] index init failed: %s", e)


def _client_ip(request: Request | None) -> str:
    if not request:
        return ""
    # Honor the first hop in X-Forwarded-For — that's what Cloudflare /
    # the k8s ingress prepends. Fall back to client.host for local dev.
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    if request.client and request.client.host:
        return request.client.host[:64]
    return ""


async def record_hit(request: Request | None, *, channel: str, rows: int) -> None:
    """Best-effort insert. Never raises."""
    try:
        ua = ""
        if request:
            ua = (request.headers.get("user-agent") or "")[:300]
        await db[COLLECTION].insert_one({
            "ts": now_iso(),
            "channel": channel,
            "ua": ua,
            "ip": _client_ip(request),
            "rows": int(rows),
        })
    except Exception as e:
        logger.warning("[feed_access_log] insert failed: %s", e)
