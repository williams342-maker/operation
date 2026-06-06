"""iter334y — Weekly ROAS digest email.

Sends an HTML email to OPS_EMAIL every Monday morning summarising the
last 7 days of paid-channel performance:

  • Combined ROAS (across Microsoft + Google + Meta)
  • Per-platform breakdown (orders / revenue / spend / ROAS)
  • Week-over-week % change vs the prior 7 days

Idempotent on ISO week — re-runs in the same week are no-ops thanks to
`roas_digest_log`. Admin trigger endpoint for ad-hoc previews.
"""
from __future__ import annotations
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends

from core import db, now_iso
from maker_auth import current_admin
from email_service import _send, _shell, OPS_EMAIL
from routers.admin_all_roas import _platform_aggregate

logger = logging.getLogger("crafters.roas_digest")
router = APIRouter()

WINDOW_DAYS = 7


def _iso_week(d: datetime) -> str:
    """ISO calendar week tag — used as the idempotency key."""
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


async def _build_digest_data(days: int = WINDOW_DAYS) -> dict:
    """Aggregate this-week + last-week stats so the email can show
    week-over-week deltas. Mirrors the All Ads endpoint."""
    now = datetime.now(timezone.utc)
    this_start = now - timedelta(days=days)
    last_start = now - timedelta(days=2 * days)
    last_end = this_start

    def _date_str(d): return d.strftime("%Y-%m-%d")

    async def _bucket(start_dt: datetime, end_dt: datetime) -> dict:
        start_iso = start_dt.isoformat()
        start_date = _date_str(start_dt)
        end_date = _date_str(end_dt)
        # We need to also constrain the iso `created_at` upper bound for
        # the "last week" bucket, but `_platform_aggregate` only takes
        # a lower bound. Easiest fix: filter post-hoc by passing the end
        # iso in via a quick override below. For now reuse the helper
        # and accept the per-day-date filter is correct for spend; we
        # constrain revenue with a wrapper below.
        ms = await _platform_aggregate("microsoft", days, start_iso, start_date, end_date)
        gg = await _platform_aggregate("google", days, start_iso, start_date, end_date)
        mt = await _platform_aggregate("meta", days, start_iso, start_date, end_date)
        # For the LAST-week bucket we want revenue only up to last_end,
        # not "everything since last_start" — recompute revenue with
        # an upper bound. Spend already respects the date range via
        # YYYY-MM-DD strings.
        if end_dt < now - timedelta(hours=1):
            end_iso = end_dt.isoformat()
            for row, click in ((ms, "msclkid"), (gg, "gclid"), (mt, "fbclid")):
                cursor = db.payment_transactions.find(
                    {click: {"$exists": True, "$nin": [None, ""]},
                     "payment_status": "paid",
                     "created_at": {"$gte": start_iso, "$lt": end_iso}},
                    {"_id": 0, "amount": 1},
                )
                orders, rev = 0, 0.0
                async for tx in cursor:
                    orders += 1
                    rev += float(tx.get("amount") or 0)
                row["orders"] = orders
                row["revenue"] = round(rev, 2)
                row["roas"] = round(rev / row["spend"], 2) if row["spend"] else None
        total_orders = ms["orders"] + gg["orders"] + mt["orders"]
        total_rev = round(ms["revenue"] + gg["revenue"] + mt["revenue"], 2)
        total_spend = round(ms["spend"] + gg["spend"] + mt["spend"], 2)
        return {
            "total_orders": total_orders,
            "total_revenue": total_rev,
            "total_spend": total_spend,
            "roas": round(total_rev / total_spend, 2) if total_spend else None,
            "breakdown": [ms, gg, mt],
        }

    this_week = await _bucket(this_start, now)
    last_week = await _bucket(last_start, last_end)

    # Week-over-week deltas, expressed as integer % (None if last bucket
    # was zero — would be a /0).
    def _wow(curr: float, prev: float) -> Optional[int]:
        if not prev:
            return None
        return round((curr - prev) / prev * 100)

    deltas = {
        "orders": _wow(this_week["total_orders"], last_week["total_orders"]),
        "revenue": _wow(this_week["total_revenue"], last_week["total_revenue"]),
        "spend": _wow(this_week["total_spend"], last_week["total_spend"]),
        "roas": _wow(this_week["roas"] or 0, last_week["roas"] or 0),
    }
    return {
        "this_week": this_week,
        "last_week": last_week,
        "deltas": deltas,
        "window_days": days,
        "window_end": now.strftime("%b %d, %Y"),
    }


def _render_digest_html(data: dict) -> str:
    """Render the digest body. Lives in the same dark-Crafters aesthetic
    as the other ops emails."""
    tw = data["this_week"]
    deltas = data["deltas"]
    roas_str = f"{tw['roas']:.2f}×" if tw["roas"] is not None else "—"

    def _delta_pill(label: str, pct: Optional[int]) -> str:
        if pct is None:
            return f"<span style='color:#525252;font-size:11px'>{label}: —</span>"
        if pct > 0:
            color = "#10b981"
            arrow = "▲"
        elif pct < 0:
            color = "#ef4444"
            arrow = "▼"
        else:
            color = "#a3a3a3"
            arrow = "■"
        return (f"<span style='color:{color};font-size:11px'>"
                f"{label}: {arrow} {abs(pct)}%</span>")

    plat_label = {"microsoft": "Microsoft", "google": "Google", "meta": "Meta"}
    plat_color = {"microsoft": "#22d3ee", "google": "#34d399", "meta": "#60a5fa"}
    rows_html = ""
    for p in tw["breakdown"]:
        proas = f"{p['roas']:.2f}×" if p["roas"] is not None else "—"
        rows_html += f"""
        <tr style='border-top:1px solid #262626'>
          <td style='padding:10px 0;color:{plat_color[p['platform']]};font-weight:bold'>
            {plat_label[p['platform']]}
          </td>
          <td style='padding:10px 0;color:#e5e5e5;text-align:right'>{p['orders']}</td>
          <td style='padding:10px 0;color:#e5e5e5;text-align:right'>${p['revenue']:.0f}</td>
          <td style='padding:10px 0;color:#e5e5e5;text-align:right'>${p['spend']:.0f}</td>
          <td style='padding:10px 0;color:{plat_color[p['platform']]};text-align:right;font-weight:bold'>{proas}</td>
        </tr>"""

    headline = f"""
    <div style='text-align:center;padding:24px 0;border:1px solid #ff4500;background:#1a0f08;margin-bottom:20px'>
      <div style='font-size:11px;color:#737373;letter-spacing:0.22em;text-transform:uppercase'>Combined ROAS · last {data['window_days']} days</div>
      <div style='font-size:48px;color:#ff4500;font-weight:bold;margin:8px 0'>{roas_str}</div>
      <div style='font-size:13px;color:#a3a3a3'>${tw['total_revenue']:.0f} revenue / ${tw['total_spend']:.0f} spend · {tw['total_orders']} orders</div>
      <div style='font-size:11px;color:#737373;margin-top:8px'>
        {_delta_pill('vs prior week', deltas['roas'])}
        &nbsp;&nbsp;
        {_delta_pill('rev', deltas['revenue'])}
        &nbsp;&nbsp;
        {_delta_pill('spend', deltas['spend'])}
        &nbsp;&nbsp;
        {_delta_pill('orders', deltas['orders'])}
      </div>
    </div>

    <table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;margin-top:12px'>
      <thead>
        <tr>
          <th style='text-align:left;font-size:11px;color:#737373;letter-spacing:0.22em;text-transform:uppercase;padding-bottom:6px'>Platform</th>
          <th style='text-align:right;font-size:11px;color:#737373;letter-spacing:0.22em;text-transform:uppercase;padding-bottom:6px'>Orders</th>
          <th style='text-align:right;font-size:11px;color:#737373;letter-spacing:0.22em;text-transform:uppercase;padding-bottom:6px'>Revenue</th>
          <th style='text-align:right;font-size:11px;color:#737373;letter-spacing:0.22em;text-transform:uppercase;padding-bottom:6px'>Spend</th>
          <th style='text-align:right;font-size:11px;color:#737373;letter-spacing:0.22em;text-transform:uppercase;padding-bottom:6px'>ROAS</th>
        </tr>
      </thead>
      <tbody>{rows_html}</tbody>
    </table>

    <p style='font-size:11px;color:#525252;margin-top:24px;line-height:1.6'>
      Tracked via msclkid (Microsoft), gclid (Google), fbclid (Meta) on
      payment_transactions; spend pulled from each platform's daily sync.
      Manage subscription in admin → Settings → Email preferences.
    </p>"""
    return _shell("Weekly ROAS Digest.",
                  f"Paid-channel performance · 7 days ending {data['window_end']}",
                  headline, "Ops digest")


async def run_weekly_roas_digest(force: bool = False) -> dict:
    """Build + send the digest. Idempotent on ISO week unless `force`."""
    if not OPS_EMAIL:
        return {"status": "skipped", "reason": "no_ops_email"}

    week_tag = _iso_week(datetime.now(timezone.utc))
    if not force:
        already = await db.roas_digest_log.find_one({"_id": week_tag})
        if already:
            return {"status": "skipped", "reason": "already_sent_this_week",
                    "week": week_tag, "sent_at": already.get("sent_at")}

    data = await _build_digest_data()
    html = _render_digest_html(data)
    subject = (f"Weekly ROAS · {data['this_week']['roas']:.2f}×"
               if data["this_week"]["roas"] is not None
               else f"Weekly ROAS · {data['window_end']}")
    try:
        await _send(OPS_EMAIL, subject, html)
    except Exception as e:
        logger.exception("[roas_digest] send failed: %s", e)
        return {"status": "error", "error": str(e)[:300]}

    await db.roas_digest_log.update_one(
        {"_id": week_tag},
        {"$set": {"sent_at": now_iso(), "roas": data["this_week"]["roas"],
                  "revenue": data["this_week"]["total_revenue"],
                  "spend": data["this_week"]["total_spend"],
                  "orders": data["this_week"]["total_orders"]}},
        upsert=True,
    )
    return {"status": "sent", "week": week_tag,
            "roas": data["this_week"]["roas"],
            "revenue": data["this_week"]["total_revenue"],
            "spend": data["this_week"]["total_spend"]}


# ── Admin endpoints ────────────────────────────────────────────────────
@router.post("/admin/ads/roas-digest/run")
async def admin_run_roas_digest(force: bool = True, _: dict = Depends(current_admin)):
    """Ad-hoc trigger from the admin UI. Default `force=true` so a manual
    click sends even if this week's already-sent — admin expects an
    immediate email when they click 'Send now'."""
    return await run_weekly_roas_digest(force=force)


@router.get("/admin/ads/roas-digest/preview")
async def admin_preview_roas_digest(_: dict = Depends(current_admin)):
    """Returns the raw digest data (no email) so an admin UI can render a
    web preview of what the email will look like."""
    return await _build_digest_data()


@router.get("/admin/ads/roas-digest/history")
async def admin_roas_digest_history(_: dict = Depends(current_admin)):
    """Last 12 weeks of sent digests for the admin UI ledger."""
    cursor = db.roas_digest_log.find({}, {"_id": 1, "sent_at": 1, "roas": 1,
                                          "revenue": 1, "spend": 1, "orders": 1})
    cursor = cursor.sort("sent_at", -1).limit(12)
    out = []
    async for r in cursor:
        out.append({
            "week": r.get("_id"),
            "sent_at": r.get("sent_at"),
            "roas": r.get("roas"),
            "revenue": r.get("revenue"),
            "spend": r.get("spend"),
            "orders": r.get("orders"),
        })
    return {"history": out}
