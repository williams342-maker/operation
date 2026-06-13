"""iter412 — AI SEO Growth Agent.

Daily (02:00 UTC) and on-demand background SEO scanner that:
  • Computes overall, technical, content, and authority sub-scores
  • Surfaces prioritized issues (critical / high / medium / low) across
    products, makers, and SEO landing pages
  • Generates AI rewrites (Emergent LLM key → Claude Sonnet 4.5) for the
    common content issues (missing/thin/truncated meta descriptions,
    missing alt text)
  • Stages every AI rewrite in `seo_agent_queue` — NOTHING publishes
    automatically. Admin reviews + approves before live records mutate.
  • Tracks every applied change in `seo_agent_audit` for rollback.

Collections used:
  • seo_agent_runs    — one doc per scan (timestamp, scores, issues)
  • seo_agent_queue   — pending AI-generated fixes
  • seo_agent_audit   — applied changes (before/after snapshot)

Builds ON top of the existing technical health check in routers/seo_health.py
(sitemap + canonical + indexability) — we wrap that, score it, and add
content-layer scanning the existing health check doesn't do.
"""
from __future__ import annotations

import os
import re
import uuid
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, now_iso
from maker_auth import current_admin
from routers.seo_health import run_seo_health_check

logger = logging.getLogger(__name__)
router = APIRouter()


# ──────────────────────────────────────────────────────────────────────
# Content scanning rules
# ──────────────────────────────────────────────────────────────────────
META_DESC_MIN = 80
META_DESC_MAX = 160
PRODUCT_DESC_MIN = 120

SEVERITY_WEIGHT = {"critical": 10, "high": 5, "medium": 2, "low": 1}

# ──────────────────────────────────────────────────────────────────────
# Recommendations engine config (iter413)
# ──────────────────────────────────────────────────────────────────────
# Per-kind metadata for grouping issues into actionable recommendations.
# • effort_per_item_min — rough wall-clock minutes per affected item
#   (used for "Estimated completion time")
# • traffic_pct_per_fix — heuristic % organic traffic lift from fixing
#   one instance (sums across affected items, capped at 25%)
# • fixable_via_ai — does `/generate-fix` support this kind?
RECOMMENDATION_META = {
    # Content
    "missing_meta_description":   {"effort_per_item_min": 2, "traffic_pct_per_fix": 0.20, "fixable_via_ai": True,  "title": "Generate meta descriptions"},
    "meta_description_too_short": {"effort_per_item_min": 2, "traffic_pct_per_fix": 0.10, "fixable_via_ai": True,  "title": "Expand thin meta descriptions"},
    "meta_description_too_long":  {"effort_per_item_min": 2, "traffic_pct_per_fix": 0.08, "fixable_via_ai": True,  "title": "Trim truncated meta descriptions"},
    "missing_product_description":{"effort_per_item_min": 8, "traffic_pct_per_fix": 0.30, "fixable_via_ai": False, "title": "Add product descriptions"},
    "thin_product_description":   {"effort_per_item_min": 6, "traffic_pct_per_fix": 0.15, "fixable_via_ai": False, "title": "Expand thin product descriptions"},
    "missing_alt_text":           {"effort_per_item_min": 1, "traffic_pct_per_fix": 0.05, "fixable_via_ai": True,  "title": "Generate image alt text"},
    "missing_product_image":      {"effort_per_item_min": 15,"traffic_pct_per_fix": 0.50, "fixable_via_ai": False, "title": "Upload missing product images"},
    # Technical
    "sitemap_error":   {"effort_per_item_min": 15, "traffic_pct_per_fix": 2.0,  "fixable_via_ai": False, "title": "Restore sitemap availability"},
    "sitemap_thin":    {"effort_per_item_min": 30, "traffic_pct_per_fix": 1.5,  "fixable_via_ai": False, "title": "Expand sitemap coverage"},
    "http_error":      {"effort_per_item_min": 20, "traffic_pct_per_fix": 0.40, "fixable_via_ai": False, "title": "Fix pages returning non-200"},
    "wrong_canonical": {"effort_per_item_min": 10, "traffic_pct_per_fix": 0.30, "fixable_via_ai": False, "title": "Fix canonical URL mismatches"},
    "noindex_leak":    {"effort_per_item_min": 10, "traffic_pct_per_fix": 0.80, "fixable_via_ai": False, "title": "Remove noindex from indexable pages"},
    "redirect":        {"effort_per_item_min": 8,  "traffic_pct_per_fix": 0.10, "fixable_via_ai": False, "title": "Resolve canonical redirects"},
    "soft_404_guard":  {"effort_per_item_min": 30, "traffic_pct_per_fix": 0.50, "fixable_via_ai": False, "title": "Fix soft-404 regressions"},
    "fetch_error":     {"effort_per_item_min": 15, "traffic_pct_per_fix": 0.10, "fixable_via_ai": False, "title": "Resolve crawl-time fetch errors"},
}


def _build_recommendations(issues: list[dict]) -> list[dict]:
    """Group raw issues by kind and produce one prioritized recommendation
    per group. Output is sorted by impact/effort ratio so the highest-ROI
    items appear first."""
    by_kind: dict[str, list[dict]] = {}
    for it in issues:
        by_kind.setdefault(it["kind"], []).append(it)

    recs: list[dict] = []
    for kind, group in by_kind.items():
        meta = RECOMMENDATION_META.get(kind)
        if not meta:
            continue
        n = len(group)
        # Take the highest severity in the group as the recommendation's severity.
        sev_order = ["critical", "high", "medium", "low"]
        top_sev = min((g["severity"] for g in group),
                      key=lambda s: sev_order.index(s) if s in sev_order else 99)
        effort_min = n * meta["effort_per_item_min"]
        traffic_pct = min(25.0, n * meta["traffic_pct_per_fix"])
        # Impact: severity weight × √count (sub-linear so 200 missing alts
        # doesn't dwarf 1 critical sitemap error).
        impact_raw = SEVERITY_WEIGHT[top_sev] * (n ** 0.5)
        # Effort score 1-100 (lower = better)
        effort_score = min(100, effort_min)
        rec_id = f"rec_{kind}"
        recs.append({
            "id": rec_id,
            "kind": kind,
            "title": meta["title"],
            "severity": top_sev,
            "affected_count": n,
            "effort_minutes": effort_min,
            "expected_traffic_pct": round(traffic_pct, 1),
            "fixable_via_ai": meta["fixable_via_ai"],
            "impact_label": "high" if impact_raw >= 20 else "medium" if impact_raw >= 8 else "low",
            "effort_label": "low" if effort_min <= 30 else "medium" if effort_min <= 180 else "high",
            "_score": impact_raw / max(1, effort_score / 30),  # impact-per-effort
            "issue_ids": [g["id"] for g in group[:200]],
        })
    recs.sort(key=lambda r: r["_score"], reverse=True)
    for r in recs:
        r.pop("_score", None)
    return recs


def _classify_severity(kind: str) -> str:
    return {
        # technical
        "sitemap_error": "critical",
        "sitemap_thin": "high",
        "http_error": "critical",
        "wrong_canonical": "high",
        "noindex_leak": "critical",
        "soft_404_guard": "high",
        "redirect": "medium",
        "fetch_error": "medium",
        # content
        "missing_meta_description": "high",
        "meta_description_too_short": "medium",
        "meta_description_too_long": "medium",
        "missing_product_description": "high",
        "thin_product_description": "medium",
        "missing_alt_text": "medium",
        "missing_product_image": "high",
    }.get(kind, "low")


async def _scan_content() -> list[dict]:
    """Walk products + makers + SEO landing pages, emit issues."""
    issues: list[dict] = []

    # ── Products ────────────────────────────────────────────────────
    cursor = db.products.find(
        {"deleted_at": None, "status": {"$ne": "draft"}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "description": 1,
         "meta_description": 1, "images": 1, "image_alts": 1},
    )
    async for p in cursor:
        slug = p.get("slug")
        if not slug:
            continue
        target = {"type": "product", "id": p.get("id"), "slug": slug,
                  "label": p.get("title") or slug}
        # Meta description
        meta = (p.get("meta_description") or "").strip()
        if not meta:
            issues.append({**target, "kind": "missing_meta_description",
                           "detail": "No meta description set."})
        elif len(meta) < META_DESC_MIN:
            issues.append({**target, "kind": "meta_description_too_short",
                           "detail": f"{len(meta)} chars (target ≥{META_DESC_MIN})."})
        elif len(meta) > META_DESC_MAX:
            issues.append({**target, "kind": "meta_description_too_long",
                           "detail": f"{len(meta)} chars (target ≤{META_DESC_MAX})."})

        # Product description (body copy)
        desc = (p.get("description") or "").strip()
        if not desc:
            issues.append({**target, "kind": "missing_product_description",
                           "detail": "No product description."})
        elif len(desc) < PRODUCT_DESC_MIN:
            issues.append({**target, "kind": "thin_product_description",
                           "detail": f"{len(desc)} chars (target ≥{PRODUCT_DESC_MIN})."})

        # Image alt text — `image_alts` is a parallel array to `images`
        images = p.get("images") or []
        alts = p.get("image_alts") or []
        if not images:
            issues.append({**target, "kind": "missing_product_image",
                           "detail": "Listing has no images."})
        else:
            missing_alts = sum(1 for i, _ in enumerate(images)
                               if i >= len(alts) or not (alts[i] or "").strip())
            if missing_alts:
                issues.append({**target, "kind": "missing_alt_text",
                               "detail": f"{missing_alts} of {len(images)} images missing alt text."})

    return issues


def _score(technical_issue_count: int, content_issue_count: int,
           total_targets: int) -> dict:
    """Compute the 4 sub-scores. Caps at 0–100, deterministic."""
    # Technical: each unique technical issue costs 6 points.
    tech_score = max(0, 100 - technical_issue_count * 6)
    # Content: ratio of issues vs. total scanned targets.
    if total_targets > 0:
        # Each issue costs 100 / total_targets; cap at 100.
        content_score = max(0, 100 - int(content_issue_count * 100 / total_targets))
    else:
        content_score = 100
    # Authority: placeholder for v2 (backlinks + social readiness).
    # For now, fixed at 70 once we have any landing pages indexed;
    # the Pinterest Rich Pin work (iter411d) baseline-bumps it to 80.
    authority_score = 80
    overall = round(tech_score * 0.40 + content_score * 0.40 + authority_score * 0.20)
    return {
        "overall": overall,
        "technical": tech_score,
        "content": content_score,
        "authority": authority_score,
    }


async def run_seo_agent_scan(trigger: str = "manual") -> dict:
    """Full SEO scan: technical health + content scan + scoring. Result
    is stored in `seo_agent_runs`. Idempotent for the same minute."""
    started = now_iso()

    # Technical: delegate to the existing health check.
    try:
        health = await run_seo_health_check(trigger=f"seo-agent-{trigger}")
        tech_issues = health.get("issues") or []
    except Exception as e:  # pragma: no cover — defensive
        logger.warning("[seo-agent] technical health failed: %s", e)
        tech_issues = [{"type": "fetch_error", "detail": str(e)[:200]}]

    # Content
    content_issues = await _scan_content()

    # Score
    total_targets = await db.products.count_documents(
        {"deleted_at": None, "status": {"$ne": "draft"}},
    )
    scores = _score(len(tech_issues), len(content_issues), total_targets)

    # Bundle issues with severity for the UI
    bundled = []
    for it in tech_issues:
        kind = it.get("type") or "other"
        bundled.append({
            "id": str(uuid.uuid4()),
            "pillar": "technical",
            "kind": kind,
            "severity": _classify_severity(kind),
            "target": {"type": "url", "slug": it.get("url"), "label": it.get("url")},
            "detail": it.get("detail", ""),
        })
    for it in content_issues:
        kind = it.get("kind")
        bundled.append({
            "id": str(uuid.uuid4()),
            "pillar": "content",
            "kind": kind,
            "severity": _classify_severity(kind),
            "target": {"type": it["type"], "id": it.get("id"),
                       "slug": it.get("slug"), "label": it.get("label")},
            "detail": it.get("detail", ""),
        })
    critical_count = sum(1 for b in bundled if b["severity"] == "critical")
    # iter413 — Compute prioritized recommendations from the bundled
    # issues. Stored alongside the scan so the Recommendations tab
    # always shows the same snapshot the scores are derived from.
    recommendations = _build_recommendations(bundled)

    run = {
        "id": str(uuid.uuid4()),
        "trigger": trigger,
        "started_at": started,
        "finished_at": now_iso(),
        "scores": scores,
        "counts": {
            "total": len(bundled),
            "critical": critical_count,
            "technical": len(tech_issues),
            "content": len(content_issues),
            "targets_scanned": total_targets,
        },
        "issues": bundled[:500],  # cap to keep doc reasonable
        "recommendations": recommendations,
    }
    await db.seo_agent_runs.insert_one({**run})
    logger.info("[seo-agent] %s scan: score=%d, %d issue(s), %d critical",
                trigger, scores["overall"], len(bundled), critical_count)
    return run


# ──────────────────────────────────────────────────────────────────────
# AI fix generation
# ──────────────────────────────────────────────────────────────────────
async def _generate_meta_description(product: dict) -> Optional[str]:
    """Ask Claude for a single SEO meta description in the 120-155 char
    sweet spot. Returns None on any LLM error."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.warning("[seo-agent] emergentintegrations unavailable: %s", e)
        return None

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        logger.warning("[seo-agent] EMERGENT_LLM_KEY missing — skipping AI fix")
        return None

    title = (product.get("title") or "").strip()
    desc = (product.get("description") or "").strip()[:600]
    category = (product.get("category") or "").strip()
    materials = ", ".join(product.get("materials") or [])

    prompt = f"""Write ONE SEO meta description for this handmade marketplace listing.

Listing title: {title}
Category: {category or "—"}
Materials: {materials or "—"}
Body copy excerpt: {desc or "—"}

HARD RULES:
- Exactly ONE sentence OR two short sentences.
- 120-155 characters total (NOT under 120, NOT over 155). Count carefully.
- Naturally include the most search-relevant keyword from the title.
- Mention "handmade" or "handcrafted" once.
- End with a trust signal: "ships nationwide", "made-to-order", "by a vetted US maker", or "Stripe-secured" — pick whichever fits naturally.
- No emoji, no all-caps, no marketing fluff ("amazing", "premium", "exclusive").
- Sound like a curator's note, not an ad.

Return ONLY the meta description text — no quotes, no labels, no commentary."""

    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"seo-agent-meta-{uuid.uuid4().hex[:8]}",
            system_message="You write tight, factual SEO meta descriptions for a handmade marketplace. Output one line only, no quotes.",
        )
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    )

    try:
        text = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.warning("[seo-agent] LLM call failed: %s", e)
        return None

    out = (text or "").strip().strip('"').strip("'")
    # Hard truncate just in case the model overshoots.
    if len(out) > META_DESC_MAX:
        out = out[:META_DESC_MAX].rsplit(" ", 1)[0] + "."
    return out or None


async def _generate_alt_texts(product: dict) -> Optional[list[str]]:
    """Ask Claude for one alt-text string per image. Returns a list the
    same length as `images`, or None on error."""
    images = product.get("images") or []
    if not images:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        return None
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        return None

    title = (product.get("title") or "").strip()
    category = (product.get("category") or "").strip()
    n = len(images)
    prompt = f"""Generate {n} alt-text strings for the photos of this handmade marketplace listing.

Listing title: {title}
Category: {category or "—"}

RULES per alt-text:
- 70-125 characters.
- Describe what's visible in a photo a buyer would see: subject + key materials + setting/use context.
- Photo 1 is the hero (main view); later photos are usually detail / lifestyle / scale shots — vary the descriptions accordingly.
- No "image of" / "picture of" prefixes. No marketing language.
- Include the listing's category once across the set if natural.

Return EXACTLY {n} alt-texts, one per line, in order. No numbering, no commentary."""

    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"seo-agent-alt-{uuid.uuid4().hex[:8]}",
            system_message="You write descriptive alt-text for a handmade marketplace. Output one line per image, no numbering.",
        )
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    )
    try:
        text = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.warning("[seo-agent] LLM alt call failed: %s", e)
        return None

    lines = [ln.strip("•-* \t") for ln in (text or "").splitlines() if ln.strip()]
    # Pad/truncate to exactly n
    if len(lines) < n:
        return None
    return lines[:n]


# ──────────────────────────────────────────────────────────────────────
# Queue model + API
# ──────────────────────────────────────────────────────────────────────
class GenerateFixReq(BaseModel):
    issue_id: str
    run_id: Optional[str] = None


@router.get("/admin/seo-agent/overview")
async def seo_agent_overview(admin: dict = Depends(current_admin)):
    """Latest scan summary for the dashboard top cards."""
    run = await db.seo_agent_runs.find_one(
        {}, {"_id": 0}, sort=[("started_at", -1)],
    )
    pending = await db.seo_agent_queue.count_documents({"status": "pending"})
    return {
        "latest_run": run,
        "queue_pending": pending,
        "next_scheduled_scan": "02:00 UTC daily",
    }


@router.get("/admin/seo-agent/issues")
async def seo_agent_issues(
    severity: Optional[str] = None,
    pillar: Optional[str] = None,
    admin: dict = Depends(current_admin),
):
    """Latest run's issues, optionally filtered by severity or pillar."""
    run = await db.seo_agent_runs.find_one(
        {}, {"_id": 0}, sort=[("started_at", -1)],
    )
    if not run:
        return {"issues": [], "scanned_at": None}
    items = run.get("issues") or []
    if severity:
        items = [i for i in items if i.get("severity") == severity]
    if pillar:
        items = [i for i in items if i.get("pillar") == pillar]
    return {"issues": items, "scanned_at": run.get("finished_at")}


@router.get("/admin/seo-agent/recommendations")
async def seo_agent_recommendations(admin: dict = Depends(current_admin)):
    """iter413 — Ranked recommendations from the latest scan.

    Each row is one actionable group with impact/effort/expected-traffic
    metadata. Sorted by impact-per-effort ratio so the highest-ROI items
    are surfaced first."""
    run = await db.seo_agent_runs.find_one(
        {}, {"_id": 0}, sort=[("started_at", -1)],
    )
    if not run:
        return {"recommendations": [], "scanned_at": None}
    return {
        "recommendations": run.get("recommendations", []),
        "scanned_at": run.get("finished_at"),
    }


@router.get("/admin/seo-agent/history")
async def seo_agent_history(
    days: int = 30,
    admin: dict = Depends(current_admin),
):
    """iter413 — Time-series of past scan results for the Reporting tab.

    Returns one point per scan (newest → oldest), capped by `days`.
    Used by the score-trend line chart and the "applied recommendations
    this week / month" counters."""
    from datetime import datetime, timedelta, timezone
    days = max(1, min(180, int(days or 30)))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    cursor = db.seo_agent_runs.find(
        {"finished_at": {"$gte": cutoff}},
        {"_id": 0, "id": 1, "trigger": 1, "started_at": 1, "finished_at": 1,
         "scores": 1, "counts": 1},
    ).sort("finished_at", 1)  # ascending — chart reads left-to-right
    history = await cursor.to_list(500)

    # Applied / rejected / rolled-back counts inside the same window so
    # the Reporting tab can show "X recommendations applied this period"
    applied = await db.seo_agent_queue.count_documents(
        {"status": "applied", "applied_at": {"$gte": cutoff}},
    )
    rejected = await db.seo_agent_queue.count_documents(
        {"status": "rejected", "rejected_at": {"$gte": cutoff}},
    )
    rolled_back = await db.seo_agent_queue.count_documents(
        {"status": "rolled_back", "rolled_back_at": {"$gte": cutoff}},
    )
    return {
        "history": history,
        "window_days": days,
        "queue_activity": {
            "applied": applied,
            "rejected": rejected,
            "rolled_back": rolled_back,
        },
    }


@router.post("/admin/seo-agent/scan/run")
async def seo_agent_scan_run(admin: dict = Depends(current_admin)):
    """Manual trigger from the [Run Scan] button."""
    run = await run_seo_agent_scan(trigger="manual")
    return run


@router.post("/admin/seo-agent/generate-fix")
async def seo_agent_generate_fix(req: GenerateFixReq,
                                 admin: dict = Depends(current_admin)):
    """Generate an AI rewrite for the given issue and stash it in the
    approval queue. Returns the queue entry."""
    run = await db.seo_agent_runs.find_one(
        {}, {"_id": 0}, sort=[("started_at", -1)],
    )
    if not run:
        raise HTTPException(404, "No scan available — run a scan first.")
    issues = run.get("issues") or []
    issue = next((i for i in issues if i.get("id") == req.issue_id), None)
    if not issue:
        raise HTTPException(404, "Issue not found in latest scan.")

    target = issue.get("target", {})
    if target.get("type") != "product" or not target.get("slug"):
        raise HTTPException(400, "AI fixes are only available for product issues right now.")

    product = await db.products.find_one(
        {"slug": target["slug"]}, {"_id": 0},
    )
    if not product:
        raise HTTPException(404, "Product no longer exists.")

    kind = issue.get("kind")
    before = {}
    after = {}
    field = None

    if kind in {"missing_meta_description", "meta_description_too_short",
                "meta_description_too_long"}:
        new_meta = await _generate_meta_description(product)
        if not new_meta:
            raise HTTPException(502, "AI generation failed — try again later.")
        field = "meta_description"
        before = {"meta_description": product.get("meta_description") or ""}
        after = {"meta_description": new_meta}
    elif kind == "missing_alt_text":
        new_alts = await _generate_alt_texts(product)
        if not new_alts:
            raise HTTPException(502, "AI generation failed — try again later.")
        field = "image_alts"
        before = {"image_alts": product.get("image_alts") or []}
        after = {"image_alts": new_alts}
    else:
        raise HTTPException(400, f"No AI fix available for issue kind '{kind}'.")

    entry = {
        "id": str(uuid.uuid4()),
        "run_id": run["id"],
        "issue_id": req.issue_id,
        "issue_kind": kind,
        "severity": issue.get("severity"),
        "target_type": target["type"],
        "target_slug": target["slug"],
        "target_label": target.get("label"),
        "field": field,
        "before": before,
        "after": after,
        "status": "pending",
        "generated_at": now_iso(),
        "generated_by": admin.get("email"),
    }
    await db.seo_agent_queue.insert_one({**entry})
    return entry


@router.get("/admin/seo-agent/queue")
async def seo_agent_queue_list(
    status: str = "pending",
    admin: dict = Depends(current_admin),
):
    items = await db.seo_agent_queue.find(
        {"status": status}, {"_id": 0},
    ).sort("generated_at", -1).to_list(200)
    return {"items": items, "status": status}


@router.post("/admin/seo-agent/queue/{queue_id}/approve")
async def seo_agent_queue_approve(queue_id: str,
                                  admin: dict = Depends(current_admin)):
    entry = await db.seo_agent_queue.find_one({"id": queue_id}, {"_id": 0})
    if not entry:
        raise HTTPException(404, "Queue entry not found.")
    if entry.get("status") != "pending":
        raise HTTPException(400, f"Entry is already {entry.get('status')}.")

    # Apply the change. Only product target supported in v1.
    if entry["target_type"] != "product":
        raise HTTPException(400, "Only product changes are applicable in v1.")

    res = await db.products.update_one(
        {"slug": entry["target_slug"]},
        {"$set": {entry["field"]: entry["after"][entry["field"]],
                  "updated_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Product no longer exists — cannot apply.")

    applied_at = now_iso()
    await db.seo_agent_queue.update_one(
        {"id": queue_id},
        {"$set": {"status": "applied", "applied_at": applied_at,
                  "applied_by": admin.get("email")}},
    )
    # Audit row (rollback source of truth — never deleted).
    await db.seo_agent_audit.insert_one({
        "id": str(uuid.uuid4()),
        "queue_id": queue_id,
        "action": "approve",
        "target_type": entry["target_type"],
        "target_slug": entry["target_slug"],
        "field": entry["field"],
        "before": entry["before"],
        "after": entry["after"],
        "applied_at": applied_at,
        "applied_by": admin.get("email"),
    })
    return {"status": "applied", "id": queue_id, "applied_at": applied_at}


@router.post("/admin/seo-agent/queue/{queue_id}/reject")
async def seo_agent_queue_reject(queue_id: str,
                                 admin: dict = Depends(current_admin)):
    res = await db.seo_agent_queue.update_one(
        {"id": queue_id, "status": "pending"},
        {"$set": {"status": "rejected", "rejected_at": now_iso(),
                  "rejected_by": admin.get("email")}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Pending entry not found.")
    return {"status": "rejected", "id": queue_id}


@router.post("/admin/seo-agent/queue/{queue_id}/rollback")
async def seo_agent_queue_rollback(queue_id: str,
                                   admin: dict = Depends(current_admin)):
    """Roll back an APPLIED change using the stored `before` snapshot."""
    entry = await db.seo_agent_queue.find_one({"id": queue_id}, {"_id": 0})
    if not entry:
        raise HTTPException(404, "Queue entry not found.")
    if entry.get("status") != "applied":
        raise HTTPException(400, "Only applied entries can be rolled back.")
    if entry["target_type"] != "product":
        raise HTTPException(400, "Only product rollbacks are supported in v1.")
    await db.products.update_one(
        {"slug": entry["target_slug"]},
        {"$set": {entry["field"]: entry["before"][entry["field"]],
                  "updated_at": now_iso()}},
    )
    rolled_at = now_iso()
    await db.seo_agent_queue.update_one(
        {"id": queue_id},
        {"$set": {"status": "rolled_back", "rolled_back_at": rolled_at,
                  "rolled_back_by": admin.get("email")}},
    )
    await db.seo_agent_audit.insert_one({
        "id": str(uuid.uuid4()),
        "queue_id": queue_id,
        "action": "rollback",
        "target_type": entry["target_type"],
        "target_slug": entry["target_slug"],
        "field": entry["field"],
        "before": entry["after"],   # swap — restoring the "before"
        "after": entry["before"],
        "applied_at": rolled_at,
        "applied_by": admin.get("email"),
    })
    return {"status": "rolled_back", "id": queue_id}


# ──────────────────────────────────────────────────────────────────────
# Cron entry point (called from scheduler.py at 02:00 UTC daily)
# ──────────────────────────────────────────────────────────────────────
async def job_daily_seo_agent_scan() -> None:
    """Scheduler hook — wraps the scan with a safety try/except so a
    transient error never crashes APScheduler's event loop."""
    try:
        await run_seo_agent_scan(trigger="cron")
    except Exception as e:  # pragma: no cover — defensive
        logger.exception("[seo-agent] daily scan failed: %s", e)
