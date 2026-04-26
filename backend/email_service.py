"""Transactional email helpers for Crafters Market.

Supports three providers via EMAIL_PROVIDER env flag:
  - "mailersend" (default): MailerSend / MailerLite transactional REST API
  - "brevo": Brevo / Sendinblue REST API
  - "resend": Resend SDK (legacy fallback)
"""
import os
import asyncio
import logging
from pathlib import Path

import httpx
import resend
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

logger = logging.getLogger("crafters.email")
logger.setLevel(logging.INFO)
if not logger.handlers:
    h = logging.StreamHandler()
    h.setFormatter(logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))
    logger.addHandler(h)
logger.propagate = True

EMAIL_PROVIDER = os.environ.get("EMAIL_PROVIDER", "mailersend").lower()
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
BREVO_API_KEY = os.environ.get("BREVO_API_KEY", "")
MAILERSEND_API_KEY = os.environ.get("MAILERSEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "team@craftersmarket.org")
SENDER_NAME = os.environ.get("SENDER_NAME", "Crafters Market")
OPS_EMAIL = os.environ.get("OPS_EMAIL", "")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


def _has_provider() -> bool:
    if EMAIL_PROVIDER == "mailersend":
        return bool(MAILERSEND_API_KEY)
    if EMAIL_PROVIDER == "brevo":
        return bool(BREVO_API_KEY)
    return bool(RESEND_API_KEY)


async def _send_mailersend(to: str, subject: str, html: str):
    """Send via MailerSend's transactional REST API.
    https://developers.mailersend.com/api/v1/email"""
    payload = {
        "from": {"email": SENDER_EMAIL, "name": SENDER_NAME},
        "to": [{"email": to}],
        "subject": subject,
        "html": html,
    }
    headers = {
        "Authorization": f"Bearer {MAILERSEND_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.mailersend.com/v1/email", json=payload, headers=headers,
        )
    if r.status_code >= 400:
        # Surface the MailerSend error body so domain / token issues are easy to spot.
        logger.warning("mailersend error %d → %s: %s", r.status_code, to, r.text[:300])
        return None
    # MailerSend returns 202 Accepted with a `X-Message-Id` header (no body).
    msg_id = r.headers.get("X-Message-Id") or r.headers.get("x-message-id")
    logger.info("mailersend sent → %s · id=%s", to, msg_id)
    return {"message_id": msg_id}


async def _send_brevo(to: str, subject: str, html: str):
    """Send via Brevo's transactional REST API.
    https://developers.brevo.com/reference/sendtransacemail"""
    payload = {
        "sender": {"name": SENDER_NAME, "email": SENDER_EMAIL},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
    }
    headers = {
        "api-key": BREVO_API_KEY,
        "accept": "application/json",
        "content-type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.brevo.com/v3/smtp/email", json=payload, headers=headers,
        )
    if r.status_code >= 400:
        # Surface the Brevo error body in logs so config issues are easy to spot.
        logger.warning("brevo error %d → %s: %s", r.status_code, to, r.text[:300])
        return None
    body = r.json() if r.content else {}
    logger.info("brevo sent → %s · id=%s", to, body.get("messageId"))
    return body


async def _send_resend(to: str, subject: str, html: str):
    """Legacy Resend send."""
    try:
        params = {
            "from": f"{SENDER_NAME} <{SENDER_EMAIL}>",
            "to": [to], "subject": subject, "html": html,
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("resend sent → %s · id=%s", to,
                    getattr(result, "get", lambda *_: None)("id"))
        return result
    except Exception as e:
        logger.exception("resend failed → %s: %s", to, e)
        return None


async def _send(to: str, subject: str, html: str):
    if not _has_provider() or not to:
        logger.warning("email skipped (no key or recipient): %s", subject)
        return None
    if EMAIL_PROVIDER == "mailersend":
        return await _send_mailersend(to, subject, html)
    if EMAIL_PROVIDER == "brevo":
        return await _send_brevo(to, subject, html)
    return await _send_resend(to, subject, html)


def _shell(title: str, intro: str, body_html: str, footer: str = "") -> str:
    return f"""
    <div style="background:#0a0a0a;padding:40px 16px;font-family:'JetBrains Mono','Courier New',monospace;color:#e5e5e5">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#121212;border:1px solid #262626">
        <tr><td style="padding:32px 32px 24px;border-bottom:1px solid #262626">
          <div style="font-size:11px;letter-spacing:0.3em;color:#ff4500;text-transform:uppercase">◆ Crafters Market</div>
          <h1 style="font-family:Impact,'Arial Black',sans-serif;font-size:42px;line-height:1;margin:14px 0 0;color:#e5e5e5;text-transform:uppercase;letter-spacing:-0.01em">{title}</h1>
        </td></tr>
        <tr><td style="padding:24px 32px">
          <p style="font-size:14px;line-height:1.6;color:#a3a3a3;margin:0 0 20px">{intro}</p>
          {body_html}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #262626;font-size:10px;letter-spacing:0.22em;color:#525252;text-transform:uppercase">
          {footer or "Precision craft · delivered."} · craftersmarket.org
        </td></tr>
      </table>
    </div>"""


def _items_table(items: list[dict]) -> str:
    rows = "".join(
        f"<tr><td style='padding:10px 0;border-bottom:1px solid #262626;color:#e5e5e5'>{i.get('title','')} × {i.get('quantity',1)}</td>"
        f"<td style='padding:10px 0;border-bottom:1px solid #262626;text-align:right;color:#ff4500'>${float(i.get('price',0))*int(i.get('quantity',1)):.2f}</td></tr>"
        for i in items
    )
    return f"<table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;margin:8px 0 16px'>{rows}</table>"


async def send_buyer_receipt(buyer_email: str, summary: str, total: float, items: list[dict]):
    body = _items_table(items) if items else f"<p style='color:#e5e5e5'>{summary}</p>"
    body += f"<div style='border-top:1px solid #262626;padding-top:14px;display:flex;justify-content:space-between;font-size:14px'><span style='color:#a3a3a3;letter-spacing:0.22em;text-transform:uppercase;font-size:11px'>Total</span> <span style='color:#ff4500;font-family:Impact,sans-serif;font-size:28px;float:right'>${total:.2f}</span></div>"
    body += "<p style='font-size:13px;line-height:1.6;color:#a3a3a3;margin-top:24px'>Your makers have been notified. Each piece is built to order — expect a tracking email within 5–7 business days. Questions? Reply to this email anytime.</p>"

    # Per-maker review CTA — drives the order-confirmation high-engagement
    # moment into UGC. One CTA per unique maker (deduped).
    seen_makers = set()
    review_buttons = ""
    site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
    for it in items or []:
        slug = it.get("maker_slug")
        name = it.get("maker_name") or slug
        if not slug or slug in seen_makers:
            continue
        seen_makers.add(slug)
        link = (
            f"{site}/makers/{slug}#leave-review"
            f"?utm_source=email&utm_medium=transactional&utm_campaign=order-receipt-review"
        )
        review_buttons += (
            f"<a href='{link}' style='display:inline-block;margin:6px 8px 0 0;"
            "background:transparent;color:#ff4500;border:1px solid #ff4500;"
            "padding:10px 18px;font-family:JetBrains Mono,monospace;font-size:11px;"
            f"letter-spacing:0.22em;text-transform:uppercase;text-decoration:none'>★ Review {name}</a>"
        )
    if review_buttons:
        body += (
            "<div style='border-top:1px solid #262626;padding-top:18px;margin-top:24px'>"
            "<p style='font-size:11px;letter-spacing:0.22em;text-transform:uppercase;"
            "color:#a3a3a3;margin:0 0 6px'>◆ 30 seconds · big impact</p>"
            "<p style='font-size:13px;color:#e5e5e5;line-height:1.6;margin:0 0 12px'>"
            "When the piece arrives, drop your maker a quick review — it's the single biggest "
            "thing you can do to support an independent shop. Two taps."
            "</p>"
            f"<div style='line-height:1.8'>{review_buttons}</div>"
            "</div>"
        )

    html = _shell("Order Confirmed.", "Thanks for the order — here's your receipt.", body, "Order receipt")
    return await _send(buyer_email, "Your Crafters Market order is confirmed", html)


async def send_ops_new_order(summary: str, total: float, items: list[dict], buyer_email: str | None):
    if not OPS_EMAIL: return
    body = _items_table(items) if items else f"<p>{summary}</p>"
    body += f"<div style='border-top:1px solid #262626;padding-top:14px;font-size:13px;color:#e5e5e5'><b style='color:#ff4500'>Total: ${total:.2f}</b></div>"
    if buyer_email:
        body += f"<p style='font-size:13px;color:#a3a3a3;margin-top:16px'>Buyer: <a href='mailto:{buyer_email}' style='color:#ff4500'>{buyer_email}</a></p>"
    html = _shell("New Order.", "A new order just landed in the workshop queue.", body, "Maker / ops alert")
    return await _send(OPS_EMAIL, f"New order · ${total:.2f}", html)


async def send_ops_new_application(name: str, studio: str, location: str, email: str, about: str):
    if not OPS_EMAIL: return
    body = f"""
      <table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;border-top:1px solid #262626'>
        {''.join(f"<tr><td style='padding:8px 0;color:#a3a3a3;font-size:11px;letter-spacing:0.22em;text-transform:uppercase'>{k}</td><td style='padding:8px 0;color:#e5e5e5;text-align:right'>{v}</td></tr>" for k,v in [('Studio', studio), ('Applicant', name), ('Location', location), ('Email', email)])}
      </table>
      <p style='font-size:13px;color:#e5e5e5;margin-top:18px;line-height:1.6'>{about}</p>"""
    html = _shell("Maker Application.", "A new maker just applied to the program.", body, "Maker / ops alert")
    return await _send(OPS_EMAIL, f"New maker application · {studio}", html)


async def send_applicant_received(applicant_email: str, name: str, studio: str):
    """Sent to the applicant immediately after they submit a maker application —
    confirms receipt and sets expectations on the review timeline."""
    if not applicant_email:
        return None
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {name}, we got your application for <b style='color:#ff4500'>{studio}</b>. "
        "It's already in our review queue.</p>"
        "<div style='border-top:1px solid #262626;padding-top:18px;margin:18px 0'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.22em;"
        "text-transform:uppercase;color:#a3a3a3;margin:0 0 12px'>What happens next</div>"
        "<ol style='font-size:13px;color:#e5e5e5;line-height:1.7;padding-left:20px;margin:0'>"
        "<li>A founding-team member personally reviews every application — usually within 3 business days.</li>"
        "<li>If you're a fit, we'll send a welcome packet with your sign-in link, listing template, and Stripe payouts setup.</li>"
        "<li>If we need more info first, we'll just reply to this email.</li>"
        "</ol>"
        "</div>"
        "<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin:18px 0 0'>"
        "While you wait — keep your portfolio sharp, and start thinking about your first 3 listings. "
        "The fastest path to launch day is having photos + descriptions ready when you get the green light."
        "</p>"
        "<p style='font-size:12px;color:#525252;line-height:1.6;margin-top:24px'>"
        "Questions? Just reply — this email goes straight to the team."
        "</p>"
    )
    html = _shell(
        "Application Received.",
        "We're reviewing it now — here's what to expect.",
        body, "Maker program · application",
    )
    return await _send(
        applicant_email,
        f"We got your Crafters Market application · {studio}",
        html,
    )


async def send_ops_new_custom_order(name: str, email: str, project_type: str, material: str, description: str, budget: str | None):
    if not OPS_EMAIL: return
    body = f"""
      <table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;border-top:1px solid #262626'>
        {''.join(f"<tr><td style='padding:8px 0;color:#a3a3a3;font-size:11px;letter-spacing:0.22em;text-transform:uppercase'>{k}</td><td style='padding:8px 0;color:#e5e5e5;text-align:right'>{v or '—'}</td></tr>" for k,v in [('Project', project_type), ('Material', material), ('Budget', budget), ('Buyer', name), ('Email', email)])}
      </table>
      <p style='font-size:13px;color:#e5e5e5;margin-top:18px;line-height:1.6'>{description}</p>"""
    html = _shell("Custom Brief.", "A new custom order is ready for review.", body, "Maker / ops alert")
    return await _send(OPS_EMAIL, f"New custom brief · {project_type}", html)


async def send_buyer_custom_ack(buyer_email: str, name: str, project_type: str):
    body = f"<p style='font-size:13px;color:#a3a3a3;line-height:1.6'>Hi {name}, we received your <b style='color:#e5e5e5'>{project_type}</b> brief and a maker will review it within 24 hours. We'll send a free quote — no commitment.</p>"
    html = _shell("Brief Received.", "Thanks for the custom request.", body, "Custom queue")
    return await _send(buyer_email, "We got your custom brief", html)


async def send_maker_new_order(maker_email: str, maker_name: str,
                               items: list, subtotal: float,
                               buyer_email: str | None):
    if not maker_email:
        return None
    body = _items_table(items) if items else ""
    body += f"<div style='border-top:1px solid #262626;padding-top:14px;font-size:13px;color:#e5e5e5'>Subtotal for your shop: <b style='color:#ff4500'>${subtotal:.2f}</b></div>"
    if buyer_email:
        body += f"<p style='font-size:13px;color:#a3a3a3;margin-top:16px'>Buyer: <a href='mailto:{buyer_email}' style='color:#ff4500'>{buyer_email}</a></p>"
    body += "<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin-top:18px'>Reach out to the buyer with an ETA and tracking info as you build. Crafters Market handles the payout — you handle the craft.</p>"
    html = _shell(f"Order for {maker_name}.", "A new piece is on your bench.", body, "Maker order alert")
    return await _send(maker_email, f"New order · ${subtotal:.2f} · {maker_name}", html)


async def send_maker_low_stock(maker_email: str, maker_name: str,
                               items: list[dict]):
    """`items` is [{title, in_stock, slug}, ...] — already filtered to <3 stock."""
    if not maker_email or not items:
        return None
    rows = "".join(
        f"<tr><td style='padding:10px 0;border-bottom:1px solid #262626;color:#e5e5e5'>{i['title']}</td>"
        f"<td style='padding:10px 0;border-bottom:1px solid #262626;color:#ff4500;font-weight:bold;text-align:right'>{i['in_stock']} left</td></tr>"
        for i in items
    )
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Heads up {maker_name} — these listings just dropped below 3 in stock after a sale. "
        "Restock or update quantities so buyers don't miss out.</p>"
        f"<table style='width:100%;border-collapse:collapse;font-size:13px'>"
        "<thead><tr><th style='text-align:left;color:#a3a3a3;font-weight:normal;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;padding:0 0 10px;border-bottom:1px solid #262626'>Listing</th>"
        "<th style='text-align:right;color:#a3a3a3;font-weight:normal;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;padding:0 0 10px;border-bottom:1px solid #262626'>Stock</th></tr></thead>"
        f"<tbody>{rows}</tbody></table>"
    )
    html = _shell("Stock alert.", "Inventory's running thin.", body, "Maker · low stock")
    return await _send(maker_email, f"Low stock · {len(items)} listing{'s' if len(items) > 1 else ''} · {maker_name}", html)


async def send_maker_magic_link(maker_email: str, maker_name: str, link: str):
    if not maker_email:
        return None
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 24px'>Hi {maker_name}, "
        "click below to sign in to your maker portal. The link is good for 15 minutes and works once.</p>"
        f"<a href='{link}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:16px 28px;font-family:Impact,Arial Black,sans-serif;font-size:14px;letter-spacing:0.18em;"
        f"text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Open Maker Portal →</a>"
        "<p style='font-size:11px;color:#525252;letter-spacing:0.18em;text-transform:uppercase;"
        f"margin:28px 0 0'>Or paste this URL</p><p style='font-size:12px;color:#a3a3a3;word-break:break-all'>"
        f"<a href='{link}' style='color:#ff4500'>{link}</a></p>"
        "<p style='font-size:12px;color:#525252;margin-top:24px;line-height:1.6'>"
        "If you didn't request this, ignore the email — no action is needed.</p>"
    )
    html = _shell("Sign In Link.", "Your maker portal is one click away.", body, "Maker portal · sign in")
    return await _send(maker_email, "Your Crafters Market sign-in link", html)


async def send_admin_magic_link(admin_email: str, link: str):
    if not admin_email:
        return None
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 24px'>"
        "Click below to open the admin console. Good for 15 minutes, works once.</p>"
        f"<a href='{link}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:16px 28px;font-family:Impact,Arial Black,sans-serif;font-size:14px;letter-spacing:0.18em;"
        f"text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Open Admin Console →</a>"
        "<p style='font-size:11px;color:#525252;letter-spacing:0.18em;text-transform:uppercase;"
        f"margin:28px 0 0'>Or paste this URL</p><p style='font-size:12px;color:#a3a3a3;word-break:break-all'>"
        f"<a href='{link}' style='color:#ff4500'>{link}</a></p>"
        "<p style='font-size:12px;color:#525252;margin-top:24px;line-height:1.6'>"
        "If you didn't request this, ignore the email — no action is needed.</p>"
    )
    html = _shell("Admin Sign In.", "One-tap access to the operations console.", body, "Admin console")
    return await _send(admin_email, "Crafters Market admin sign-in link", html)


async def send_application_decision(applicant_email: str, name: str, studio: str,
                                    approved: bool, note: str = "",
                                    sign_in_link: str = ""):
    """Approval path emits a comprehensive welcome packet: sign-in link, first
    steps checklist, fee breakdown, support resources. Decline path stays
    short + kind."""
    title = "Welcome to the Workshop." if approved else "Application Update."
    intro = (
        f"Hi {name}, your studio {studio} is in. Here's everything you need to launch."
        if approved
        else f"Hi {name}, thanks for applying with {studio}. We're not moving forward right now."
    )
    if approved:
        site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
        link = sign_in_link or f"{site}/maker/login"
        body = (
            "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 24px'>"
            "Your application's been approved. You now have access to the maker portal — your "
            "shop, listings, payouts, and analytics all live there."
            "</p>"
            f"<a href='{link}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
            "padding:16px 28px;font-family:Impact,Arial Black,sans-serif;font-size:14px;letter-spacing:0.18em;"
            f"text-transform:uppercase;text-decoration:none;border:1px solid #ff4500;margin-bottom:8px'>"
            "Open Maker Portal →</a>"
            "<p style='font-size:11px;color:#525252;letter-spacing:0.18em;text-transform:uppercase;margin:8px 0 32px'>"
            "Sign in with your application email · magic-link delivered each time"
            "</p>"

            "<div style='border-top:1px solid #262626;padding-top:20px;margin:24px 0'>"
            "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.25em;"
            "text-transform:uppercase;color:#ff4500;margin:0 0 12px'>◆ Your launch checklist</div>"
            "<ol style='font-size:13px;color:#e5e5e5;line-height:1.8;padding-left:20px;margin:0'>"
            "<li><b>Connect Stripe</b> — Payouts tab → 5-min onboarding. Required before you can publish your first piece.</li>"
            "<li><b>Polish your profile</b> — Profile tab → portrait, location, bio, techniques. This is what buyers see first.</li>"
            "<li><b>Create your first 3 listings</b> — Listings tab → New Listing. Solid photos beat polished copy every time.</li>"
            "<li><b>Set up your shop</b> — pricing, dimensions, materials, optional 3D model. We auto-generate SEO meta tags.</li>"
            "</ol>"
            "</div>"

            "<div style='border-top:1px solid #262626;padding-top:20px;margin:24px 0'>"
            "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.25em;"
            "text-transform:uppercase;color:#a3a3a3;margin:0 0 12px'>How payments + fees work</div>"
            "<ul style='font-size:13px;color:#e5e5e5;line-height:1.8;padding-left:20px;margin:0'>"
            "<li><b>5% commission</b> + 3% payment processing per sale. (Crafters Plus drops commission to 4% — $12/mo.)</li>"
            "<li><b>10 free listings</b> for life · then $0.20 per publish or renewal · or buy a credit pack at 25–40% off cash rates.</li>"
            "<li><b>Listings auto-expire after 120 days</b> — one click to renew, your URL stays the same.</li>"
            "<li><b>Promote a listing for $5/week</b> to pin it to the top of search results.</li>"
            "<li><b>Payouts</b> route directly to your bank via Stripe Connect — no waiting on us to cut checks.</li>"
            "</ul>"
            "</div>"

            "<div style='border-top:1px solid #262626;padding-top:20px;margin:24px 0'>"
            "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.25em;"
            "text-transform:uppercase;color:#a3a3a3;margin:0 0 12px'>Resources + support</div>"
            "<ul style='font-size:13px;color:#e5e5e5;line-height:1.8;padding-left:20px;margin:0'>"
            f"<li><a href='{site}/policy' style='color:#ff4500'>Maker Terms + Seller Agreement</a> (you accepted these on application)</li>"
            f"<li><a href='{site}/community/forum' style='color:#ff4500'>Maker forum</a> — share what's working, ask questions</li>"
            "<li>Reply to this email anytime — it goes straight to the founding team</li>"
            "</ul>"
            "</div>"
        )
        if note:
            body += (
                f"<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin-top:24px;"
                f"border-left:2px solid #ff4500;padding-left:14px'>{note}</p>"
            )
    else:
        blurb = (
            "We saw something interesting but the fit isn't quite there today. "
            "We keep notes — feel free to reapply once your portfolio grows."
        )
        body = f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6'>{blurb}</p>"
        if note:
            body += (
                f"<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin-top:18px;"
                f"border-left:2px solid #ff4500;padding-left:14px'>{note}</p>"
            )
    html = _shell(title, intro, body, "Maker program")
    subject = (
        f"Welcome to Crafters Market, {studio} — your launch packet"
        if approved
        else f"Crafters Market application update — {studio}"
    )
    return await _send(applicant_email, subject, html)


async def send_custom_order_quote(buyer_email: str, name: str, project_type: str,
                                  quote: float, message: str = ""):
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px'>"
        f"Hi {name}, here's the quote for your <b style='color:#ff4500'>{project_type}</b> brief.</p>"
        "<div style='border-top:1px solid #262626;border-bottom:1px solid #262626;padding:18px 0;margin:18px 0'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:0.22em;"
        "text-transform:uppercase;color:#a3a3a3'>Estimated total</div>"
        f"<div style='font-family:Impact,sans-serif;font-size:44px;color:#ff4500;line-height:1;margin-top:8px'>${quote:.2f}</div>"
        "</div>"
    )
    if message:
        body += (
            f"<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin-top:8px'>{message}</p>"
        )
    body += (
        "<p style='font-size:12px;color:#525252;line-height:1.6;margin-top:18px'>"
        "Reply to this email to confirm or adjust the brief. We'll send a Stripe invoice once you're happy.</p>"
    )
    html = _shell("Your Quote.", "A maker just priced your brief.", body, "Custom queue")
    return await _send(buyer_email, f"Your Crafters Market quote · {project_type}", html)


async def send_maker_plus_roi_digest(
    maker_email: str, maker_name: str, gross_30d: float,
    commission_savings: float, net_benefit: float, upgrade_link: str,
):
    """Monthly upsell digest: shows what Plus would have saved this maker
    over the last 30 days. Only sent to free-tier makers above the threshold."""
    if not maker_email:
        return None
    pitch = (
        f"At ${gross_30d:.0f} sold this month, Crafters Plus would have netted you "
        f"<b style='color:#10b981'>+${net_benefit:.2f}</b> after the $12 subscription."
        if net_benefit >= 0
        else f"You're <b style='color:#ff4500'>${abs(net_benefit):.2f}</b> from break-even — "
             "one more big sale and Plus pays for itself."
    )
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hey {maker_name}, here's a free-tier reality check from the last 30 days on Crafters Market:"
        "</p>"
        "<table style='width:100%;border-collapse:collapse;margin:18px 0'>"
        "<tr>"
        "<td style='width:50%;padding:18px;border:1px solid #262626;text-align:center'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.22em;"
        "text-transform:uppercase;color:#a3a3a3'>You sold (30d)</div>"
        f"<div style='font-family:Impact,sans-serif;font-size:38px;color:#e5e5e5;line-height:1;margin-top:8px'>${gross_30d:.0f}</div>"
        "</td>"
        "<td style='width:50%;padding:18px;border:1px solid #262626;border-left:none;text-align:center'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.22em;"
        "text-transform:uppercase;color:#a3a3a3'>Left on the table</div>"
        f"<div style='font-family:Impact,sans-serif;font-size:38px;color:#ff4500;line-height:1;margin-top:8px'>${commission_savings:.2f}</div>"
        "</td>"
        "</tr>"
        "</table>"
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:18px 0'>{pitch}</p>"
        "<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin:0 0 24px'>"
        "Plus drops your commission from <b>5% → 4%</b>, gives you <b>15 free listings/month</b>, "
        "unlocks a <b>custom shop banner</b>, and adds advanced shop analytics. "
        "Cancel anytime, no contract."
        "</p>"
        f"<a href='{upgrade_link}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:16px 28px;font-family:Impact,Arial Black,sans-serif;font-size:14px;letter-spacing:0.18em;"
        f"text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Upgrade to Plus →</a>"
        "<p style='font-size:11px;color:#525252;line-height:1.6;margin-top:28px'>"
        "Numbers above are computed from your actual paid orders in the last 30 days. "
        "We send this digest once a month to free-tier makers who crossed our visibility threshold. "
        "Don't want them? <a href='" + upgrade_link.split('/maker')[0] +
        "/maker/dashboard?tab=billing' style='color:#a3a3a3'>Manage preferences</a>."
        "</p>"
    )
    html = _shell(
        "Plus would've paid off." if net_benefit >= 0 else "Plus is one sale away.",
        "Your monthly free-tier reality check.",
        body, "Crafters Plus · ROI digest",
    )
    subj = (
        f"You left ${commission_savings:.2f} on the table this month · {maker_name}"
        if net_benefit >= 0
        else f"You're ${abs(net_benefit):.2f} from Plus paying for itself · {maker_name}"
    )
    return await _send(maker_email, subj, html)



async def send_beta_feedback(name: str, email: str, message: str, page: str = ""):
    """Forward beta-mode feedback to the ops inbox so the team sees it instantly."""
    if not OPS_EMAIL:
        return
    safe_msg = (message or "").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
    body = f"""
      <table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;border-top:1px solid #262626'>
        {''.join(f"<tr><td style='padding:8px 0;color:#a3a3a3;font-size:11px;letter-spacing:0.22em;text-transform:uppercase'>{k}</td><td style='padding:8px 0;color:#e5e5e5;text-align:right'>{v}</td></tr>" for k, v in [('Name', name), ('Email', email), ('Page', page or '—')])}
      </table>
      <div style='font-size:13px;color:#e5e5e5;margin-top:18px;line-height:1.6;border-left:2px solid #ff4500;padding:6px 14px;background:#0d0d0d'>{safe_msg}</div>
      <p style='font-size:11px;color:#a3a3a3;margin-top:18px'>Reply directly to <a href='mailto:{email}' style='color:#ff4500'>{email}</a> — they'll get it.</p>
    """
    html = _shell(
        "Beta Feedback.",
        "Someone just dropped feedback while testing the beta build.",
        body,
        "Crafters Market · Beta channel",
    )
    return await _send(OPS_EMAIL, f"Beta feedback · {name}", html)
