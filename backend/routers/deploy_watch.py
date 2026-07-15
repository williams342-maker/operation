"""iter413cs — Deployment Watch Window + AI Operations Center cards 2 & 6.

The "AI Watch Window" the user asked for, scoped up: every production
deploy auto-creates a 48h **Watch Window** that turns the Ops Dashboard
into an active monitoring surface — what *changed* since the deploy,
what's spiking vs the 7-day baseline, and which clusters are
deployment-attributable.

Data model — `deploy_watches` collection:
  {
    id: str (uuid),
    build_id: str (BUILD_SHA, GIT_COMMIT, or manual override),
    started_at: iso,
    expires_at: iso,           # default started_at + 48h
    status: "active"|"closed",
    started_by: str|None,      # admin email if manual, else "boot"
    summary: {                 # populated on close
        ai_bug_reports: int,
        new_clusters: int,
        resolved_during_watch: int,
        feature_confusion_topics: int,
        health: "green"|"yellow"|"orange"|"red",
        notes: str,
    },
    closed_at: iso|None,
    baseline: {                # snapshot at window start for comparison
        ai_bugs_7d: int,
        contact_messages_7d: int,
        help_questions_7d: int,
    }
  }

Lifecycle:
  • App boot calls `ensure_watch_for_current_build()` — if BUILD_SHA
    differs from the latest watch's build_id, opens a new one and
    snapshots baseline counts. Idempotent.
  • A scheduler job (`close_expired_deploy_watches`) closes any watch
    past `expires_at` and writes the summary.
  • Admin can also start/close manually.

Endpoints (`/api/admin/ops/`):
  GET  /deploy-watch/current     — active watch + live health metrics
  POST /deploy-watch/start       — manual start (build_id, optional ttl_hours)
  POST /deploy-watch/close       — manual close + write summary
  GET  /deploy-watch/history     — last 10 closed watches
  GET  /ai-emerging              — Card 2: clusters with no prior presence
                                    (since watch start, or last 24h if
                                    no active watch)
  GET  /deploy-health            — Card 6: live signal aggregation vs
                                    baseline + computed severity
"""
from __future__ import annotations
from config import env_get

import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db
from maker_auth import current_admin
from routers.ai_operations import _signature, _severity, _trend_arrow, _trend_delta

router = APIRouter()
logger = logging.getLogger("crafters")


# ── Constants ─────────────────────────────────────────────────────────
DEFAULT_TTL_HOURS = 48
BASELINE_WINDOW_DAYS = 7
MAX_HISTORY = 10

# Spike thresholds (current vs baseline daily rate).
SPIKE_WARN_PCT = 1.20   # +20% → warning
SPIKE_ELEV_PCT = 1.50   # +50% → elevated
SPIKE_CRIT_PCT = 2.00   # +100% → critical


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _current_build_id() -> str:
    """Resolve the active build identifier.

    Preference order:
      1. BUILD_SHA (set by deploy pipeline — most reliable)
      2. GIT_COMMIT
      3. The fallback `"local-<YYYY-MM-DD>"` so dev/preview still
         creates *some* watch boundary if we ever want to use it.
    """
    for key in ("BUILD_SHA", "GIT_COMMIT", "GIT_SHA", "DEPLOY_BUILD_ID"):
        val = (env_get(key) or "").strip()
        if val:
            return val[:64]
    # No deploy marker. Use date so the first boot of each day still
    # establishes a window — useful in preview but won't churn in prod.
    return f"local-{_now().strftime('%Y-%m-%d')}"


# ── Baseline snapshot ─────────────────────────────────────────────────
async def _baseline_snapshot() -> dict:
    """Counts over the trailing 7 days at watch start."""
    cutoff = _iso(_now() - timedelta(days=BASELINE_WINDOW_DAYS))
    ai_bugs = await db.contact_messages.count_documents(
        {"kind": "ai_diagnosed_bug", "created_at": {"$gte": cutoff}}
    )
    contact = await db.contact_messages.count_documents(
        {"created_at": {"$gte": cutoff}}
    )
    help_q = await db.help_questions.count_documents(
        {"created_at": {"$gte": cutoff}}
    )
    return {
        "ai_bugs_7d": ai_bugs,
        "contact_messages_7d": contact,
        "help_questions_7d": help_q,
    }


async def _get_active_watch() -> dict | None:
    """Return the active watch, lazily marking expired ones closed."""
    now_iso = _iso(_now())
    doc = await db.deploy_watches.find_one(
        {"status": "active"}, {"_id": 0}, sort=[("started_at", -1)]
    )
    if not doc:
        return None
    if doc.get("expires_at") and doc["expires_at"] < now_iso:
        # Expired — close it lazily (also handled by the scheduler job).
        await _close_watch(doc["id"], reason="expired")
        return None
    return doc


async def _open_watch(build_id: str, started_by: str = "boot",
                      ttl_hours: int = DEFAULT_TTL_HOURS) -> dict:
    # Defensively close any stale active watches first.
    await db.deploy_watches.update_many(
        {"status": "active"},
        {"$set": {
            "status": "closed",
            "closed_at": _iso(_now()),
            "summary": {"health": "unknown", "notes": "auto-closed: new watch starting"},
        }},
    )
    started = _now()
    doc = {
        "id": str(uuid.uuid4()),
        "build_id": build_id,
        "started_at": _iso(started),
        "expires_at": _iso(started + timedelta(hours=max(1, min(168, ttl_hours)))),
        "status": "active",
        "started_by": started_by,
        "baseline": await _baseline_snapshot(),
        "summary": None,
        "closed_at": None,
    }
    await db.deploy_watches.insert_one(doc)
    doc.pop("_id", None)  # Mongo inserts the BSON _id in place — drop for JSON serialisability.
    logger.info("[deploy-watch] opened build=%s by=%s ttl=%dh",
                build_id, started_by, ttl_hours)
    return doc


async def _close_watch(watch_id: str, reason: str = "manual") -> dict | None:
    doc = await db.deploy_watches.find_one({"id": watch_id}, {"_id": 0})
    if not doc:
        return None
    if doc.get("status") == "closed":
        return doc
    summary = await _compute_summary(doc)
    summary["notes"] = reason if not summary.get("notes") else f"{summary['notes']} · {reason}"
    await db.deploy_watches.update_one(
        {"id": watch_id},
        {"$set": {
            "status": "closed",
            "closed_at": _iso(_now()),
            "summary": summary,
        }},
    )
    logger.info("[deploy-watch] closed id=%s build=%s health=%s reason=%s",
                watch_id, doc.get("build_id"), summary.get("health"), reason)
    refreshed = await db.deploy_watches.find_one({"id": watch_id}, {"_id": 0})
    return refreshed


# ── Boot hook (called by server.py startup) ───────────────────────────
async def ensure_watch_for_current_build() -> dict | None:
    """Idempotent: opens a new watch when the build_id changes.

    Safe to call on every app boot. Returns the active watch (existing
    or newly-opened) or None if disabled.
    """
    if (env_get("DEPLOY_WATCH_ENABLED") or "true").lower() in ("0", "false", "no"):
        return None
    try:
        build = _current_build_id()
        active = await _get_active_watch()
        if active and active.get("build_id") == build:
            return active
        return await _open_watch(build, started_by="boot")
    except Exception as e:
        logger.exception("[deploy-watch] ensure failed: %s", e)
        return None


# ── Scheduler hook ────────────────────────────────────────────────────
async def close_expired_deploy_watches() -> dict:
    """Cron-friendly sweep. Closes any active watch past expires_at and
    writes its summary. Returns a short status doc for logging."""
    now_iso = _iso(_now())
    expired = await db.deploy_watches.find(
        {"status": "active", "expires_at": {"$lt": now_iso}}, {"_id": 0, "id": 1}
    ).to_list(20)
    closed = 0
    for row in expired:
        await _close_watch(row["id"], reason="expired")
        closed += 1
    return {"checked": len(expired), "closed": closed}


# ── Card 2: Emerging issues ───────────────────────────────────────────
async def _emerging_clusters(since_iso: str, limit: int = 12) -> list[dict]:
    """Cluster ai_diagnosed_bug reports created since `since_iso` and
    return clusters with NO presence in the trailing 7d before that
    cutoff. These are the "new since deploy" issues — Card 2.
    """
    prior_cutoff = _iso(
        datetime.fromisoformat(since_iso) - timedelta(days=BASELINE_WINDOW_DAYS)
    )
    rows = await db.contact_messages.find(
        {"kind": "ai_diagnosed_bug", "created_at": {"$gte": prior_cutoff}},
        {"_id": 0, "id": 1, "message": 1, "created_at": 1, "ai_bug_meta": 1},
    ).sort("created_at", -1).to_list(2000)

    new_clusters: dict[str, dict] = {}
    prior_keys: set[str] = set()
    for row in rows:
        ts = row.get("created_at") or ""
        meta = row.get("ai_bug_meta") or {}
        body = row.get("message") or ""
        desc = body.split("User report:", 1)[1].split("\n\n", 1)[0].strip() \
            if "User report:" in body else body[:200]
        key, label = _signature(desc, meta.get("page_url"),
                                meta.get("listing_slug"), meta.get("category"))
        if ts >= since_iso:
            cluster = new_clusters.setdefault(key, {
                "key": key, "label": label, "count": 0,
                "first_seen": ts, "last_seen": ts,
                "sample_ids": [], "sample_pages": [], "sample_listing_slugs": [],
            })
            cluster["count"] += 1
            if ts < cluster["first_seen"]:
                cluster["first_seen"] = ts
            if ts > cluster["last_seen"]:
                cluster["last_seen"] = ts
            if row.get("id") and len(cluster["sample_ids"]) < 5:
                cluster["sample_ids"].append(row["id"])
            page = (meta.get("page_url") or "").strip()
            if page and page not in cluster["sample_pages"] and len(cluster["sample_pages"]) < 3:
                cluster["sample_pages"].append(page)
            slug = (meta.get("listing_slug") or "").strip()
            if slug and slug not in cluster["sample_listing_slugs"] and len(cluster["sample_listing_slugs"]) < 3:
                cluster["sample_listing_slugs"].append(slug)
        else:
            prior_keys.add(key)

    emerging = [c for k, c in new_clusters.items() if k not in prior_keys]
    for c in emerging:
        c["severity"] = _severity(c["count"])
        c["trend"] = "new"
        c["trend_delta"] = c["count"]
    severity_rank = {"high": 0, "medium": 1, "low": 2, "info": 3}
    emerging.sort(key=lambda x: (severity_rank.get(x["severity"], 9), -x["count"]))
    return emerging[:limit]


# ── Card 6: Deployment Health ─────────────────────────────────────────
def _spike_label(current_rate: float, baseline_rate: float) -> tuple[str, str]:
    """Compare a current daily rate to a baseline daily rate. Returns
    (status, human label). Status ∈ {green, yellow, orange, red}."""
    if baseline_rate <= 0:
        if current_rate <= 0:
            return "green", "no activity"
        # No prior signal but we have current activity — treat as elevated.
        return ("orange" if current_rate >= 2 else "yellow",
                f"new signal · {current_rate:.1f}/day")
    ratio = current_rate / baseline_rate
    if ratio >= SPIKE_CRIT_PCT:
        return "red", f"+{int((ratio - 1) * 100)}% vs baseline"
    if ratio >= SPIKE_ELEV_PCT:
        return "orange", f"+{int((ratio - 1) * 100)}% vs baseline"
    if ratio >= SPIKE_WARN_PCT:
        return "yellow", f"+{int((ratio - 1) * 100)}% vs baseline"
    if ratio < 0.5:
        return "green", f"−{int((1 - ratio) * 100)}% vs baseline"
    return "green", "stable"


_HEALTH_RANK = {"green": 0, "yellow": 1, "orange": 2, "red": 3}
_HEALTH_FROM_RANK = {v: k for k, v in _HEALTH_RANK.items()}


def _overall_health(signals: list[dict]) -> str:
    if not signals:
        return "green"
    worst = max(_HEALTH_RANK.get(s.get("status") or "green", 0) for s in signals)
    return _HEALTH_FROM_RANK[worst]


async def _deploy_health_signals(watch: dict | None) -> dict:
    """Compute live signal table: AI bug reports, contact_messages,
    help_questions, plus emerging-clusters count. Compares the current
    rate (elapsed since watch start, normalised per-day) against the
    7-day baseline daily rate.
    """
    if watch:
        started_iso = watch["started_at"]
        started_dt = datetime.fromisoformat(started_iso)
        elapsed_h = max(0.25, (_now() - started_dt).total_seconds() / 3600.0)
        elapsed_days = elapsed_h / 24.0
        baseline = watch.get("baseline") or {}
    else:
        # No active watch — use the last 24h as the comparison window
        # against the prior 7d.
        started_dt = _now() - timedelta(hours=24)
        started_iso = _iso(started_dt)
        elapsed_h = 24.0
        elapsed_days = 1.0
        baseline = await _baseline_snapshot()

    cur_ai = await db.contact_messages.count_documents(
        {"kind": "ai_diagnosed_bug", "created_at": {"$gte": started_iso}}
    )
    cur_contact = await db.contact_messages.count_documents(
        {"created_at": {"$gte": started_iso}}
    )
    cur_help = await db.help_questions.count_documents(
        {"created_at": {"$gte": started_iso}}
    )
    emerging = await _emerging_clusters(started_iso, limit=50)

    base_ai_rate = (baseline.get("ai_bugs_7d") or 0) / BASELINE_WINDOW_DAYS
    base_contact_rate = (baseline.get("contact_messages_7d") or 0) / BASELINE_WINDOW_DAYS
    base_help_rate = (baseline.get("help_questions_7d") or 0) / BASELINE_WINDOW_DAYS

    cur_ai_rate = cur_ai / elapsed_days
    cur_contact_rate = cur_contact / elapsed_days
    cur_help_rate = cur_help / elapsed_days

    sig_ai_status, sig_ai_label = _spike_label(cur_ai_rate, base_ai_rate)
    sig_contact_status, sig_contact_label = _spike_label(cur_contact_rate, base_contact_rate)
    sig_help_status, sig_help_label = _spike_label(cur_help_rate, base_help_rate)

    # Emerging-cluster severity contributes to overall health independent
    # of rate spikes.
    if any(c["severity"] == "high" for c in emerging):
        emerging_status = "red"
        emerging_label = f"{len(emerging)} new · high severity"
    elif any(c["severity"] == "medium" for c in emerging):
        emerging_status = "orange"
        emerging_label = f"{len(emerging)} new · medium severity"
    elif emerging:
        emerging_status = "yellow"
        emerging_label = f"{len(emerging)} new clusters"
    else:
        emerging_status = "green"
        emerging_label = "no new clusters"

    signals = [
        {"id": "ai_bug_reports", "label": "AI bug reports",
         "current": cur_ai, "baseline_daily_rate": round(base_ai_rate, 2),
         "current_daily_rate": round(cur_ai_rate, 2),
         "status": sig_ai_status, "delta_label": sig_ai_label},
        {"id": "support_tickets", "label": "Support tickets",
         "current": cur_contact, "baseline_daily_rate": round(base_contact_rate, 2),
         "current_daily_rate": round(cur_contact_rate, 2),
         "status": sig_contact_status, "delta_label": sig_contact_label},
        {"id": "help_conversations", "label": "Help conversations",
         "current": cur_help, "baseline_daily_rate": round(base_help_rate, 2),
         "current_daily_rate": round(cur_help_rate, 2),
         "status": sig_help_status, "delta_label": sig_help_label},
        {"id": "emerging_clusters", "label": "Emerging clusters",
         "current": len(emerging), "baseline_daily_rate": 0,
         "current_daily_rate": len(emerging),
         "status": emerging_status, "delta_label": emerging_label},
    ]
    return {
        "window_started_at": started_iso,
        "elapsed_hours": round(elapsed_h, 2),
        "baseline": {
            "ai_bug_reports_daily": round(base_ai_rate, 2),
            "support_tickets_daily": round(base_contact_rate, 2),
            "help_conversations_daily": round(base_help_rate, 2),
        },
        "signals": signals,
        "overall_health": _overall_health(signals),
        "emerging_clusters": emerging,
    }


# ── Summary writer (used by _close_watch) ─────────────────────────────
async def _compute_summary(watch: dict) -> dict:
    started = watch.get("started_at")
    if not started:
        return {"health": "unknown", "notes": "no start timestamp"}
    health = await _deploy_health_signals(watch)
    ai_bug_reports = next(
        (s["current"] for s in health["signals"] if s["id"] == "ai_bug_reports"), 0
    )
    new_clusters = len(health["emerging_clusters"])
    resolved = await db.contact_messages.count_documents({
        "kind": "ai_diagnosed_bug",
        "created_at": {"$gte": started},
        "resolved": True,
    })
    # Feature-confusion proxy: distinct (lowercased) help_questions
    # asked at least twice since the watch started. Card 4 will refine.
    pipeline = [
        {"$match": {"created_at": {"$gte": started}}},
        {"$group": {"_id": {"$toLower": "$user"}, "n": {"$sum": 1}}},
        {"$match": {"n": {"$gte": 2}}},
        {"$count": "n"},
    ]
    confusion_count = 0
    async for row in db.help_questions.aggregate(pipeline):
        confusion_count = row.get("n") or 0
    return {
        "ai_bug_reports": ai_bug_reports,
        "new_clusters": new_clusters,
        "resolved_during_watch": resolved,
        "feature_confusion_topics": confusion_count,
        "health": health["overall_health"],
        "notes": "",
    }


# ── HTTP routes ───────────────────────────────────────────────────────
@router.get("/admin/ops/deploy-watch/current")
async def deploy_watch_current(claims: dict = Depends(current_admin)):
    """Returns the active watch (auto-opens for the current build if
    none active) + live deployment-health signals (Card 6)."""
    watch = await _get_active_watch()
    if not watch:
        watch = await ensure_watch_for_current_build()
    health = await _deploy_health_signals(watch)
    return {
        "watch": watch,
        "build_id_current": _current_build_id(),
        "health": health,
        "generated_at": _iso(_now()),
    }


class StartWatchIn(BaseModel):
    build_id: Optional[str] = Field(default=None, max_length=64)
    ttl_hours: int = Field(default=DEFAULT_TTL_HOURS, ge=1, le=168)


@router.post("/admin/ops/deploy-watch/start")
async def deploy_watch_start(payload: StartWatchIn, claims: dict = Depends(current_admin)):
    admin_email = (claims.get("email") or "admin").lower().strip()
    build = (payload.build_id or "").strip() or _current_build_id()
    if not re.match(r"^[A-Za-z0-9_.\-:]+$", build):
        raise HTTPException(400, "build_id may only contain letters, digits, ._-:")
    watch = await _open_watch(build, started_by=admin_email, ttl_hours=payload.ttl_hours)
    return {"watch": watch}


class CloseWatchIn(BaseModel):
    watch_id: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=500)


@router.post("/admin/ops/deploy-watch/close")
async def deploy_watch_close(payload: CloseWatchIn, claims: dict = Depends(current_admin)):
    active = await _get_active_watch()
    target_id = (payload.watch_id or (active or {}).get("id"))
    if not target_id:
        raise HTTPException(404, "No active watch to close.")
    closed = await _close_watch(target_id, reason=(payload.notes or "manual"))
    if not closed:
        raise HTTPException(404, "Watch not found.")
    return {"watch": closed}


@router.get("/admin/ops/deploy-watch/history")
async def deploy_watch_history(limit: int = 10, claims: dict = Depends(current_admin)):
    limit = max(1, min(MAX_HISTORY * 5, int(limit or 10)))
    rows = await db.deploy_watches.find(
        {"status": "closed"}, {"_id": 0}
    ).sort("closed_at", -1).to_list(limit)
    return {"rows": rows}


# ── Release Timeline ──────────────────────────────────────────────────
# Searchable operational history. Every watch — active or closed —
# surfaces here with build_id, started_at, features shipped (admin-
# annotated), health verdict, and the AI-diagnosed issues filed during
# its window so you can answer "when did the X regression start?" by
# scanning the timeline instead of grepping git logs.

class AnnotateWatchIn(BaseModel):
    features_shipped: Optional[list[str]] = Field(default=None, max_length=50)
    notes: Optional[str] = Field(default=None, max_length=2000)


@router.post("/admin/ops/deploy-watch/{watch_id}/annotate")
async def deploy_watch_annotate(
    watch_id: str, payload: AnnotateWatchIn,
    claims: dict = Depends(current_admin),
):
    """Record the key features shipped in this release + an optional
    operator note. Idempotent (last write wins). Builds the searchable
    Release Timeline that lets ops answer "when did X land?" months
    later without grepping git history."""
    update: dict = {}
    if payload.features_shipped is not None:
        cleaned = [s.strip()[:240] for s in payload.features_shipped if (s or "").strip()][:50]
        update["features_shipped"] = cleaned
    if payload.notes is not None:
        update["operator_notes"] = (payload.notes or "").strip()[:2000]
    if not update:
        raise HTTPException(400, "Nothing to update — pass features_shipped or notes.")
    update["annotated_at"] = _iso(_now())
    update["annotated_by"] = (claims.get("email") or "admin").lower().strip()
    result = await db.deploy_watches.update_one({"id": watch_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Watch not found.")
    doc = await db.deploy_watches.find_one({"id": watch_id}, {"_id": 0})
    return {"watch": doc}


@router.get("/admin/ops/release-timeline")
async def release_timeline(
    limit: int = 25, q: str = "",
    claims: dict = Depends(current_admin),
):
    """Searchable release journal. Returns the last N watches (active
    first) joined with the count of AI-diagnosed issues that landed
    during each window, including up to 5 sample issue clusters per
    release for quick scan.

    Search `q` matches case-insensitively against build_id,
    features_shipped, operator_notes, and started_by.
    """
    limit = max(1, min(100, int(limit or 25)))
    query: dict = {}
    if q and q.strip():
        rx = re.escape(q.strip())
        query = {"$or": [
            {"build_id": {"$regex": rx, "$options": "i"}},
            {"features_shipped": {"$regex": rx, "$options": "i"}},
            {"operator_notes": {"$regex": rx, "$options": "i"}},
            {"started_by": {"$regex": rx, "$options": "i"}},
        ]}
    rows = await db.deploy_watches.find(query, {"_id": 0}).sort("started_at", -1).to_list(limit)

    # Build a single AI-issue lookup that covers ALL watches in the
    # response in one Mongo round-trip (cheap even for ~25 watches).
    if rows:
        earliest = min((r.get("started_at") or "") for r in rows)
        ai_rows = await db.contact_messages.find(
            {"kind": "ai_diagnosed_bug", "created_at": {"$gte": earliest}},
            {"_id": 0, "id": 1, "created_at": 1, "message": 1, "ai_bug_meta": 1},
        ).sort("created_at", 1).to_list(5000)
    else:
        ai_rows = []

    enriched: list[dict] = []
    for row in rows:
        started = row.get("started_at") or ""
        # window end = closed_at if closed, else expires_at, else now
        end = row.get("closed_at") or row.get("expires_at") or _iso(_now())
        window_rows = [r for r in ai_rows
                       if started <= (r.get("created_at") or "") < end]
        # Mini-clustering of the issues in this window for context.
        mini: dict[str, dict] = {}
        for r in window_rows:
            meta = r.get("ai_bug_meta") or {}
            body = r.get("message") or ""
            desc = body.split("User report:", 1)[1].split("\n\n", 1)[0].strip() \
                if "User report:" in body else body[:200]
            key, label = _signature(desc, meta.get("page_url"),
                                    meta.get("listing_slug"), meta.get("category"))
            cluster = mini.setdefault(key, {"key": key, "label": label, "count": 0, "sample_ids": []})
            cluster["count"] += 1
            if len(cluster["sample_ids"]) < 3 and r.get("id"):
                cluster["sample_ids"].append(r["id"])
        clusters = sorted(mini.values(), key=lambda c: -c["count"])[:5]

        enriched.append({
            "id": row.get("id"),
            "build_id": row.get("build_id"),
            "started_at": started,
            "expires_at": row.get("expires_at"),
            "closed_at": row.get("closed_at"),
            "status": row.get("status"),
            "started_by": row.get("started_by"),
            "annotated_by": row.get("annotated_by"),
            "annotated_at": row.get("annotated_at"),
            "features_shipped": row.get("features_shipped") or [],
            "operator_notes": row.get("operator_notes") or "",
            "summary": row.get("summary") or None,
            "ai_issues_count": len(window_rows),
            "ai_issue_clusters": clusters,
        })

    return {"q": q, "count": len(enriched), "rows": enriched}


@router.get("/admin/ops/ai-emerging")
async def ai_emerging(limit: int = 12, claims: dict = Depends(current_admin)):
    """Card 2: clusters that appeared since the active watch started
    (or in the last 24h if no active watch) and had no presence in the
    trailing 7-day window before that."""
    watch = await _get_active_watch()
    if watch:
        since = watch["started_at"]
        anchor = "deploy_watch"
    else:
        since = _iso(_now() - timedelta(hours=24))
        anchor = "last_24h"
    emerging = await _emerging_clusters(since, limit=limit)
    return {
        "anchor": anchor,
        "since": since,
        "clusters": emerging,
        "generated_at": _iso(_now()),
    }


@router.get("/admin/ops/deploy-health")
async def deploy_health(claims: dict = Depends(current_admin)):
    """Card 6: signal aggregation vs 7-day baseline + computed severity."""
    watch = await _get_active_watch()
    return {
        "watch": watch,
        "health": await _deploy_health_signals(watch),
        "generated_at": _iso(_now()),
    }
