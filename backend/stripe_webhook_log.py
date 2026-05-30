"""Stripe webhook health logger (iter289).

A tiny insert-only log of every Stripe webhook hit (both main checkout
and Connect endpoints). Powers the admin "Stripe webhook health"
dashboard widget so an admin can spot signature failures, route 404s,
or stuck event types **before** they cost money.

Schema (collection: `stripe_webhook_log`):
  {
    id:          str  uuid
    ts:          iso8601 utc
    kind:        "main" | "connect"
    path:        str  (the route that fired this log, e.g. "/api/stripe/connect/webhook")
    status:      "ok" | "bad_signature" | "no_secret" | "handler_error"
    event_type:  str | None   (only when signature verified)
    event_id:    str | None   (Stripe evt_xxx — for de-dup checks)
    error:       str | None   (last 300 chars only — never leak full stack)
    maker_slug:  str | None   (when the event resolved to a maker)
  }

Insert is fire-and-forget (no await on errors) so a logging blip never
takes down the webhook handler itself. We TTL-index this collection at
60 days to keep it small.
"""
from __future__ import annotations

import uuid

from core import db, logger, now_iso


COLLECTION = "stripe_webhook_log"


async def ensure_indexes() -> None:
    """Idempotent. Called on backend startup."""
    try:
        await db[COLLECTION].create_index("ts", expireAfterSeconds=60 * 24 * 3600)
        await db[COLLECTION].create_index([("kind", 1), ("ts", -1)])
        await db[COLLECTION].create_index([("status", 1), ("ts", -1)])
    except Exception as e:
        logger.warning("[stripe_webhook_log] index init failed: %s", e)


async def record(
    *,
    kind: str,                 # "main" | "connect"
    path: str,
    status: str,               # "ok" | "bad_signature" | "no_secret" | "handler_error"
    event_type: str | None = None,
    event_id:   str | None = None,
    error:      str | None = None,
    maker_slug: str | None = None,
) -> None:
    """Best-effort log insert. Never raises."""
    try:
        await db[COLLECTION].insert_one({
            "id":         uuid.uuid4().hex,
            "ts":         now_iso(),
            "kind":       kind,
            "path":       path,
            "status":     status,
            "event_type": event_type,
            "event_id":   event_id,
            "error":      (str(error)[:300] if error else None),
            "maker_slug": maker_slug,
        })
    except Exception as e:
        logger.warning("[stripe_webhook_log] insert failed: %s", e)
