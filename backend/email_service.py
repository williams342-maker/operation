"""Resend transactional email helpers for Crafters Market."""
import os
import asyncio
import logging
import resend
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

logger = logging.getLogger("crafters.email")
logger.setLevel(logging.INFO)
if not logger.handlers:
    h = logging.StreamHandler()
    h.setFormatter(logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))
    logger.addHandler(h)
logger.propagate = True

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
OPS_EMAIL = os.environ.get("OPS_EMAIL", "")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


async def _send(to: str, subject: str, html: str):
    if not RESEND_API_KEY or not to:
        logger.warning("email skipped (no key or recipient): %s", subject)
        return None
    try:
        params = {"from": f"Crafters Market <{SENDER_EMAIL}>",
                  "to": [to], "subject": subject, "html": html}
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("email sent → %s · id=%s", to, getattr(result, "get", lambda *_: None)("id"))
        return result
    except Exception as e:
        logger.exception("email failed → %s: %s", to, e)
        return None


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
