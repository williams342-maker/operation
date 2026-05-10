"""Maker journal digest — weekly fan-out.

Why a dedicated module:
    The logic intersects three collections (`makers`, `blog_posts`,
    `follows`) and does idempotency tracking against
    `journal_digest_log`. Keeping it next to the other engagement
    routers keeps the scheduler thin and lets us expose a manual
    trigger endpoint for admin debugging.

Idempotency model:
    `journal_digest_log` document shape:
        { _id: f"{iso_year}-W{iso_week}:{maker_slug}:{follower_email}",
          sent_at, status, post_slugs }
    The compound `_id` makes the upsert naturally idempotent — running
    the job twice in the same ISO week sends zero extra emails.

What "the past week" means:
    We collect any blog_posts where `created_at >= now - 7 days` AND
    `created_by_maker` is set (so admin-seeded posts don't trigger
    digests for the whole maker base on their first scheduled run).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core import db, logger, now_iso
from email_service import send_maker_journal_digest
from maker_auth import current_admin

router = APIRouter()


def _iso_week_key(dt: datetime) -> str:
    """`2026-W07` style key — used as the per-maker, per-week shard
    when we record a digest send."""
    iso_year, iso_week, _ = dt.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


async def run_weekly_digest(
    *,
    lookback_days: int = 7,
    dry_run: bool = False,
    only_maker: Optional[str] = None,
) -> dict:
    """Core worker. Returns a stats dict so the scheduler log line
    is informative and the admin manual trigger can render a result.

    `only_maker` is a slug — when supplied we restrict the run to that
    one maker, which is what the manual admin trigger uses to test
    against a specific shop without spamming everyone else's followers.
    """
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=lookback_days)
    since_iso = since.isoformat().replace("+00:00", "Z")
    week_key = _iso_week_key(now)

    # 1) Find every maker-authored post published in the lookback window.
    post_query: dict = {
        "created_at": {"$gte": since_iso},
        "created_by_maker": {"$exists": True, "$ne": None},
    }
    if only_maker:
        post_query["created_by_maker"] = only_maker

    posts = await db.blog_posts.find(
        post_query,
        {"_id": 0, "slug": 1, "title": 1, "excerpt": 1, "cover": 1,
         "read_min": 1, "created_by_maker": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(2000)

    if not posts:
        return {
            "status": "skipped",
            "reason": "no_recent_posts",
            "lookback_days": lookback_days,
            "week": week_key,
            "emails_sent": 0,
            "makers_with_posts": 0,
        }

    # 2) Group posts by maker — newest first, capped to 5 per email so
    # a maker who suddenly publishes 20 in a week doesn't overwhelm.
    by_maker: dict[str, list[dict]] = {}
    for p in posts:
        slug = p.get("created_by_maker")
        if not slug:
            continue
        by_maker.setdefault(slug, [])
        if len(by_maker[slug]) < 5:
            by_maker[slug].append(p)

    emails_sent = 0
    skipped_already_sent = 0
    skipped_no_followers = 0
    errors = 0

    for maker_slug, maker_posts in by_maker.items():
        maker = await db.makers.find_one(
            {"slug": maker_slug},
            {"_id": 0, "name": 1, "slug": 1},
        )
        if not maker:
            continue
        maker_name = maker.get("name") or maker_slug

        # 3) Pull every follower with an email on file. Followers who
        # signed up pre-email (older accounts) won't have one — skip.
        follower_cursor = db.follows.find(
            {"maker_slug": maker_slug, "follower_email": {"$exists": True, "$ne": None}},
            {"_id": 0, "follower_email": 1, "follower_name": 1, "user_id": 1},
        )
        followers = [f async for f in follower_cursor]
        if not followers:
            skipped_no_followers += 1
            continue

        for f in followers:
            email = (f.get("follower_email") or "").strip().lower()
            if not email:
                continue
            log_id = f"{week_key}:{maker_slug}:{email}"

            # Idempotency check — skip if we've already sent this
            # follower this maker's digest this week.
            existing = await db.journal_digest_log.find_one(
                {"_id": log_id}, {"_id": 1},
            )
            if existing:
                skipped_already_sent += 1
                continue

            if dry_run:
                emails_sent += 1
                continue

            try:
                await send_maker_journal_digest(
                    follower_email=email,
                    follower_name=f.get("follower_name") or email.split("@")[0],
                    maker_name=maker_name,
                    maker_slug=maker_slug,
                    posts=maker_posts,
                )
                # Record AFTER successful send so a transient SMTP error
                # leaves the slot empty and we retry next week (the
                # idempotency window is 1 week, so retries are safe).
                await db.journal_digest_log.insert_one({
                    "_id": log_id,
                    "week": week_key,
                    "maker_slug": maker_slug,
                    "follower_email": email,
                    "post_slugs": [p.get("slug") for p in maker_posts],
                    "post_count": len(maker_posts),
                    "sent_at": now_iso(),
                })
                emails_sent += 1
            except Exception as e:
                errors += 1
                logger.exception(
                    "[journal_digest] send failed for %s ← %s: %s",
                    email, maker_slug, e,
                )

    return {
        "status": "ok",
        "week": week_key,
        "lookback_days": lookback_days,
        "dry_run": dry_run,
        "only_maker": only_maker,
        "makers_with_posts": len(by_maker),
        "posts_in_window": len(posts),
        "emails_sent": emails_sent,
        "skipped_already_sent": skipped_already_sent,
        "skipped_no_followers": skipped_no_followers,
        "errors": errors,
    }


# ----------------------- admin manual trigger ----------------------- #
class DigestRunResult(BaseModel):
    status: str
    week: Optional[str] = None
    lookback_days: Optional[int] = None
    dry_run: Optional[bool] = None
    only_maker: Optional[str] = None
    makers_with_posts: Optional[int] = None
    posts_in_window: Optional[int] = None
    emails_sent: int = 0
    skipped_already_sent: int = 0
    skipped_no_followers: int = 0
    errors: int = 0
    reason: Optional[str] = None


@router.post(
    "/admin/journal-digest/run",
    response_model=DigestRunResult,
)
async def admin_run_journal_digest(
    dry_run: bool = Query(default=True),
    lookback_days: int = Query(default=7, ge=1, le=30),
    only_maker: Optional[str] = Query(default=None),
    _: dict = Depends(current_admin),
):
    """Run the weekly digest on demand. Defaults to dry-run so an admin
    can preview "would have sent N emails" before flipping to live.

    Examples:
        POST /admin/journal-digest/run?dry_run=true                # preview
        POST /admin/journal-digest/run?dry_run=false               # live, all makers
        POST /admin/journal-digest/run?only_maker=iron-and-oak     # one shop
    """
    if lookback_days > 30:
        raise HTTPException(422, "lookback_days capped at 30.")
    return await run_weekly_digest(
        lookback_days=lookback_days,
        dry_run=dry_run,
        only_maker=only_maker,
    )


@router.get("/admin/journal-digest/recent")
async def admin_recent_digest_runs(
    limit: int = Query(default=20, ge=1, le=200),
    _: dict = Depends(current_admin),
):
    """Read-only audit log — the most recent digest sends. Lets an
    admin spot-check who got what without scraping email logs."""
    cap = max(1, min(int(limit or 20), 200))
    cursor = db.journal_digest_log.find(
        {}, {"_id": 0},
    ).sort("sent_at", -1).limit(cap)
    return {"items": [doc async for doc in cursor]}
