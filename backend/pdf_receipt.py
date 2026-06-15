"""Branded PDF order receipt — iter413aj.

Generates a Crafters-Market-branded PDF receipt from a paid Stripe
checkout session. Customers download this from the order confirmation
page (and a future "My orders" surface) as a more premium alternative
to Stripe's generic blue-Stripe-branded hosted_invoice_url.

Brand alignment:
  • Aged Canvas palette — cream paper bg (#f4ede3), ink (#1c160f),
    brand orange (#a85f2b)
  • CM-anvil monogram embedded from /app/frontend/public/icons/
  • "Built on craft · Driven by makers" tagline footer
  • Same Anton/Impact display font style for the wordmark

reportlab is already in requirements.txt (v4.5.1). We build the page
imperatively rather than using flowables/Platypus because the layout
is fixed (single-page receipt, never multi-page) — a Canvas gives us
exact control over typography + spacing.
"""
from __future__ import annotations

import io
import os
from datetime import datetime, timezone
from typing import Optional

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as rl_canvas

# Aged Canvas palette — kept in sync with tailwind.config.js / index.css
PAPER = (244 / 255, 237 / 255, 227 / 255)       # #f4ede3
INK = (28 / 255, 22 / 255, 15 / 255)            # #1c160f
INK_MUTED = (107 / 255, 98 / 255, 83 / 255)     # #6b6253
BRAND = (168 / 255, 95 / 255, 43 / 255)         # #a85f2b
LINE = (208 / 255, 197 / 255, 178 / 255)        # #d0c5b2

MONOGRAM_PATH = "/app/frontend/public/icons/logo-monogram-transparent.png"


def _fmt_money(cents_or_dollars: float, currency: str = "USD") -> str:
    """Accept either cents (int >= 1000 typically) or dollars (float).
    Stripe stores amount_total as cents, but our `payment_transactions`
    table stores `amount` in dollars. Caller passes whichever — we
    auto-detect: integer >= 100 with no decimal → cents.

    Actually too risky. We require the caller to pass dollars (float).
    """
    sym = "$" if currency.upper() == "USD" else f"{currency.upper()} "
    return f"{sym}{float(cents_or_dollars):,.2f}"


def _draw_header(c: rl_canvas.Canvas, width: float, height: float) -> float:
    """Draw the branded header band. Returns the Y coordinate where
    the next section should start drawing."""
    # Paper-cream backdrop for the entire page
    c.setFillColorRGB(*PAPER)
    c.rect(0, 0, width, height, fill=1, stroke=0)

    # Monogram top-left
    margin = 0.6 * 72  # 0.6"
    monogram_h = 48  # pt
    monogram_w = 64
    try:
        img = ImageReader(MONOGRAM_PATH)
        c.drawImage(
            img,
            margin,
            height - margin - monogram_h,
            width=monogram_w,
            height=monogram_h,
            preserveAspectRatio=True,
            mask="auto",
        )
    except Exception:
        # If the asset can't be read for any reason, render a CM textual
        # fallback box so the receipt still ships.
        c.setStrokeColorRGB(*BRAND)
        c.setLineWidth(1.5)
        c.rect(margin, height - margin - monogram_h, monogram_w, monogram_h, stroke=1, fill=0)
        c.setFillColorRGB(*BRAND)
        c.setFont("Helvetica-Bold", 22)
        c.drawCentredString(margin + monogram_w / 2, height - margin - monogram_h + 14, "CM")

    # Wordmark + EST line to the right of the monogram
    text_x = margin + monogram_w + 14
    c.setFillColorRGB(*BRAND)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(text_x, height - margin - 14, "\u25c6  CRAFTERS MARKET")
    c.setFillColorRGB(*INK_MUTED)
    c.setFont("Helvetica", 8)
    c.drawString(text_x, height - margin - 28, "EST  ·  2026")

    # "RECEIPT" mark on the right edge
    c.setFillColorRGB(*INK)
    c.setFont("Helvetica-Bold", 9)
    receipt_label = "ORDER RECEIPT"
    label_w = c.stringWidth(receipt_label, "Helvetica-Bold", 9)
    c.drawString(width - margin - label_w, height - margin - 14, receipt_label)

    # Horizontal divider
    sep_y = height - margin - monogram_h - 16
    c.setStrokeColorRGB(*LINE)
    c.setLineWidth(0.8)
    c.line(margin, sep_y, width - margin, sep_y)

    return sep_y - 24


def _draw_footer(c: rl_canvas.Canvas, width: float) -> None:
    """Brand tagline footer: matches the site footer + email template."""
    margin = 0.6 * 72
    # Divider line
    c.setStrokeColorRGB(*LINE)
    c.setLineWidth(0.8)
    c.line(margin, 0.7 * 72, width - margin, 0.7 * 72)
    # Brand tagline
    c.setFillColorRGB(*BRAND)
    c.setFont("Helvetica-Bold", 8)
    tagline = "BUILT ON CRAFT  ·  DRIVEN BY MAKERS"
    tw = c.stringWidth(tagline, "Helvetica-Bold", 8)
    c.drawString((width - tw) / 2, 0.5 * 72, tagline)
    # Site URL
    c.setFillColorRGB(*INK_MUTED)
    c.setFont("Helvetica", 7)
    site = "craftersmarket.org  ·  team@craftersmarket.org"
    sw = c.stringWidth(site, "Helvetica", 7)
    c.drawString((width - sw) / 2, 0.32 * 72, site)


def render_receipt_pdf(
    *,
    session_id: str,
    amount_dollars: float,
    subtotal: Optional[float],
    shipping_cost: Optional[float],
    discount_amount: Optional[float],
    currency: str,
    customer_email: Optional[str],
    items: list[dict],
    shipping_details: Optional[dict],
    gift_note: Optional[str],
    created_at: Optional[str],
) -> bytes:
    """Render a single-page branded PDF receipt and return the raw bytes.

    `items` is a list of `{title, quantity, unit_price, line_total,
    maker_name?, variant_label?, customization?}` dicts — caller is
    responsible for resolving product titles + variant labels from
    the raw `payment_transactions.items` payload (which only has IDs).
    """
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=LETTER)
    width, height = LETTER
    margin = 0.6 * 72

    y = _draw_header(c, width, height)

    # ── Order metadata block ──────────────────────────────────────────
    order_number = f"CM-{session_id[-10:].upper()}"
    iso = created_at or datetime.now(timezone.utc).isoformat()
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        date_str = dt.strftime("%B %d, %Y  ·  %H:%M UTC")
    except Exception:
        date_str = iso

    # Left column: Order # + date
    c.setFillColorRGB(*INK_MUTED)
    c.setFont("Helvetica", 7)
    c.drawString(margin, y, "ORDER  ·  RECEIPT")
    c.setFillColorRGB(*INK)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin, y - 18, order_number)
    c.setFillColorRGB(*INK_MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(margin, y - 32, date_str)

    # Right column: customer email
    if customer_email:
        c.setFillColorRGB(*INK_MUTED)
        c.setFont("Helvetica", 7)
        label = "BILLED TO"
        c.drawRightString(width - margin, y, label)
        c.setFillColorRGB(*INK)
        c.setFont("Helvetica", 9)
        c.drawRightString(width - margin, y - 18, customer_email)

    y -= 60

    # ── Ship-to (optional, physical orders only) ──────────────────────
    if shipping_details and any(shipping_details.get(k) for k in ("address_line1", "name")):
        c.setFillColorRGB(*INK_MUTED)
        c.setFont("Helvetica", 7)
        c.drawString(margin, y, "SHIP  ·  TO")
        y -= 14
        c.setFillColorRGB(*INK)
        c.setFont("Helvetica", 9)
        lines = []
        if shipping_details.get("name"):
            lines.append(shipping_details["name"])
        if shipping_details.get("address_line1"):
            lines.append(shipping_details["address_line1"])
        if shipping_details.get("address_line2"):
            lines.append(shipping_details["address_line2"])
        city_line_parts = [
            shipping_details.get("city") or "",
            shipping_details.get("state") or "",
            shipping_details.get("postal_code") or "",
        ]
        city_line = ", ".join(p for p in city_line_parts[:2] if p)
        if city_line_parts[2]:
            city_line = f"{city_line}  {city_line_parts[2]}".strip()
        if city_line:
            lines.append(city_line)
        if shipping_details.get("country"):
            lines.append(shipping_details["country"])
        for line in lines:
            c.drawString(margin, y, line)
            y -= 12
        y -= 12

    # ── Line items table ──────────────────────────────────────────────
    c.setFillColorRGB(*INK_MUTED)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(margin, y, "ITEM")
    c.drawString(width - margin - 200, y, "QTY")
    c.drawString(width - margin - 130, y, "UNIT")
    c.drawRightString(width - margin, y, "TOTAL")
    y -= 6
    c.setStrokeColorRGB(*LINE)
    c.setLineWidth(0.5)
    c.line(margin, y, width - margin, y)
    y -= 14

    c.setFillColorRGB(*INK)
    c.setFont("Helvetica", 10)
    for item in items:
        title = (item.get("title") or "Item").strip()
        qty = int(item.get("quantity") or 1)
        unit = float(item.get("unit_price") or 0)
        line_total = float(item.get("line_total") or unit * qty)
        # Truncate title to fit
        if len(title) > 52:
            title = title[:49] + "..."
        c.setFillColorRGB(*INK)
        c.setFont("Helvetica", 10)
        c.drawString(margin, y, title)
        c.setFillColorRGB(*INK_MUTED)
        c.setFont("Helvetica", 9)
        c.drawString(width - margin - 200, y, str(qty))
        c.drawString(width - margin - 130, y, _fmt_money(unit, currency))
        c.setFillColorRGB(*INK)
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(width - margin, y, _fmt_money(line_total, currency))
        y -= 14
        # Variant / customization sub-line
        sub_parts = []
        if item.get("variant_label"):
            sub_parts.append(item["variant_label"])
        if item.get("customization"):
            sub_parts.append(item["customization"])
        if item.get("maker_name"):
            sub_parts.append(f"by {item['maker_name']}")
        if sub_parts:
            c.setFillColorRGB(*INK_MUTED)
            c.setFont("Helvetica-Oblique", 8)
            c.drawString(margin + 8, y, "  ·  ".join(sub_parts))
            y -= 12
        y -= 4

    # ── Totals block (right-aligned) ──────────────────────────────────
    y -= 8
    c.setStrokeColorRGB(*LINE)
    c.line(margin, y, width - margin, y)
    y -= 18

    def _total_row(label: str, value: float, bold: bool = False, bigger: bool = False):
        nonlocal y
        c.setFillColorRGB(*INK_MUTED if not bold else INK)
        c.setFont("Helvetica" if not bold else "Helvetica-Bold", 9 if not bigger else 12)
        c.drawString(width - margin - 160, y, label)
        c.setFillColorRGB(*INK if not bold else BRAND)
        c.setFont("Helvetica" if not bold else "Helvetica-Bold", 10 if not bigger else 14)
        c.drawRightString(width - margin, y, _fmt_money(value, currency))
        y -= 16 if not bigger else 22

    if subtotal is not None:
        _total_row("Subtotal", subtotal)
    if shipping_cost is not None and shipping_cost >= 0:
        _total_row("Shipping", shipping_cost)
    if discount_amount and discount_amount > 0:
        _total_row("Discount", -float(discount_amount))
    _total_row("Total", amount_dollars, bold=True, bigger=True)

    # ── Gift note (optional) ──────────────────────────────────────────
    if gift_note:
        y -= 12
        c.setFillColorRGB(*INK_MUTED)
        c.setFont("Helvetica-Bold", 7)
        c.drawString(margin, y, "GIFT  ·  NOTE")
        y -= 14
        c.setFillColorRGB(*INK)
        c.setFont("Helvetica-Oblique", 9)
        # Wrap gift note across multiple lines if needed
        note = gift_note.strip()
        max_chars = 90
        while note:
            chunk = note[:max_chars]
            if len(note) > max_chars and " " in chunk:
                # break at last space for cleaner wrap
                cut = chunk.rfind(" ")
                chunk = note[:cut]
                note = note[cut:].lstrip()
            else:
                note = note[max_chars:]
            c.drawString(margin, y, f"“{chunk}”" if not note else chunk)
            y -= 12

    # Thank-you sign-off above footer
    c.setFillColorRGB(*INK_MUTED)
    c.setFont("Helvetica-Oblique", 9)
    c.drawCentredString(width / 2, 1.0 * 72, "Thank you for supporting independent US makers.")

    _draw_footer(c, width)

    c.showPage()
    c.save()
    return buf.getvalue()
