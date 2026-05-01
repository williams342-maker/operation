"""Updates digest — captures email subscribers from /updates and fires
a digest email whenever new CHANGELOG entries are detected.

Architecture:
  1. Subscribers collection: `update_subscribers` (one doc per email).
     Fields: email, name?, subscribed_at, unsubscribe_token, unsubscribed_at.
  2. State doc: `system_state`/`updates_digest_state` tracks the iter
     of the most recently dispatched entry. Comparing the changelog's
     newest iter against this lets us detect new entries on each cron tick.
  3. Daily cron at 09:00 UTC checks for new entries since the last
     dispatch. If found → send a single digest email to every active
     subscriber, then advance the state pointer.

Idempotent: re-running the cron on the same day with no new entries
produces zero emails. Crash mid-run? The state pointer only advances
AFTER all emails are queued, so worst case a single dispatch retries.
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

from core import db, logger, now_iso
from routers.updates import _parse_changelog, CHANGELOG_PATH

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
STATE_KEY = "updates_digest"
STALE_AFTER_DAYS = 30  # iter98 — warn when no new entries shipped in this window


def _new_token() -> str:
    return secrets.token_urlsafe(24)


def _is_valid_email(email: str) -> bool:
    return bool(email and len(email) <= 200 and EMAIL_RE.match(email))


# -------------------- Subscriber CRUD --------------------
async def subscribe(email: str, name: Optional[str] = None) -> dict:
    """Idempotent: re-subscribing the same email is a no-op (returns the
    existing record). Re-subscribing a previously-unsubscribed email
    reactivates it with a fresh token."""
    email = (email or "").strip().lower()
    if not _is_valid_email(email):
        return {"ok": False, "error": "invalid_email"}
    name = (name or "").strip()[:120] or None

    existing = await db.update_subscribers.find_one({"email": email}, {"_id": 0})
    if existing and not existing.get("unsubscribed_at"):
        return {"ok": True, "reactivated": False, "already": True}

    token = _new_token()
    payload = {
        "email": email,
        "name": name,
        "subscribed_at": now_iso(),
        "unsubscribed_at": None,
        "unsubscribe_token": token,
        # Snapshot the current latest iter so this subscriber doesn't get
        # blasted with a backlog of historical entries on the next cron.
        "joined_at_iter": await _current_latest_iter(),
    }
    await db.update_subscribers.update_one(
        {"email": email}, {"$set": payload}, upsert=True,
    )
    return {"ok": True, "reactivated": bool(existing), "already": False}


async def unsubscribe(token: str) -> dict:
    if not token or len(token) > 200:
        return {"ok": False, "error": "invalid_token"}
    res = await db.update_subscribers.update_one(
        {"unsubscribe_token": token, "unsubscribed_at": None},
        {"$set": {"unsubscribed_at": now_iso()}},
    )
    return {"ok": True, "found": res.matched_count > 0}


# -------------------- Digest computation --------------------
async def _current_latest_iter() -> Optional[str]:
    """Return the iter id of the newest changelog entry, or None."""
    if not CHANGELOG_PATH.exists():
        return None
    raw = CHANGELOG_PATH.read_text(encoding="utf-8")
    entries = _parse_changelog(raw, limit=1)
    return entries[0]["iter"] if entries else None


async def _state() -> dict:
    return await db.system_state.find_one({"key": STATE_KEY}, {"_id": 0}) or {}


def _days_since(iso_str: Optional[str]) -> Optional[int]:
    """Return whole days between `iso_str` and now (UTC). None if unparseable."""
    if not iso_str:
        return None
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0, int((datetime.now(timezone.utc) - dt).total_seconds() // 86400))


async def staleness() -> dict:
    """Surface "no recent activity" warning data for the admin preview.

    `is_stale` is True iff we have dispatched at least once before AND
    it's been > STALE_AFTER_DAYS since that dispatch. Caller decides
    what to do with it (we just surface the data).
    """
    state = await _state()
    last_at = state.get("last_dispatched_at")
    days = _days_since(last_at)
    is_stale = bool(last_at and days is not None and days > STALE_AFTER_DAYS)
    return {
        "is_stale": is_stale,
        "days_since_dispatch": days,
        "threshold_days": STALE_AFTER_DAYS,
    }


async def _set_state_pointer(iter_id: str) -> None:
    await db.system_state.update_one(
        {"key": STATE_KEY},
        {"$set": {"key": STATE_KEY, "last_dispatched_iter": iter_id, "last_dispatched_at": now_iso()}},
        upsert=True,
    )


def _entries_since(raw: str, last_iter: Optional[str], limit: int = 10) -> list[dict]:
    """Return the changelog entries newer than `last_iter` (newest first).
    If `last_iter` is None, returns the single newest entry only — we
    don't blast a full backlog on first run."""
    all_entries = _parse_changelog(raw, limit=100)
    if not all_entries:
        return []
    if last_iter is None:
        return all_entries[:1]
    fresh: list[dict] = []
    for e in all_entries:
        if e["iter"] == last_iter:
            break
        fresh.append(e)
    return fresh[:limit]


# -------------------- Cron entrypoint --------------------
async def run_digest_dispatch(*, force: bool = False, dry_run: bool = False,
                              trigger: str = "manual") -> dict:
    """Detect new changelog entries since the last dispatch and email
    every active subscriber. Returns a summary suitable for cron logs.
    `trigger` is for the OPS summary email so we can tell apart cron
    runs from admin-button runs (default 'manual')."""
    if not CHANGELOG_PATH.exists():
        return {"ran": False, "reason": "no_changelog"}
    raw = CHANGELOG_PATH.read_text(encoding="utf-8")
    state = await _state()
    last_iter = None if force else state.get("last_dispatched_iter")
    fresh = _entries_since(raw, last_iter)
    if not fresh:
        return {"ran": True, "new_entries": 0, "subscribers": 0, "sent": 0}

    # Snapshot the newest iter BEFORE dispatch so a successful run advances
    # the pointer even if individual emails fail.
    newest_iter = fresh[0]["iter"]
    subs = await db.update_subscribers.find(
        {"unsubscribed_at": None}, {"_id": 0},
    ).to_list(50_000)

    sent = 0
    failed = 0
    if not dry_run:
        # Lazy import keeps this module importable without an email provider.
        from email_service import send_updates_digest
        for s in subs:
            # Don't email subscribers who joined AFTER the entry shipped — they
            # already saw it on the page when they signed up.
            joined_at = s.get("joined_at_iter")
            relevant = [e for e in fresh if joined_at != e["iter"] and not _iter_le(e["iter"], joined_at)]
            if not relevant:
                continue
            try:
                await send_updates_digest(
                    email=s["email"], name=s.get("name") or "",
                    entries=relevant,
                    unsubscribe_token=s.get("unsubscribe_token") or "",
                )
                sent += 1
            except Exception:
                failed += 1
                logger.exception("[updates_digest] send failed for %s", s["email"])
        await _set_state_pointer(newest_iter)

    logger.info(
        "[updates_digest] new_entries=%d subscribers=%d sent=%d failed=%d advanced_to=%s",
        len(fresh), len(subs), sent, failed, newest_iter,
    )

    # iter98 — fire one summary email to OPS_EMAIL after a live dispatch
    # so the operator gets a closing-loop confirmation in the same inbox
    # that surfaces watchdog alerts. Skip on dry-run.
    if not dry_run and sent > 0:
        try:
            from email_service import send_ops_updates_dispatch_summary
            await send_ops_updates_dispatch_summary(
                advanced_to=newest_iter,
                new_entries=len(fresh),
                subscribers=len(subs),
                sent=sent,
                failed=failed,
                trigger=trigger,
            )
        except Exception:
            logger.exception("[updates_digest] OPS summary email failed")

    return {
        "ran": True,
        "new_entries": len(fresh),
        "subscribers": len(subs),
        "sent": sent,
        "failed": failed,
        "advanced_to": newest_iter,
        "dry_run": dry_run,
    }


def _iter_le(a: Optional[str], b: Optional[str]) -> bool:
    """True if iter `a` is older-or-equal than iter `b`. Iter ids are
    mostly numeric ('92', '93') with occasional suffixes ('69b'). Strip
    non-digit suffix for comparison."""
    if not a or not b:
        return False
    def _n(x: str) -> int:
        m = re.match(r"^(\d+)", x)
        return int(m.group(1)) if m else 0
    return _n(a) <= _n(b)
