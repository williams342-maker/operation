"""iter316b — Lead-magnet drip email sequence (3-touch).

Triggered daily by the scheduler at 14:30 UTC. Walks the
`lead_magnet_subscribers` collection and sends the next email in a
3-step nurture sequence:

    Step 0 (initial)       → already sent the download link in
                             routers/lead_magnet.py at signup time.
                             We don't re-send it from here.
    Step 1 (day 3, +72h)   → "5 things makers wish they knew" — soft
                             value email with a couple of guide links
                             and a low-key apply CTA at the bottom.
    Step 2 (day 7, +168h)  → "Ready to turn this into income?" — direct
                             apply CTA. End of sequence.
    Step -1 (suppressed)   → user opted out, became a maker, or hard-
                             bounced. Skipped permanently.

GDPR / CAN-SPAM:
    The drip only emails subscribers with `consent_marketing=true`.
    Subscribers who left the box unchecked get the one-time
    transactional download email at signup but are never enrolled
    in the nurture sequence.

Idempotency:
    `drip_step` is bumped only after a successful send. A failed send
    leaves the step unchanged so the next tick re-tries. We also stamp
    `drip_last_sent_at` so a misbehaving cron can't double-send the
    same step in a single day.

Suppression:
    Before sending any drip step we check whether the email already
    belongs to an approved maker (`db.makers`) — if so, we bump to
    step -1 so the sequence stops cold. Don't pitch the apply form to
    someone who already applied.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from core import db
from email_service import _send  # internal multi-provider sender

log = logging.getLogger("crafters.lead_magnet_drip")

# ──────────────────────────────────────────────────────────────────
# Schedule
# ──────────────────────────────────────────────────────────────────

DRIP_STEPS = [
    # (step_to_send, min_age_days, subject, builder_fn_name)
    (1, 3, "5 things makers wish they knew before their first listing", "_build_step1"),
    (2, 7, "Ready to turn your CNC into a side income?", "_build_step2"),
]
# Cap one drip-send per subscriber per 24h regardless of cron frequency.
RESEND_GUARD_HOURS = 20


# ──────────────────────────────────────────────────────────────────
# Email bodies
# ──────────────────────────────────────────────────────────────────

SITE = "https://craftersmarket.org"


def _wrap(title: str, body_html: str) -> str:
    """Minimal dark-industrial brand wrapper. Keep CSS inline-only —
    most mail clients strip <style> blocks."""
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{title}</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0d0d0d;border:1px solid #262626;">
        <tr><td style="padding:24px 28px;border-bottom:1px solid #1f1f1f;">
          <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.25em;color:#ff4500;text-transform:uppercase;">◆ Crafters Market</div>
        </td></tr>
        <tr><td style="padding:32px 28px;">
          {body_html}
        </td></tr>
        <tr><td style="padding:20px 28px;border-top:1px solid #1f1f1f;font-family:'Courier New',monospace;font-size:11px;color:#525252;line-height:1.6;">
          You're receiving this because you grabbed the free CNC starter pack and opted in to occasional tips.
          <a href="{{unsubscribe_url}}" style="color:#a3a3a3;text-decoration:underline;">Unsubscribe</a> · <a href="{SITE}" style="color:#a3a3a3;text-decoration:underline;">craftersmarket.org</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def _build_step1(email: str, unsubscribe_url: str) -> tuple[str, str]:
    """Day-3 email — value-heavy, soft mention of selling on the platform.
    Returns (subject, html)."""
    subject = "5 things makers wish they knew before their first listing"
    body = f"""
<h1 style="font-family:Arial,sans-serif;font-size:24px;font-weight:800;margin:0 0 16px 0;color:#fafafa;line-height:1.25;text-transform:uppercase;letter-spacing:-0.01em;">
  Five lessons from CNC makers who've already shipped.
</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 18px 0;color:#d4d4d4;">
  Hope the starter pack is cutting clean. While you're playing with the files, here's what we hear from makers on Crafters Market about the things they wish someone had told them earlier:
</p>
<ol style="font-size:14px;line-height:1.7;color:#d4d4d4;padding-left:18px;margin:0 0 22px 0;">
  <li style="margin-bottom:10px;"><b style="color:#fafafa;">Material gauge matters more than your design.</b> 16-gauge bends in a stiff breeze. 1/8" plate looks pro and ships intact. <a href="{SITE}/guides/metal-gauge-finish-guide" style="color:#ff4500;">Quick gauge cheat sheet →</a></li>
  <li style="margin-bottom:10px;"><b style="color:#fafafa;">Outdoor mounting is the #1 complaint.</b> Stainless hardware, sealed substrate, no flush-mount. <a href="{SITE}/guides/outdoor-mounting-guide" style="color:#ff4500;">Read the mounting guide →</a></li>
  <li style="margin-bottom:10px;"><b style="color:#fafafa;">Price 3× your blank.</b> If the sheet stock costs $14, your finished piece should retail around $42 — labor and powder coat eat the rest.</li>
  <li style="margin-bottom:10px;"><b style="color:#fafafa;">Photos beat product titles.</b> One real-shop photo with lighting outperforms three Photoshop mock-ups every time.</li>
  <li style="margin-bottom:0;"><b style="color:#fafafa;">Custom orders pay 2-3× retail.</b> The same design with someone's last name on it becomes a $120 piece instead of $42.</li>
</ol>
<p style="font-size:15px;line-height:1.6;margin:0 0 18px 0;color:#d4d4d4;">
  When you have a couple of pieces you'd ship to a paying customer, take a look at
  <a href="{SITE}/apply?utm_source=lead_magnet_drip&utm_medium=email&utm_campaign=day3" style="color:#ff4500;font-weight:700;">applying to sell on Crafters Market</a>
  — we vet every maker, so the customers showing up are looking for the real thing.
</p>
<p style="font-size:14px;line-height:1.6;margin:0;color:#a3a3a3;">— The team</p>
"""
    return subject, _wrap(subject, body).replace("{unsubscribe_url}", unsubscribe_url)


def _build_step2(email: str, unsubscribe_url: str) -> tuple[str, str]:
    """Day-7 email — direct apply CTA. Last email in the sequence."""
    subject = "Ready to turn your CNC into a side income?"
    body = f"""
<h1 style="font-family:Arial,sans-serif;font-size:24px;font-weight:800;margin:0 0 16px 0;color:#fafafa;line-height:1.25;text-transform:uppercase;letter-spacing:-0.01em;">
  Your shop is doing the work. Your storefront should too.
</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 18px 0;color:#d4d4d4;">
  Quick reality check: if you sold one $80 piece a week from your CNC, that's $4,160/year. Two? $8,300. The work is already happening — what's missing is the buyer.
</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 18px 0;color:#d4d4d4;">
  Crafters Market is a vetted marketplace for American CNC makers. We do the buyer acquisition, the SEO, the catalog feeds into Pinterest / Google / Meta, the payment plumbing, the disputes. You ship the work.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="background:#ff4500;padding:14px 28px;">
    <a href="{SITE}/apply?utm_source=lead_magnet_drip&utm_medium=email&utm_campaign=day7" style="color:#0a0a0a;text-decoration:none;font-family:'Courier New',monospace;font-size:13px;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;">
      Apply to sell →
    </a>
  </td></tr>
</table>
<p style="font-size:14px;line-height:1.6;margin:0 0 12px 0;color:#a3a3a3;">
  Approvals take ~48h. We look at portfolio, photo quality, and shipping setup. <a href="{SITE}/founders" style="color:#a3a3a3;">Founder slots</a> get a year of $0 commission.
</p>
<p style="font-size:14px;line-height:1.6;margin:0;color:#a3a3a3;">— The team</p>
"""
    return subject, _wrap(subject, body).replace("{unsubscribe_url}", unsubscribe_url)


# ──────────────────────────────────────────────────────────────────
# Suppression helpers
# ──────────────────────────────────────────────────────────────────

async def _is_already_maker(email: str) -> bool:
    """Skip drip if the email already corresponds to an approved maker
    (or an applicant who's at least submitted). Avoid pitching the
    apply form to people who already did the thing."""
    if not email:
        return False
    # Approved maker?
    m = await db.makers.find_one(
        {"email": email.lower(), "deleted_at": {"$in": [None, ""]}},
        {"_id": 1},
    )
    if m:
        return True
    # Pending application?
    a = await db.maker_applications.find_one(
        {"email": email.lower(), "status": {"$nin": ["rejected"]}},
        {"_id": 1},
    )
    return bool(a)


def _unsub_url(email: str) -> str:
    """Build the one-click unsubscribe URL. Re-uses the existing
    newsletter unsubscribe handler — same `lead_magnet_subscribers`
    record gets marked `consent_marketing=false`."""
    # iter316 — dedicated unsubscribe path under /api/lead-magnet/.
    # The actual route is added in the same router so the email link
    # never 404s in environments where the newsletter route is gated.
    import urllib.parse as _u
    return f"{SITE}/api/lead-magnet/unsubscribe?email={_u.quote(email)}"


# ──────────────────────────────────────────────────────────────────
# Scheduler entrypoint
# ──────────────────────────────────────────────────────────────────

async def run_drip_tick(*, dry_run: bool = False) -> dict[str, Any]:
    """Walks the drip funnel and sends the next email per subscriber.

    Returns a dict with per-step counts + any errors for the admin
    dashboard / scheduler log."""
    now = datetime.now(timezone.utc)
    summary: dict[str, Any] = {
        "started_at": now.isoformat(),
        "dry_run": dry_run,
        "step1": {"candidates": 0, "sent": 0, "suppressed": 0, "errors": 0},
        "step2": {"candidates": 0, "sent": 0, "suppressed": 0, "errors": 0},
    }

    builders = {
        "_build_step1": _build_step1,
        "_build_step2": _build_step2,
    }

    for step_num, min_age_days, _subject_unused, builder_name in DRIP_STEPS:
        cutoff = (now - timedelta(days=min_age_days)).isoformat()
        resend_guard = (now - timedelta(hours=RESEND_GUARD_HOURS)).isoformat()

        # Candidates: consented + first_seen ≥ min_age_days ago +
        # current drip_step is the previous step (or unset for step 1).
        prev_step = step_num - 1
        query: dict[str, Any] = {
            "magnet": "starter-pack",
            "consent_marketing": True,
            "first_seen_at": {"$lte": cutoff},
            "$or": [
                {"drip_step": prev_step},
                # Treat missing drip_step as 0 so legacy rows enter the
                # funnel on step 1 without needing a backfill migration.
                {"drip_step": {"$exists": False}} if prev_step == 0 else {"_unreachable": True},
            ],
            # Don't double-send within RESEND_GUARD_HOURS.
            "$nor": [{"drip_last_sent_at": {"$gte": resend_guard}}],
        }
        # Strip the "_unreachable" sentinel for step ≥2 — we leave only
        # the explicit drip_step match.
        if prev_step != 0:
            query["$or"] = [{"drip_step": prev_step}]

        rows = await db.lead_magnet_subscribers.find(
            query,
            {"_id": 1, "email": 1, "first_seen_at": 1},
        ).limit(500).to_list(500)

        bucket = summary[f"step{step_num}"]
        bucket["candidates"] = len(rows)

        for r in rows:
            email = (r.get("email") or "").lower()
            if not email:
                continue
            if await _is_already_maker(email):
                # Mark suppressed so we never look at this row again.
                bucket["suppressed"] += 1
                if not dry_run:
                    await db.lead_magnet_subscribers.update_one(
                        {"_id": r["_id"]},
                        {"$set": {"drip_step": -1,
                                  "drip_last_sent_at": now.isoformat(),
                                  "drip_suppression_reason": "already_maker"}},
                    )
                continue

            if dry_run:
                # Don't actually send — just count.
                continue

            try:
                subject, html = builders[builder_name](email, _unsub_url(email))
                await _send(email, subject, html)
                await db.lead_magnet_subscribers.update_one(
                    {"_id": r["_id"]},
                    {"$set": {"drip_step": step_num,
                              "drip_last_sent_at": now.isoformat()}},
                )
                bucket["sent"] += 1
            except Exception as e:
                log.exception("[lead_magnet_drip] step %s send to %s failed: %s",
                              step_num, email, e)
                bucket["errors"] += 1

    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    # Stamp the cron-state collection so the admin card can prove the
    # tick actually ran today.
    if not dry_run:
        try:
            await db.cron_state.update_one(
                {"key": "lead_magnet_drip"},
                {"$set": {"last_run_at": summary["finished_at"], "last_summary": summary}},
                upsert=True,
            )
        except Exception as e:
            log.warning("[lead_magnet_drip] cron_state stamp failed: %s", e)

    log.info("[lead_magnet_drip] tick complete: %s", summary)
    return summary


# ──────────────────────────────────────────────────────────────────
# Public unsubscribe handler — mounted under the existing lead-magnet
# router via a tiny include in routers/lead_magnet.py (kept here to
# keep the drip module self-contained).
# ──────────────────────────────────────────────────────────────────

async def handle_unsubscribe(email: str) -> dict:
    """Flip consent_marketing=False + drip_step=-1 in one call. Always
    returns success so we don't leak which emails are on the list."""
    if email:
        await db.lead_magnet_subscribers.update_many(
            {"email": email.lower(), "magnet": "starter-pack"},
            {"$set": {"consent_marketing": False, "drip_step": -1,
                      "drip_suppression_reason": "user_unsubscribe",
                      "unsubscribed_at": datetime.now(timezone.utc).isoformat()}},
        )
    return {"ok": True}
