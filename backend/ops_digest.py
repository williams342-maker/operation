"""Daily ops digest — single-shot 6am UTC email summarizing yesterday
on Crafters Market. One inbox-worthy view of what happened so the
operator doesn't have to log in to check on the marketplace.

Sections (each one collapses gracefully if there's nothing to report):

  • Revenue        — GMV, orders, AOV, top 5 makers by sales
  • Makers         — new applications, new approvals, new Plus
  • Catalog        — new listings, new design files, new clips
  • Traffic        — pageviews, sessions, top 5 sources
  • Reliability    — prod-health outages, LLM budget alerts, scheduler errors
  • Community      — new showcase posts, new threads, new design uploads

Scheduling: runs at 06:00 UTC every day via APScheduler.
Override: set `OPS_DIGEST_ENABLED=false` to disable.
"""
from __future__ import annotations

import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from core import db, logger
from email_service import OPS_EMAIL, _send


# ─────────────────────────────────────────────────────────────────────
# Time helpers
# ─────────────────────────────────────────────────────────────────────
def _yesterday_window() -> tuple[str, str]:
    """Returns (since_iso, until_iso) for the previous 00:00-24:00 UTC."""
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    since = today - timedelta(days=1)
    return (
        since.isoformat().replace("+00:00", "Z"),
        today.isoformat().replace("+00:00", "Z"),
    )


# ─────────────────────────────────────────────────────────────────────
# Section gatherers — each returns a dict the renderer can render or skip
# ─────────────────────────────────────────────────────────────────────
async def _gather_revenue(since: str, until: str) -> dict:
    orders = await db.payment_transactions.find(
        {"payment_status": "paid", "created_at": {"$gte": since, "$lt": until}},
        {"_id": 0, "id": 1, "amount": 1, "items": 1},
    ).to_list(2000)

    gmv = round(sum(float(o.get("amount") or 0) for o in orders), 2)
    by_maker: Counter = Counter()
    for o in orders:
        for it in (o.get("items") or []):
            slug = (it.get("maker_slug") or "").strip()
            if not slug:
                continue
            by_maker[slug] += float(it.get("price") or 0) * int(it.get("quantity") or 1)

    return {
        "orders": len(orders),
        "gmv": gmv,
        "aov": round(gmv / len(orders), 2) if orders else 0.0,
        "top_makers": by_maker.most_common(5),
    }


async def _gather_makers(since: str, until: str) -> dict:
    new_apps = await db.maker_applications.count_documents(
        {"created_at": {"$gte": since, "$lt": until}},
    )
    new_approvals = await db.maker_applications.count_documents(
        {"created_at": {"$gte": since, "$lt": until}, "status": "approved"},
    )
    new_plus = await db.makers.count_documents({
        "subscription_status": {"$in": ["active", "trialing"]},
        "subscription_created_at": {"$gte": since, "$lt": until},
    })
    new_makers = await db.makers.count_documents(
        {"created_at": {"$gte": since, "$lt": until}},
    )
    return {
        "new_applications": new_apps,
        "new_approvals": new_approvals,
        "new_makers": new_makers,
        "new_plus": new_plus,
    }


async def _gather_catalog(since: str, until: str) -> dict:
    new_listings = await db.products.count_documents(
        {"created_at": {"$gte": since, "$lt": until}},
    )
    new_design_files = await db.design_files.count_documents(
        {"created_at": {"$gte": since, "$lt": until}},
    )
    new_clips = await db.clips.count_documents(
        {"created_at": {"$gte": since, "$lt": until}},
    )
    return {
        "new_listings": new_listings,
        "new_design_files": new_design_files,
        "new_clips": new_clips,
    }


async def _gather_traffic(since: str, until: str) -> dict:
    rows = await db.pageview_events.find(
        {"ts": {"$gte": since, "$lt": until}},
        {"_id": 0, "session_id": 1, "visitor_id": 1, "source": 1, "path": 1},
    ).to_list(200000)

    sessions: set[str] = set()
    visitors: set[str] = set()
    by_source: Counter = Counter()
    by_path: Counter = Counter()
    for r in rows:
        if r.get("session_id"):
            sessions.add(r["session_id"])
        if r.get("visitor_id"):
            visitors.add(r["visitor_id"])
        by_source[(r.get("source") or "direct").lower()] += 1
        if r.get("path"):
            by_path[r["path"]] += 1

    return {
        "pageviews": len(rows),
        "sessions": len(sessions),
        "visitors": len(visitors),
        "top_sources": by_source.most_common(5),
        "top_pages": by_path.most_common(5),
    }


async def _gather_reliability(since: str, until: str) -> dict:
    # Production-health watchdog outages (sent via send_ops_prod_outage_alert)
    outage_logs = await db.prod_health_logs.find(
        {"created_at": {"$gte": since, "$lt": until}, "kind": "outage"},
        {"_id": 0, "endpoint": 1, "status": 1, "reason": 1, "created_at": 1},
    ).to_list(50) if "prod_health_logs" in await db.list_collection_names() else []

    # LLM budget alerts in the window
    budget_alerts = await db.llm_budget_alerts.find(
        {"created_at": {"$gte": since, "$lt": until}},
        {"_id": 0, "service": 1, "error_message": 1, "created_at": 1},
    ).to_list(20)

    return {
        "outages": outage_logs,
        "budget_alerts": budget_alerts,
    }


async def _gather_community(since: str, until: str) -> dict:
    showcase = await db.community_showcase.count_documents(
        {"created_at": {"$gte": since, "$lt": until}, "is_seed": {"$ne": True}},
    )
    threads = await db.forum_threads.count_documents(
        {"created_at": {"$gte": since, "$lt": until}, "is_seed": {"$ne": True}},
    ) if "forum_threads" in await db.list_collection_names() else 0
    organic_uploads = await db.design_files.count_documents(
        {"created_at": {"$gte": since, "$lt": until}, "is_seed": {"$ne": True}},
    )
    return {
        "new_showcase_posts": showcase,
        "new_forum_threads": threads,
        "new_organic_uploads": organic_uploads,
    }


# ─────────────────────────────────────────────────────────────────────
# HTML renderer — single dark email template matching the rest of the
# transactional emails (Mailgun handles it fine).
# ─────────────────────────────────────────────────────────────────────
def _render_html(date_label: str, data: dict[str, Any]) -> str:
    rev = data["revenue"]
    mk = data["makers"]
    cat = data["catalog"]
    tr = data["traffic"]
    rel = data["reliability"]
    com = data["community"]

    def stat_tile(label: str, value: str, accent: str = "#e5e5e5") -> str:
        return (
            "<td style='padding:10px 14px;border:1px solid #262626;background:#0a0a0a;width:25%;vertical-align:top'>"
            f"<div style='font-family:JetBrains Mono,monospace;font-size:9px;letter-spacing:0.22em;color:#737373;text-transform:uppercase;margin-bottom:4px'>{label}</div>"
            f"<div style='font-family:JetBrains Mono,monospace;font-size:18px;color:{accent};font-weight:700'>{value}</div>"
            "</td>"
        )

    def section_header(label: str, color: str) -> str:
        return (
            f"<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.28em;color:{color};text-transform:uppercase;margin:28px 0 10px'>◆ {label}</div>"
        )

    def top_list(rows: list, fmt) -> str:
        if not rows:
            return "<div style='font-family:JetBrains Mono,monospace;font-size:11px;color:#525252;padding:6px 0'>nothing yet</div>"
        return "".join(
            f"<div style='font-family:JetBrains Mono,monospace;font-size:11px;color:#a3a3a3;padding:3px 0;border-bottom:1px solid #1a1a1a'>{fmt(r)}</div>"
            for r in rows
        )

    parts: list[str] = []

    # Hero banner
    parts.append(
        "<div style='background:#0a0a0a;color:#e5e5e5;padding:32px;font-family:JetBrains Mono,monospace'>"
        "<div style='font-size:10px;letter-spacing:0.32em;color:#ff4500;text-transform:uppercase;margin-bottom:6px'>◆ Daily ops digest</div>"
        f"<div style='font-family:Bebas Neue,Arial Black,sans-serif;font-size:36px;line-height:1;color:#fff;letter-spacing:0.02em'>YESTERDAY ON CRAFTERS MARKET.</div>"
        f"<div style='font-family:JetBrains Mono,monospace;font-size:11px;color:#a3a3a3;margin-top:6px'>{date_label}</div>"
    )

    # Revenue
    parts.append(section_header("Revenue", "#10b981"))
    parts.append(
        "<table cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse'><tr>"
        + stat_tile("GMV", f"${rev['gmv']:,.2f}", "#34d399")
        + stat_tile("Orders", str(rev["orders"]))
        + stat_tile("AOV", f"${rev['aov']:,.2f}")
        + stat_tile("Top makers", str(len(rev["top_makers"])))
        + "</tr></table>"
    )
    if rev["top_makers"]:
        parts.append("<div style='margin-top:8px'>" + top_list(
            rev["top_makers"], lambda r: f"<span style='color:#e5e5e5'>{r[0]}</span> <span style='color:#525252'>·</span> ${r[1]:,.2f}",
        ) + "</div>")

    # Makers
    parts.append(section_header("Makers", "#06b6d4"))
    parts.append(
        "<table cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse'><tr>"
        + stat_tile("Applied", str(mk["new_applications"]))
        + stat_tile("Approved", str(mk["new_approvals"]))
        + stat_tile("New shops", str(mk["new_makers"]))
        + stat_tile("New Plus", str(mk["new_plus"]), "#fbbf24")
        + "</tr></table>"
    )

    # Catalog
    parts.append(section_header("Catalog", "#f59e0b"))
    parts.append(
        "<table cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse'><tr>"
        + stat_tile("New listings", str(cat["new_listings"]))
        + stat_tile("New designs", str(cat["new_design_files"]))
        + stat_tile("New clips", str(cat["new_clips"]))
        + stat_tile("", "")
        + "</tr></table>"
    )

    # Traffic
    parts.append(section_header("Traffic", "#a78bfa"))
    parts.append(
        "<table cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse'><tr>"
        + stat_tile("Pageviews", f"{tr['pageviews']:,}")
        + stat_tile("Sessions", f"{tr['sessions']:,}")
        + stat_tile("Visitors", f"{tr['visitors']:,}")
        + stat_tile("Sources", str(len(tr["top_sources"])))
        + "</tr></table>"
    )
    if tr["top_sources"]:
        parts.append("<div style='margin-top:8px'><div style='font-family:JetBrains Mono,monospace;font-size:9px;color:#737373;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:4px'>Top sources</div>" + top_list(
            tr["top_sources"], lambda r: f"<span style='color:#e5e5e5'>{r[0]}</span> <span style='color:#525252'>·</span> {r[1]:,} views",
        ) + "</div>")
    if tr["top_pages"]:
        parts.append("<div style='margin-top:8px'><div style='font-family:JetBrains Mono,monospace;font-size:9px;color:#737373;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:4px'>Top pages</div>" + top_list(
            tr["top_pages"], lambda r: f"<span style='color:#e5e5e5'>{r[0][:50]}</span> <span style='color:#525252'>·</span> {r[1]:,}",
        ) + "</div>")

    # Reliability — only show if there's something to report
    if rel["outages"] or rel["budget_alerts"]:
        parts.append(section_header("Reliability", "#ef4444"))
        if rel["outages"]:
            parts.append(f"<div style='font-family:JetBrains Mono,monospace;font-size:11px;color:#fca5a5;margin-bottom:6px'>{len(rel['outages'])} outage(s) detected</div>")
            parts.append(top_list(rel["outages"], lambda o: f"<span style='color:#fde68a'>{o.get('endpoint','?')}</span> · HTTP {o.get('status','?')} · {(o.get('reason') or '')[:60]}"))
        if rel["budget_alerts"]:
            parts.append(f"<div style='font-family:JetBrains Mono,monospace;font-size:11px;color:#fbbf24;margin-top:8px;margin-bottom:6px'>{len(rel['budget_alerts'])} LLM budget alert(s)</div>")
            parts.append(top_list(rel["budget_alerts"], lambda a: f"<span style='color:#fde68a'>{a.get('service','?')}</span> · {(a.get('error_message') or '')[:80]}"))
    else:
        parts.append(section_header("Reliability", "#525252"))
        parts.append("<div style='font-family:JetBrains Mono,monospace;font-size:11px;color:#525252'>✓ All clear — zero outages, zero budget alerts.</div>")

    # Community
    parts.append(section_header("Community", "#fb923c"))
    parts.append(
        "<table cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse'><tr>"
        + stat_tile("Showcase", str(com["new_showcase_posts"]))
        + stat_tile("Forum threads", str(com["new_forum_threads"]))
        + stat_tile("Organic uploads", str(com["new_organic_uploads"]))
        + stat_tile("", "")
        + "</tr></table>"
    )

    # Footer
    parts.append(
        "<div style='margin-top:32px;padding-top:18px;border-top:1px solid #262626;font-family:JetBrains Mono,monospace;font-size:10px;color:#525252;line-height:1.7'>"
        "Generated by the daily ops digest cron · 06:00 UTC.<br/>"
        "Disable: set <code style='color:#a3a3a3'>OPS_DIGEST_ENABLED=false</code> in production env.<br/>"
        "Full analytics: <a href='https://craftersmarket.org/admin/dashboard' style='color:#ff4500;text-decoration:none'>craftersmarket.org/admin/dashboard</a>"
        "</div></div>"
    )
    return "".join(parts)


# ─────────────────────────────────────────────────────────────────────
# Main entry — gather + render + send
# ─────────────────────────────────────────────────────────────────────
async def build_digest_data() -> dict:
    """Gather every section's data. Separated from send so the admin UI
    can preview the JSON without firing an email."""
    since, until = _yesterday_window()
    revenue = await _gather_revenue(since, until)
    makers = await _gather_makers(since, until)
    catalog = await _gather_catalog(since, until)
    traffic = await _gather_traffic(since, until)
    reliability = await _gather_reliability(since, until)
    community = await _gather_community(since, until)
    return {
        "window": {"since": since, "until": until},
        "revenue": revenue,
        "makers": makers,
        "catalog": catalog,
        "traffic": traffic,
        "reliability": reliability,
        "community": community,
    }


async def send_daily_digest(*, recipient: str | None = None, dry_run: bool = False) -> dict:
    """Build the digest and ship it to OPS_EMAIL.

    Args:
        recipient: override the destination (testing / manual send).
        dry_run:   skip the actual send, return the rendered HTML.

    Returns:
        {"sent": bool, "to": str, "data": dict, "html_bytes": int}
    """
    if os.environ.get("OPS_DIGEST_ENABLED", "true").lower() not in ("1", "true", "yes"):
        return {"sent": False, "reason": "disabled_via_env"}

    to = recipient or OPS_EMAIL
    if not to:
        return {"sent": False, "reason": "no_recipient"}

    data = await build_digest_data()
    # Date label uses yesterday's calendar date in UTC for the subject.
    since_dt = datetime.fromisoformat(data["window"]["since"].replace("Z", "+00:00"))
    date_label = since_dt.strftime("%A · %b %d, %Y")
    html = _render_html(date_label, data)
    subject = f"[Crafters Market] Daily digest · {since_dt.strftime('%b %d')}"

    if dry_run:
        return {"sent": False, "dry_run": True, "to": to, "data": data, "html_bytes": len(html)}

    try:
        result = await _send(to, subject, html)
    except Exception as e:
        logger.exception("[ops_digest] send failed: %s", e)
        return {"sent": False, "reason": f"send_error: {e}", "to": to}

    logger.info(
        "[ops_digest] sent to %s · gmv=$%.2f · orders=%d · pv=%d",
        to, data["revenue"]["gmv"], data["revenue"]["orders"], data["traffic"]["pageviews"],
    )
    return {"sent": result is not None, "to": to, "subject": subject, "data": data}
