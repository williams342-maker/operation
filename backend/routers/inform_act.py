"""INFORM Consumers Act compliance automation (iter462).

Federal law (15 U.S.C. § 45f) requires online marketplaces to collect,
verify, and (at $20k+/yr) disclose identity information from
"high-volume third party sellers": 200+ discrete sales AND $5,000+
gross revenue in any continuous 12-month period.

Endpoints:
    GET  /api/maker/inform-act                → maker compliance state
    POST /api/maker/inform-act/submit         → submit identity info
    POST /api/maker/inform-act/certify        → annual certification
    GET  /api/admin/inform-act                → compliance queue (all makers)
    POST /api/admin/inform-act/scan           → run threshold scan now
    POST /api/admin/inform-act/{slug}/verify  → mark submission verified
    POST /api/admin/inform-act/{slug}/reject  → reject with note
    POST /api/admin/inform-act/{slug}/suspend / /reinstate
    GET  /api/makers/{slug}/seller-disclosure → public buyer-facing disclosure

PII policy: full tax IDs are NEVER stored — only a SHA-256 hash + last 4
digits. Bank info is name-on-account + last 4 only.
"""
from __future__ import annotations
import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_maker_slug, current_admin

router = APIRouter()

# Statutory thresholds (15 U.S.C. § 45f). BOTH must be met (AND).
TX_THRESHOLD = 200
REV_THRESHOLD = 5000.0
DISCLOSURE_REV_THRESHOLD = 20000.0
DEADLINE_DAYS = 10
CERT_INTERVAL_DAYS = 365

TAX_ID_TYPES = {"ssn", "ein", "itin"}
GOV_ID_TYPES = {"drivers_license", "passport", "state_id"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _cutoff_iso(days: int = 365) -> str:
    return (_now() - timedelta(days=days)).isoformat()


# ── Rolling 12-month per-maker sales stats ──────────────────────────────
async def compute_rolling_stats() -> dict:
    """Returns {maker_slug: {tx_count, revenue}} over the trailing 365 days.

    Primary source: db.transactions (items carry maker_slug + price).
    Fallback: db.payment_transactions rows not present in transactions,
    resolved to makers via product lookup.
    """
    cutoff = _cutoff_iso()
    stats: dict[str, dict] = {}
    seen: set[str] = set()

    def bump(per: dict):
        for ms, rev in per.items():
            s = stats.setdefault(ms, {"tx_count": 0, "revenue": 0.0})
            s["tx_count"] += 1
            s["revenue"] += rev

    async for tx in db.transactions.find(
            {"payment_status": "paid", "created_at": {"$gte": cutoff}},
            {"_id": 0, "session_id": 1, "items": 1}):
        if tx.get("session_id"):
            seen.add(tx["session_id"])
        per: dict[str, float] = {}
        for li in tx.get("items") or []:
            ms = li.get("maker_slug")
            if not ms:
                continue
            qty = max(1, int(li.get("quantity") or 1))
            per[ms] = per.get(ms, 0.0) + float(li.get("price") or 0) * qty
        bump(per)

    prod_map: Optional[dict] = None
    async for tx in db.payment_transactions.find(
            {"payment_status": "paid", "created_at": {"$gte": cutoff}},
            {"_id": 0, "session_id": 1, "items": 1}):
        if tx.get("session_id") in seen:
            continue
        items = tx.get("items") or []
        if not items:
            continue
        if prod_map is None:
            prod_map = {}
            async for p in db.products.find(
                    {}, {"_id": 0, "id": 1, "maker_slug": 1, "price": 1}):
                if p.get("id"):
                    prod_map[p["id"]] = p
        per = {}
        for ci in items:
            p = prod_map.get(ci.get("product_id"))
            if not p or not p.get("maker_slug"):
                continue
            qty = max(1, int(ci.get("quantity") or 1))
            ms = p["maker_slug"]
            per[ms] = per.get(ms, 0.0) + float(p.get("price") or 0) * qty
        bump(per)

    for s in stats.values():
        s["revenue"] = round(s["revenue"], 2)
    return stats


# ── Emails ──────────────────────────────────────────────────────────────
async def _email(to: str, subject: str, title: str, intro: str, body: str):
    if not to:
        return
    try:
        from email_service import _shell, _send
        await _send(to, subject, _shell(title, intro, body, "INFORM Act compliance"))
    except Exception as e:  # pragma: no cover
        logger.warning("[inform-act] email to %s failed: %s", to, e)


async def _email_ops(subject: str, body: str):
    try:
        from email_service import OPS_EMAIL
        await _email(OPS_EMAIL, subject, "INFORM Act.", "Compliance event.", body)
    except Exception:  # pragma: no cover
        pass


def _p(text: str) -> str:
    return f"<p style='font-size:14px;color:#e5e5e5;line-height:1.7;margin:0 0 16px'>{text}</p>"


def _cta(label: str) -> str:
    import os
    site = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    return (
        f"<div style='margin-top:22px'><a href='{site}/maker/dashboard?tab=settings' "
        "style='display:inline-block;background:#ff4500;color:#0a0a0a;padding:12px 22px;"
        "font-family:Impact,Arial Black,sans-serif;font-size:13px;letter-spacing:0.18em;"
        f"text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>{label} →</a></div>"
    )


# ── Threshold scan (cron + manual) ──────────────────────────────────────
async def run_inform_scan(trigger: str = "cron") -> dict:
    stats = await compute_rolling_stats()
    now = _now()
    flagged, suspended, recert_reminded = [], [], []

    query = {"$or": [{"slug": {"$in": list(stats)}}, {"inform_act": {"$exists": True}}]}
    async for m in db.makers.find(query, {"_id": 0, "slug": 1, "name": 1, "email": 1, "inform_act": 1}):
        slug = m["slug"]
        st = stats.get(slug, {"tx_count": 0, "revenue": 0.0})
        ia = m.get("inform_act") or {}
        status = ia.get("status")
        update = {"inform_act.window": {**st, "computed_at": now_iso()}}
        qualifies = st["tx_count"] >= TX_THRESHOLD and st["revenue"] >= REV_THRESHOLD

        if st["revenue"] >= DISCLOSURE_REV_THRESHOLD:
            update["inform_act.disclosure_required"] = True

        if qualifies and not status:
            deadline = (now + timedelta(days=DEADLINE_DAYS)).isoformat()
            update.update({
                "inform_act.status": "collection_required",
                "inform_act.qualified_at": now_iso(),
                "inform_act.deadline_at": deadline,
            })
            flagged.append(slug)
            await _email(
                m.get("email"),
                "Action required · Seller identity verification",
                "Verification required.",
                "Federal INFORM Consumers Act.",
                _p(f"Congratulations {m.get('name') or slug} — your shop crossed "
                   f"<b style='color:#ff4500'>{st['tx_count']} orders</b> and "
                   f"<b style='color:#ff4500'>${st['revenue']:,.2f}</b> in sales over the last 12 months. "
                   "Under the federal INFORM Consumers Act, high-volume sellers must verify their identity.")
                + _p(f"Please submit your legal name, address, contact info, tax ID, and bank details "
                     f"within <b style='color:#ff4500'>{DEADLINE_DAYS} days</b>. "
                     "Shops that don't complete verification must be suspended — we don't want that.")
                + _cta("Complete verification"),
            )
            await _email_ops(
                f"INFORM · {slug} crossed the high-volume threshold",
                _p(f"Maker <b>{slug}</b>: {st['tx_count']} orders / ${st['revenue']:,.2f} in trailing 12 months. "
                   f"Collection deadline: {DEADLINE_DAYS} days."),
            )

        if status == "collection_required" and ia.get("deadline_at") and ia["deadline_at"] < now_iso():
            update.update({
                "inform_act.status": "suspended",
                "inform_act.suspended_at": now_iso(),
                "inform_act.suspended_reason": "Verification deadline passed without submission.",
            })
            suspended.append(slug)
            await _email(
                m.get("email"),
                "Shop suspended · Verification deadline passed",
                "Shop suspended.",
                "INFORM Act deadline passed.",
                _p(f"{m.get('name') or slug}, the {DEADLINE_DAYS}-day window to submit your seller "
                   "identity information has passed, so your shop has been suspended as required by "
                   "the INFORM Consumers Act.")
                + _p("Submit your information now and our team will verify it and reinstate your shop.")
                + _cta("Submit information"),
            )
            await _email_ops(
                f"INFORM · {slug} SUSPENDED (deadline passed)",
                _p(f"Maker <b>{slug}</b> missed the collection deadline and was auto-suspended."),
            )

        if (status == "verified" and ia.get("next_certification_due_at")
                and ia["next_certification_due_at"] < now_iso()
                and not ia.get("recert_notified_at")):
            update["inform_act.recert_notified_at"] = now_iso()
            recert_reminded.append(slug)
            await _email(
                m.get("email"),
                "Annual certification due · Seller identity info",
                "Annual check-in.",
                "INFORM Act certification.",
                _p(f"{m.get('name') or slug}, federal law asks high-volume sellers to certify once a year "
                   "that their identity information is still current.")
                + _p("It's one click if nothing changed — open your dashboard settings and hit "
                     "\"Certify my info is current\".")
                + _cta("Certify now"),
            )

        await db.makers.update_one({"slug": slug}, {"$set": update})

    summary = {
        "at": now_iso(), "trigger": trigger,
        "makers_scanned": len(stats),
        "newly_flagged": flagged, "auto_suspended": suspended,
        "recert_reminded": recert_reminded,
    }
    await db.inform_act_scans.insert_one({**summary})
    summary.pop("_id", None)
    logger.info("[inform-act] scan (%s): flagged=%s suspended=%s", trigger, flagged, suspended)
    return summary


# ── Serialization helpers ───────────────────────────────────────────────
def _masked_submission(sub: dict | None) -> Optional[dict]:
    if not sub:
        return None
    return {k: sub.get(k) for k in (
        "full_name", "is_business", "business_name", "street", "city", "state",
        "zip_code", "country", "contact_email", "contact_phone", "tax_id_type",
        "tax_id_last4", "gov_id_type", "bank_name", "bank_account_name",
        "bank_last4", "submitted_at")}


def _maker_view(m: dict, live_stats: Optional[dict] = None) -> dict:
    ia = m.get("inform_act") or {}
    window = live_stats or ia.get("window") or {"tx_count": 0, "revenue": 0.0}
    return {
        "status": ia.get("status") or "monitoring",
        "qualifies": (window.get("tx_count", 0) >= TX_THRESHOLD
                      and window.get("revenue", 0) >= REV_THRESHOLD),
        "window": window,
        "deadline_at": ia.get("deadline_at"),
        "qualified_at": ia.get("qualified_at"),
        "disclosure_required": bool(ia.get("disclosure_required")),
        "submission": _masked_submission(ia.get("submission")),
        "verified_at": ia.get("verified_at"),
        "rejection_note": ia.get("rejection_note"),
        "suspended_reason": ia.get("suspended_reason"),
        "annual_certified_at": ia.get("annual_certified_at"),
        "next_certification_due_at": ia.get("next_certification_due_at"),
        "certification_overdue": bool(
            ia.get("status") == "verified"
            and ia.get("next_certification_due_at")
            and ia["next_certification_due_at"] < now_iso()),
        "thresholds": {"tx": TX_THRESHOLD, "revenue": REV_THRESHOLD,
                       "disclosure_revenue": DISCLOSURE_REV_THRESHOLD,
                       "deadline_days": DEADLINE_DAYS},
    }


# ── Maker endpoints ─────────────────────────────────────────────────────
@router.get("/maker/inform-act")
async def maker_inform_state(slug: str = Depends(current_maker_slug)):
    m = await db.makers.find_one({"slug": slug}, {"_id": 0, "inform_act": 1})
    if m is None:
        raise HTTPException(404, "Maker not found.")
    return _maker_view(m)


class InformSubmission(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    is_business: bool = False
    business_name: Optional[str] = Field(default=None, max_length=160)
    street: str = Field(min_length=3, max_length=200)
    city: str = Field(min_length=2, max_length=100)
    state: str = Field(min_length=2, max_length=50)
    zip_code: str = Field(min_length=3, max_length=12)
    country: str = Field(default="US", max_length=2)
    contact_email: str = Field(min_length=5, max_length=200)
    contact_phone: str = Field(min_length=7, max_length=25)
    tax_id_type: str
    tax_id: str = Field(min_length=4, max_length=20)
    gov_id_type: str
    bank_name: str = Field(min_length=2, max_length=120)
    bank_account_name: str = Field(min_length=2, max_length=120)
    bank_last4: str = Field(min_length=4, max_length=4)


@router.post("/maker/inform-act/submit")
async def maker_inform_submit(req: InformSubmission,
                              slug: str = Depends(current_maker_slug)):
    if req.tax_id_type not in TAX_ID_TYPES:
        raise HTTPException(400, "Invalid tax ID type.")
    if req.gov_id_type not in GOV_ID_TYPES:
        raise HTTPException(400, "Invalid government ID type.")
    if not re.match(r"^[0-9]{4}$", req.bank_last4):
        raise HTTPException(400, "Bank last-4 must be four digits.")
    if "@" not in req.contact_email:
        raise HTTPException(400, "Enter a working email address.")
    tax_digits = re.sub(r"[^0-9]", "", req.tax_id)
    if len(tax_digits) < 4:
        raise HTTPException(400, "Tax ID looks too short.")
    if req.is_business and not (req.business_name or "").strip():
        raise HTTPException(400, "Business name is required for business sellers.")

    m = await db.makers.find_one({"slug": slug}, {"_id": 0, "inform_act": 1, "name": 1})
    if m is None:
        raise HTTPException(404, "Maker not found.")

    sub = req.model_dump(exclude={"tax_id"})
    sub["tax_id_last4"] = tax_digits[-4:]
    sub["tax_id_hash"] = hashlib.sha256(tax_digits.encode()).hexdigest()
    sub["submitted_at"] = now_iso()

    await db.makers.update_one({"slug": slug}, {"$set": {
        "inform_act.submission": sub,
        "inform_act.status": "pending_verification",
        "inform_act.rejection_note": None,
    }})
    await _email_ops(
        f"INFORM · {slug} submitted identity info — verify within 10 days",
        _p(f"Maker <b>{slug}</b> submitted their INFORM Act identity information. "
           "Review and verify it in Admin → INFORM Act (statutory 10-day verification window)."),
    )
    fresh = await db.makers.find_one({"slug": slug}, {"_id": 0, "inform_act": 1})
    return _maker_view(fresh)


@router.post("/maker/inform-act/certify")
async def maker_inform_certify(slug: str = Depends(current_maker_slug)):
    m = await db.makers.find_one({"slug": slug}, {"_id": 0, "inform_act": 1})
    ia = (m or {}).get("inform_act") or {}
    if ia.get("status") != "verified":
        raise HTTPException(400, "Certification is only available once your info is verified.")
    next_due = (_now() + timedelta(days=CERT_INTERVAL_DAYS)).isoformat()
    await db.makers.update_one({"slug": slug}, {"$set": {
        "inform_act.annual_certified_at": now_iso(),
        "inform_act.next_certification_due_at": next_due,
        "inform_act.recert_notified_at": None,
    }})
    fresh = await db.makers.find_one({"slug": slug}, {"_id": 0, "inform_act": 1})
    return _maker_view(fresh)


# ── Admin endpoints ─────────────────────────────────────────────────────
@router.get("/admin/inform-act")
async def admin_inform_list(admin: dict = Depends(current_admin)):
    stats = await compute_rolling_stats()
    rows = []
    query = {"$or": [{"slug": {"$in": list(stats)}}, {"inform_act": {"$exists": True}}]}
    async for m in db.makers.find(query, {"_id": 0, "slug": 1, "name": 1, "email": 1, "inform_act": 1}):
        view = _maker_view(m, live_stats=stats.get(m["slug"]))
        rows.append({"slug": m["slug"], "name": m.get("name") or m["slug"],
                     "email": m.get("email"), **view})
    rows.sort(key=lambda r: r["window"].get("revenue", 0), reverse=True)
    last_scan = await db.inform_act_scans.find_one({}, {"_id": 0}, sort=[("at", -1)])
    return {"rows": rows, "last_scan": last_scan,
            "thresholds": {"tx": TX_THRESHOLD, "revenue": REV_THRESHOLD,
                           "disclosure_revenue": DISCLOSURE_REV_THRESHOLD,
                           "deadline_days": DEADLINE_DAYS}}


@router.post("/admin/inform-act/scan")
async def admin_inform_scan(admin: dict = Depends(current_admin)):
    return await run_inform_scan(trigger="manual")


async def _admin_get_maker(slug: str) -> dict:
    m = await db.makers.find_one({"slug": slug}, {"_id": 0, "slug": 1, "name": 1,
                                                  "email": 1, "inform_act": 1})
    if m is None:
        raise HTTPException(404, "Maker not found.")
    return m


@router.post("/admin/inform-act/{slug}/verify")
async def admin_inform_verify(slug: str, admin: dict = Depends(current_admin)):
    m = await _admin_get_maker(slug)
    ia = m.get("inform_act") or {}
    if not ia.get("submission"):
        raise HTTPException(400, "Maker hasn't submitted their information yet.")
    next_due = (_now() + timedelta(days=CERT_INTERVAL_DAYS)).isoformat()
    disclosure = bool(ia.get("disclosure_required")) or (
        (ia.get("window") or {}).get("revenue", 0) >= DISCLOSURE_REV_THRESHOLD)
    await db.makers.update_one({"slug": slug}, {"$set": {
        "inform_act.status": "verified",
        "inform_act.verified_at": now_iso(),
        "inform_act.verified_by": admin.get("email"),
        "inform_act.disclosure_required": disclosure,
        "inform_act.annual_certified_at": now_iso(),
        "inform_act.next_certification_due_at": next_due,
        "inform_act.rejection_note": None,
        "inform_act.suspended_at": None,
        "inform_act.suspended_reason": None,
    }})
    await _email(
        m.get("email"), "You're verified · Seller identity confirmed",
        "Verified.", "INFORM Act compliance complete.",
        _p(f"Good news {m.get('name') or slug} — your seller identity information has been "
           "verified. Your shop is fully compliant with the INFORM Consumers Act.")
        + (_p("Because your shop does over $20,000/year, a short seller-identity summary now "
              "appears on your shop page, as the law requires.") if disclosure else "")
        + _cta("Open dashboard"),
    )
    fresh = await _admin_get_maker(slug)
    return {"slug": slug, **_maker_view(fresh)}


class RejectReq(BaseModel):
    note: str = Field(min_length=3, max_length=1000)


@router.post("/admin/inform-act/{slug}/reject")
async def admin_inform_reject(slug: str, req: RejectReq,
                              admin: dict = Depends(current_admin)):
    m = await _admin_get_maker(slug)
    deadline = (_now() + timedelta(days=DEADLINE_DAYS)).isoformat()
    await db.makers.update_one({"slug": slug}, {"$set": {
        "inform_act.status": "collection_required",
        "inform_act.rejection_note": req.note.strip(),
        "inform_act.deadline_at": deadline,
    }})
    await _email(
        m.get("email"), "Action needed · Seller info couldn't be verified",
        "One more pass.", "INFORM Act verification.",
        _p(f"{m.get('name') or slug}, we couldn't verify the seller information you submitted:")
        + _p(f"<i style='color:#ff4500'>{req.note.strip()}</i>")
        + _p(f"Please correct and resubmit within {DEADLINE_DAYS} days.")
        + _cta("Fix my info"),
    )
    fresh = await _admin_get_maker(slug)
    return {"slug": slug, **_maker_view(fresh)}


@router.post("/admin/inform-act/{slug}/suspend")
async def admin_inform_suspend(slug: str, admin: dict = Depends(current_admin)):
    m = await _admin_get_maker(slug)
    await db.makers.update_one({"slug": slug}, {"$set": {
        "inform_act.status": "suspended",
        "inform_act.suspended_at": now_iso(),
        "inform_act.suspended_reason": "Suspended by marketplace admin.",
    }})
    await _email(
        m.get("email"), "Shop suspended · INFORM Act compliance",
        "Shop suspended.", "INFORM Act compliance.",
        _p(f"{m.get('name') or slug}, your shop has been suspended pending INFORM Act "
           "identity verification. Submit your information to get reinstated.")
        + _cta("Submit information"),
    )
    fresh = await _admin_get_maker(slug)
    return {"slug": slug, **_maker_view(fresh)}


@router.post("/admin/inform-act/{slug}/reinstate")
async def admin_inform_reinstate(slug: str, admin: dict = Depends(current_admin)):
    m = await _admin_get_maker(slug)
    ia = m.get("inform_act") or {}
    new_status = "verified" if ia.get("verified_at") else (
        "pending_verification" if ia.get("submission") else "collection_required")
    sets = {"inform_act.status": new_status,
            "inform_act.suspended_at": None,
            "inform_act.suspended_reason": None}
    if new_status == "collection_required":
        sets["inform_act.deadline_at"] = (_now() + timedelta(days=DEADLINE_DAYS)).isoformat()
    await db.makers.update_one({"slug": slug}, {"$set": sets})
    fresh = await _admin_get_maker(slug)
    return {"slug": slug, **_maker_view(fresh)}


# ── Public buyer-facing disclosure ($20k+ verified sellers) ─────────────
@router.get("/makers/{slug}/seller-disclosure")
async def seller_disclosure(slug: str):
    m = await db.makers.find_one(
        {"$or": [{"slug": slug}, {"custom_url": slug}]},
        {"_id": 0, "inform_act": 1, "name": 1})
    ia = (m or {}).get("inform_act") or {}
    sub = ia.get("submission") or {}
    if not (ia.get("disclosure_required") and ia.get("status") == "verified" and sub):
        raise HTTPException(404, "No seller disclosure for this shop.")
    if sub.get("is_business"):
        address = {k: sub.get(k) for k in ("street", "city", "state", "zip_code", "country")}
    else:
        # Individual sellers without a business address: partial disclosure
        # (state + country) as the Act permits.
        address = {"state": sub.get("state"), "country": sub.get("country")}
    return {
        "seller_name": sub.get("business_name") or sub.get("full_name"),
        "is_business": bool(sub.get("is_business")),
        "address": address,
        "contact_email": sub.get("contact_email"),
        "contact_phone": sub.get("contact_phone"),
        "verified_at": ia.get("verified_at"),
    }
