"""iter413bd — Freshness Engine.

Surfaces content that hasn't been touched in a while so the operator
can decide whether to refresh it. Per the approved ops doc:

  Founders : > 14 days stale
  Blog     : > 21 days stale
  Products : > 30 days stale

Queue-only. No publishing. No auto-edits. The "Accept" action just
records intent in `freshness_actions` so we can measure refresh-adoption
over time — the actual edit happens in the existing editor surfaces.

Staleness signal per entity:
  • makers     :  max(updated_at, founder_started_at, created_at)
  • blog_posts :  created_at (no updated_at column exists yet)
  • products   :  max(updated_at, published_at, created_at)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_admin as _current_admin


router = APIRouter()


# Thresholds match the approved ops doc exactly. Bumping them means
# editing the doc — keep them named constants so the source-of-truth
# is co-located.
_THRESHOLD_FOUNDER_DAYS = 14
_THRESHOLD_BLOG_DAYS = 21
_THRESHOLD_PRODUCT_DAYS = 30

# Snooze duration when an operator dismisses an entry — long enough
# that you won't see it again on the next daily scan, short enough
# that genuinely stale content surfaces again in a useful timeframe.
_DISMISS_SNOOZE_DAYS = 7


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    """Tolerant ISO parser — Mongo docs in this app sometimes store
    datetimes as ISO strings, sometimes as native datetimes."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        s = value.replace("Z", "+00:00") if isinstance(value, str) else None
        if not s:
            return None
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _days_since(value: Optional[datetime]) -> Optional[int]:
    if value is None:
        return None
    delta = datetime.now(timezone.utc) - value
    return max(0, int(delta.total_seconds() // 86400))


# Recommendation text by entity-type — kept inline because the strings
# are part of the UX contract, not a translation system worth building.
def _suggestion_for(kind: str, days_stale: int) -> dict:
    if kind == "founder":
        return {
            "suggested_update": "Refresh bio · add latest portfolio piece · update workshop photo",
            "reason": (
                "Founder profiles drive direct + branded search traffic. "
                "Profile freshness signals to Google + buyers that the maker is active."
            ),
            "expected_impact": "+8-12% session duration on /makers/{slug}; reduced bounce on direct traffic.",
        }
    if kind == "blog":
        return {
            "suggested_update": "Update intro paragraph · refresh examples · add 1 new internal link",
            "reason": (
                "Google rewards recently-updated long-form content. Posts older than 21 days "
                "begin losing position to fresher competitors."
            ),
            "expected_impact": "+15-25% organic-position lift; renewed crawl frequency.",
        }
    if kind == "product":
        return {
            "suggested_update": "Refresh primary photo · verify restock + lead time · price check",
            "reason": (
                "Stale listings rank lower in /shop AND lose buyer trust — photos older than "
                "30 days often show outdated styling, props, or seasonal cues."
            ),
            "expected_impact": "+10-20% click-through from /shop; +5-8% conversion on PDP.",
        }
    return {"suggested_update": "—", "reason": "—", "expected_impact": "—"}


class FreshnessActionRequest(BaseModel):
    id: str = Field(min_length=1, max_length=128)  # entity id (slug or doc id)
    kind: str = Field(pattern=r"^(founder|blog|product)$")
    decision: str = Field(pattern=r"^(accept|dismiss)$")
    note: Optional[str] = Field(default=None, max_length=300)


async def _scan_founders() -> list[dict]:
    """Founders = active featured makers. Stale > 14d."""
    out: list[dict] = []
    cursor = db.makers.find(
        {"founder_status": "active"},
        {"_id": 0, "slug": 1, "name": 1, "updated_at": 1, "created_at": 1,
         "founder_started_at": 1, "email": 1, "bio": 1, "portrait": 1},
    )
    async for m in cursor:
        last = max(
            (_parse_iso(m.get("updated_at")) or datetime.min.replace(tzinfo=timezone.utc)),
            (_parse_iso(m.get("founder_started_at")) or datetime.min.replace(tzinfo=timezone.utc)),
            (_parse_iso(m.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)),
        )
        days = _days_since(last)
        if days is None or days < _THRESHOLD_FOUNDER_DAYS:
            continue
        rec = _suggestion_for("founder", days)
        out.append({
            "id": m.get("slug") or m.get("email"),
            "kind": "founder",
            "url": f"/makers/{m.get('slug')}",
            "label": m.get("name") or m.get("slug"),
            "last_updated_at": last.isoformat() if last != datetime.min.replace(tzinfo=timezone.utc) else None,
            "days_stale": days,
            "threshold_days": _THRESHOLD_FOUNDER_DAYS,
            "severity": "alert" if days >= _THRESHOLD_FOUNDER_DAYS * 2 else "warn",
            **rec,
        })
    return out


async def _scan_blog() -> list[dict]:
    """Blog posts. Stale > 21d."""
    out: list[dict] = []
    cursor = db.blog_posts.find(
        {}, {"_id": 0, "slug": 1, "title": 1, "updated_at": 1, "created_at": 1},
    )
    async for b in cursor:
        last = max(
            (_parse_iso(b.get("updated_at")) or datetime.min.replace(tzinfo=timezone.utc)),
            (_parse_iso(b.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)),
        )
        days = _days_since(last)
        if days is None or days < _THRESHOLD_BLOG_DAYS:
            continue
        rec = _suggestion_for("blog", days)
        out.append({
            "id": b.get("slug"),
            "kind": "blog",
            "url": f"/journal/{b.get('slug')}",
            "label": b.get("title") or b.get("slug"),
            "last_updated_at": last.isoformat() if last != datetime.min.replace(tzinfo=timezone.utc) else None,
            "days_stale": days,
            "threshold_days": _THRESHOLD_BLOG_DAYS,
            "severity": "alert" if days >= _THRESHOLD_BLOG_DAYS * 2 else "warn",
            **rec,
        })
    return out


async def _scan_products() -> list[dict]:
    """Products. Published + non-deleted. Stale > 30d."""
    out: list[dict] = []
    cursor = db.products.find(
        {"deleted_at": None, "status": "published"},
        {"_id": 0, "slug": 1, "title": 1, "maker": 1, "updated_at": 1,
         "created_at": 1, "published_at": 1},
    )
    async for p in cursor:
        last = max(
            (_parse_iso(p.get("updated_at")) or datetime.min.replace(tzinfo=timezone.utc)),
            (_parse_iso(p.get("published_at")) or datetime.min.replace(tzinfo=timezone.utc)),
            (_parse_iso(p.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)),
        )
        days = _days_since(last)
        if days is None or days < _THRESHOLD_PRODUCT_DAYS:
            continue
        rec = _suggestion_for("product", days)
        out.append({
            "id": p.get("slug"),
            "kind": "product",
            "url": f"/shop/{p.get('slug')}",
            "label": p.get("title") or p.get("slug"),
            "maker": p.get("maker"),
            "last_updated_at": last.isoformat() if last != datetime.min.replace(tzinfo=timezone.utc) else None,
            "days_stale": days,
            "threshold_days": _THRESHOLD_PRODUCT_DAYS,
            "severity": "alert" if days >= _THRESHOLD_PRODUCT_DAYS * 2 else "warn",
            **rec,
        })
    return out


async def _active_snoozes() -> dict[str, set[str]]:
    """Dismissed/snoozed entries that should be hidden from this scan.
    Keyed by kind → set of entity-ids."""
    snoozed: dict[str, set[str]] = {"founder": set(), "blog": set(), "product": set()}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=_DISMISS_SNOOZE_DAYS)).isoformat()
    cursor = db.freshness_actions.find(
        {"decision": "dismiss", "created_at": {"$gte": cutoff}},
        {"_id": 0, "id": 1, "kind": 1},
    )
    async for a in cursor:
        k = a.get("kind")
        if k in snoozed and a.get("id"):
            snoozed[k].add(a["id"])
    return snoozed


@router.get("/admin/freshness")
async def freshness_scan(_admin: dict = Depends(_current_admin)):
    """Run the freshness scan across founders / blog / products and
    return a categorised, severity-sorted queue. Cheap to call on
    demand — total dataset is <300 docs in this app."""
    snoozed = await _active_snoozes()

    founders = [r for r in await _scan_founders() if r["id"] not in snoozed["founder"]]
    blog     = [r for r in await _scan_blog()     if r["id"] not in snoozed["blog"]]
    products = [r for r in await _scan_products() if r["id"] not in snoozed["product"]]

    # Most-stale first within each bucket so the operator's eye goes
    # straight to the worst offenders.
    for bucket in (founders, blog, products):
        bucket.sort(key=lambda r: (-r["days_stale"], r["label"] or ""))

    # Accepted counter for the success-metric callout.
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    accepted_7d = await db.freshness_actions.count_documents(
        {"decision": "accept", "created_at": {"$gte": week_ago}},
    )

    return {
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "thresholds": {
            "founder": _THRESHOLD_FOUNDER_DAYS,
            "blog":    _THRESHOLD_BLOG_DAYS,
            "product": _THRESHOLD_PRODUCT_DAYS,
            "dismiss_snooze_days": _DISMISS_SNOOZE_DAYS,
        },
        "counts": {
            "founder": len(founders),
            "blog":    len(blog),
            "product": len(products),
            "total":   len(founders) + len(blog) + len(products),
            "snoozed": sum(len(s) for s in snoozed.values()),
            "accepted_last_7d": accepted_7d,
        },
        "founders": founders[:200],
        "blog":     blog[:200],
        "products": products[:300],
    }


@router.post("/admin/freshness/action")
async def freshness_record_action(
    payload: FreshnessActionRequest,
    claims: dict = Depends(_current_admin),
):
    """Record the operator's decision on a queue entry. `accept` = "I
    will refresh this" (logged for adoption-rate tracking). `dismiss`
    = snooze for 7 days. Per the ops doc, this endpoint does NOT
    perform any actual content edits — it's queue + audit only."""
    await db.freshness_actions.insert_one({
        "kind":      payload.kind,
        "id":        payload.id,
        "decision":  payload.decision,
        "note":      (payload.note or "").strip()[:300] or None,
        "actor":     (claims.get("email") or "").lower(),
        "created_at": now_iso(),
    })
    return {
        "ok": True,
        "decision": payload.decision,
        "kind": payload.kind,
        "id": payload.id,
        "snoozed_until": (
            (datetime.now(timezone.utc) + timedelta(days=_DISMISS_SNOOZE_DAYS)).isoformat()
            if payload.decision == "dismiss" else None
        ),
    }


@router.get("/admin/freshness/history")
async def freshness_history(limit: int = 50, _admin: dict = Depends(_current_admin)):
    """Recent operator actions — used by the dashboard to show recent
    accepts/dismisses and measure refresh adoption rate."""
    if limit < 1 or limit > 500:
        limit = 50
    rows = await db.freshness_actions.find(
        {}, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
    return {"count": len(rows), "actions": rows}
