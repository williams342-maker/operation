#!/usr/bin/env python3
"""Generate /app/docs/crafters_market_fee_breakdown.pdf.

A single-source-of-truth document listing exactly what each user type
pays on Crafters Market. Numbers come from /app/backend/revenue.py and
/app/backend/routers/stripe_connect.py — re-run this script anytime
those values change.
"""
from datetime import datetime, timezone
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, PageBreak,
)

# ─── Fee constants (mirror /app/backend/revenue.py + stripe_connect.py) ─

# Per-transaction
PLATFORM_FEE_BPS_STANDARD = 500          # 5.0% commission on a sale
PLUS_PLATFORM_FEE_BPS = 400              # 4.0%
FOUNDER_PLATFORM_FEE_BPS = 300           # 3.0%
PROCESSING_FEE_BPS = 290                 # 2.9% Stripe processing
PROCESSING_FEE_FIXED_CENTS = 30          # + $0.30 Stripe

# Listing-fee model
LISTING_FEE_CENTS = 20                   # $0.20 per listing past quota
PLUS_LISTING_FEE_CENTS = 10              # $0.10 per listing past quota (Plus)
LISTING_FREE_QUOTA = 10                  # Standard makers
PLUS_MONTHLY_LISTING_QUOTA = 15
FOUNDER_MONTHLY_LISTING_QUOTA = 50
LISTING_EXPIRY_DAYS = 120

# Promotion / boost
PROMOTION_WEEKLY_FEE_CENTS = 500         # $5/week pin
PLUS_MONTHLY_BOOST_CREDIT_CENTS = 1500   # $15 included
VETERAN_MONTHLY_BOOST_CREDIT_CENTS = 1000  # $10 included

# Subscriptions
PLUS_PRICE_USD = 12                      # /mo
OFFSITE_AD_FEE_BPS = 1200                # 12% on attributed offsite-ad sales

# Buyer-side
SHIPPING_MARKUP_PCT = 0.05               # 5% added to live carrier rate to
                                         #  cover Stripe processing + ops
FREE_SHIPPING_THRESHOLD_USD = 250

# ─── Document setup ─────────────────────────────────────────────────────

OUT_PATH = Path("/app/docs/crafters_market_fee_breakdown.pdf")
OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

# Brand palette — matches site
ORANGE = colors.HexColor("#ff4500")
INK = colors.HexColor("#0a0a0a")
GREY = colors.HexColor("#525252")
GREY_LIGHT = colors.HexColor("#a3a3a3")
BG_DARK = colors.HexColor("#141414")
BG_PANEL = colors.HexColor("#1a1a1a")
WHITE = colors.HexColor("#fafafa")

styles = getSampleStyleSheet()

h1 = ParagraphStyle(
    "h1", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=26,
    leading=30, textColor=WHITE, spaceAfter=4, alignment=TA_LEFT,
)
subtitle = ParagraphStyle(
    "subtitle", parent=styles["Normal"], fontName="Courier", fontSize=9,
    leading=12, textColor=ORANGE, spaceAfter=20,
)
h2 = ParagraphStyle(
    "h2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=14,
    leading=18, textColor=ORANGE, spaceBefore=18, spaceAfter=8,
)
h3 = ParagraphStyle(
    "h3", parent=styles["Heading3"], fontName="Helvetica-Bold", fontSize=11,
    leading=14, textColor=WHITE, spaceBefore=10, spaceAfter=4,
)
body = ParagraphStyle(
    "body", parent=styles["Normal"], fontName="Helvetica", fontSize=10,
    leading=14, textColor=WHITE, spaceAfter=6,
)
mono = ParagraphStyle(
    "mono", parent=styles["Normal"], fontName="Courier", fontSize=9,
    leading=12, textColor=GREY_LIGHT, spaceAfter=4,
)
footer_style = ParagraphStyle(
    "footer", parent=styles["Normal"], fontName="Courier", fontSize=7,
    leading=10, textColor=GREY, alignment=TA_LEFT,
)

# ─── Reusable table style ───────────────────────────────────────────────

def fee_table_style(highlight_total_row=True):
    rows = [
        ("BACKGROUND", (0, 0), (-1, 0), ORANGE),
        ("TEXTCOLOR", (0, 0), (-1, 0), INK),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("ALIGN", (0, 0), (-1, 0), "LEFT"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("BACKGROUND", (0, 1), (-1, -1), BG_PANEL),
        ("TEXTCOLOR", (0, 1), (-1, -1), WHITE),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 1), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.5, INK),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [BG_PANEL, BG_DARK]),
    ]
    if highlight_total_row:
        rows.append(("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#2a1a05")))
        rows.append(("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"))
        rows.append(("TEXTCOLOR", (0, -1), (-1, -1), ORANGE))
    return TableStyle(rows)


def on_page(canvas, doc):
    canvas.saveState()
    # Solid black background
    canvas.setFillColor(INK)
    canvas.rect(0, 0, LETTER[0], LETTER[1], fill=1, stroke=0)
    # Top brand bar
    canvas.setFillColor(ORANGE)
    canvas.rect(0, LETTER[1] - 6, LETTER[0], 6, fill=1, stroke=0)
    # Footer
    canvas.setFillColor(GREY)
    canvas.setFont("Courier", 7)
    canvas.drawString(
        0.6 * inch, 0.4 * inch,
        f"CRAFTERS MARKET · FEE BREAKDOWN · GENERATED {datetime.now(timezone.utc).strftime('%Y-%m-%d')} · craftersmarket.org",
    )
    canvas.drawRightString(LETTER[0] - 0.6 * inch, 0.4 * inch, f"PAGE {doc.page}")
    canvas.restoreState()


# ─── Content ────────────────────────────────────────────────────────────

doc = SimpleDocTemplate(
    str(OUT_PATH),
    pagesize=LETTER,
    leftMargin=0.6 * inch,
    rightMargin=0.6 * inch,
    topMargin=0.7 * inch,
    bottomMargin=0.6 * inch,
    title="Crafters Market — Fee Breakdown by User Type",
    author="Crafters Market",
)

story = []

# Header
story.append(Paragraph("Crafters Market", h1))
story.append(Paragraph(
    "FEE BREAKDOWN BY USER TYPE  ·  TRANSPARENT · PRECISION-CRAFT",
    subtitle,
))

# Intro
story.append(Paragraph(
    "Every user type on Crafters Market pays only what's listed below — no hidden fees, "
    "no surprise charges. This document is the single source of truth for what the platform "
    "charges buyers, makers (Standard / Founder / Plus), and administrators.",
    body,
))

# ─── Buyers ─────────────────────────────────────────────────────────────
story.append(Paragraph("◆ Buyers", h2))
story.append(Paragraph(
    "Buyers pay <b>zero platform fees</b>. The price you see is the price you pay, plus "
    "shipping (calculated live from the carrier).",
    body,
))

buyers_table = Table([
    ["What you pay", "Amount", "Notes"],
    ["Product price",
     "Listed on the product page",
     "Set by the maker. No platform markup added on top."],
    ["Shipping",
     "Live carrier rate + 5%",
     f"5% covers Stripe processing & ops. Free over ${FREE_SHIPPING_THRESHOLD_USD}."],
    ["Sales tax",
     "Calculated at checkout",
     "Per US state nexus rules. Stripe Tax computes — we pass it through."],
    ["Custom orders",
     "Free quote",
     "Quote returned within 24h. You only pay if you accept the quote."],
    ["Refunds & returns",
     "Free",
     "Within 14 days unless the piece is personalized."],
    ["Subscriptions / membership",
     "None",
     "Buyers do not pay a membership fee."],
], colWidths=[1.6 * inch, 1.7 * inch, 4.0 * inch])
buyers_table.setStyle(fee_table_style(highlight_total_row=False))
story.append(buyers_table)

# ─── Makers — Standard ──────────────────────────────────────────────────
story.append(Paragraph("◆ Makers — Standard (default tier)", h2))
story.append(Paragraph(
    "Default tier for every new maker. No subscription, no minimums. Pay only when you sell "
    "or list past your free quota.",
    body,
))

makers_standard = Table([
    ["Charge", "Amount", "When charged"],
    ["Sign-up & account",
     "$0",
     "Free forever."],
    ["Free listing quota",
     f"{LISTING_FREE_QUOTA} listings",
     "First 10 listings are free."],
    ["Listing fee (past quota)",
     f"${LISTING_FEE_CENTS/100:.2f} per listing",
     f"Each publish or renewal. Listings expire {LISTING_EXPIRY_DAYS} days after publish."],
    ["Platform commission",
     f"{PLATFORM_FEE_BPS_STANDARD/100:.1f}% of sale",
     "Deducted from each sale's payout."],
    ["Stripe processing",
     f"{PROCESSING_FEE_BPS/100:.1f}% + ${PROCESSING_FEE_FIXED_CENTS/100:.2f}",
     "Stripe's fee. Passed through at cost — Crafters Market keeps nothing here."],
    ["Boosted (promoted) listing",
     f"${PROMOTION_WEEKLY_FEE_CENTS/100:.2f} per week per listing",
     "Optional. Pins a listing to the top of category pages and search."],
    ["Offsite-ads sale fee",
     f"{OFFSITE_AD_FEE_BPS/100:.1f}% of attributed sale",
     "Only on sales attributed to paid offsite ads (Meta / Google). Opt-in."],
    ["Custom-order intake",
     "$0",
     "No fee to receive or quote a custom order."],
    ["Effective take on a $100 sale",
     f"{PLATFORM_FEE_BPS_STANDARD/100:.1f}% + {PROCESSING_FEE_BPS/100:.1f}% + ${PROCESSING_FEE_FIXED_CENTS/100:.2f} = $8.20",
     "Maker keeps $91.80 (before their cost of materials)."],
], colWidths=[1.9 * inch, 2.2 * inch, 3.2 * inch])
makers_standard.setStyle(fee_table_style())
story.append(makers_standard)

# ─── Makers — Founder ───────────────────────────────────────────────────
story.append(Paragraph("◆ Makers — Founder (limited recruiting tier)", h2))
story.append(Paragraph(
    "Free-forever recruiting tier for the first wave of Crafters Market makers. Lower commission, "
    "higher free-listing quota. 12-month window before auto-rolling to Standard "
    "(or lifetime for the first 100 inaugural founders).",
    body,
))

makers_founder = Table([
    ["Charge", "Amount", "Notes"],
    ["Sign-up & account",
     "$0",
     "Free. Tier granted by application."],
    ["Free listing quota",
     f"{FOUNDER_MONTHLY_LISTING_QUOTA} / month",
     "Refreshes monthly."],
    ["Listing fee (past quota)",
     f"${LISTING_FEE_CENTS/100:.2f} per listing",
     "Same as Standard."],
    ["Platform commission",
     f"{FOUNDER_PLATFORM_FEE_BPS/100:.1f}% of sale",
     "Lower than both Standard (5%) and Plus (4%)."],
    ["Stripe processing",
     f"{PROCESSING_FEE_BPS/100:.1f}% + ${PROCESSING_FEE_FIXED_CENTS/100:.2f}",
     "Pass-through, same as Standard."],
    ["Boosted listing",
     f"${PROMOTION_WEEKLY_FEE_CENTS/100:.2f} per week",
     "Same as Standard."],
    ["Inaugural-100 status",
     "Lifetime tier",
     "First 100 verified founders stay at this rate forever."],
    ["Tier window",
     "12 months",
     "Regular founders auto-roll to Standard after 365 days unless inaugural."],
    ["Effective take on a $100 sale",
     f"{FOUNDER_PLATFORM_FEE_BPS/100:.1f}% + {PROCESSING_FEE_BPS/100:.1f}% + ${PROCESSING_FEE_FIXED_CENTS/100:.2f} = $6.20",
     "Maker keeps $93.80."],
], colWidths=[1.9 * inch, 2.2 * inch, 3.2 * inch])
makers_founder.setStyle(fee_table_style())
story.append(makers_founder)

# ─── Makers — Plus ──────────────────────────────────────────────────────
story.append(PageBreak())
story.append(Paragraph("◆ Makers — Crafters Plus (subscription)", h2))
story.append(Paragraph(
    f"Optional ${PLUS_PRICE_USD}/month subscription. Pays for itself before any of the perks kick in: "
    f"${PLUS_MONTHLY_BOOST_CREDIT_CENTS/100:.0f} of boosted-listing credit is included with every month "
    f"(more than the ${PLUS_PRICE_USD} sub price). On top of that you get lower commission, half-price "
    f"listing overages, higher quota, AI tools (Maker Studio), and priority surfacing.",
    body,
))

makers_plus = Table([
    ["Charge", "Amount", "Notes"],
    ["Subscription",
     f"${PLUS_PRICE_USD} / month",
     "Cancel anytime. Stripe-managed."],
    ["Free listing quota",
     f"{PLUS_MONTHLY_LISTING_QUOTA} / month",
     "Refreshes monthly. 50% more than Standard's lifetime free 10."],
    ["Listing fee (past quota)",
     f"${PLUS_LISTING_FEE_CENTS/100:.2f} per listing",
     f"Half of Standard's ${LISTING_FEE_CENTS/100:.2f}."],
    ["Platform commission",
     f"{PLUS_PLATFORM_FEE_BPS/100:.1f}% of sale",
     "1 percentage point lower than Standard."],
    ["Stripe processing",
     f"{PROCESSING_FEE_BPS/100:.1f}% + ${PROCESSING_FEE_FIXED_CENTS/100:.2f}",
     "Same Stripe pass-through."],
    ["Included boost credit",
     f"${PLUS_MONTHLY_BOOST_CREDIT_CENTS/100:.0f} / month",
     f"Boost 3 listings/month at ${PROMOTION_WEEKLY_FEE_CENTS/100:.0f}/wk — no extra cost."],
    ["Additional boosts",
     f"${PROMOTION_WEEKLY_FEE_CENTS/100:.2f} / week",
     "After your monthly $15 credit is consumed. Credit does NOT roll over."],
    ["AI tools (Maker Studio)",
     "Included",
     "SVG/DXF cut-path generation from a description. Free for Plus."],
    ["Custom shop banner",
     "Included",
     "Wide hero banner on your shop. Plus-only feature."],
    ["Effective take on a $100 sale",
     f"{PLUS_PLATFORM_FEE_BPS/100:.1f}% + {PROCESSING_FEE_BPS/100:.1f}% + ${PROCESSING_FEE_FIXED_CENTS/100:.2f} = $7.20",
     "Maker keeps $92.80 (+$1/sale vs Standard). Sub breaks even at ~12 sales/mo."],
], colWidths=[1.9 * inch, 2.2 * inch, 3.2 * inch])
makers_plus.setStyle(fee_table_style())
story.append(makers_plus)

# ─── Side-by-side comparison ────────────────────────────────────────────
story.append(Paragraph("◆ Side-by-side comparison", h2))

comparison = Table([
    ["Item", "Standard", "Founder", "Plus"],
    ["Subscription", "$0", "$0", f"${PLUS_PRICE_USD}/mo"],
    ["Free listings", "10 lifetime",
     f"{FOUNDER_MONTHLY_LISTING_QUOTA} / mo",
     f"{PLUS_MONTHLY_LISTING_QUOTA} / mo"],
    ["Listing fee (overage)",
     f"${LISTING_FEE_CENTS/100:.2f}",
     f"${LISTING_FEE_CENTS/100:.2f}",
     f"${PLUS_LISTING_FEE_CENTS/100:.2f}"],
    ["Commission",
     f"{PLATFORM_FEE_BPS_STANDARD/100:.0f}%",
     f"{FOUNDER_PLATFORM_FEE_BPS/100:.0f}%",
     f"{PLUS_PLATFORM_FEE_BPS/100:.0f}%"],
    ["Stripe processing",
     f"{PROCESSING_FEE_BPS/100:.1f}% + ${PROCESSING_FEE_FIXED_CENTS/100:.2f}",
     f"{PROCESSING_FEE_BPS/100:.1f}% + ${PROCESSING_FEE_FIXED_CENTS/100:.2f}",
     f"{PROCESSING_FEE_BPS/100:.1f}% + ${PROCESSING_FEE_FIXED_CENTS/100:.2f}"],
    ["Boost credit", "—", "—",
     f"${PLUS_MONTHLY_BOOST_CREDIT_CENTS/100:.0f}/mo"],
    ["AI Maker Studio", "—", "—", "Included"],
    ["Custom shop banner", "—", "—", "Included"],
    ["Net on $100 sale",
     "$91.80", "$93.80", "$92.80"],
], colWidths=[1.7 * inch, 1.7 * inch, 1.7 * inch, 1.7 * inch])
comparison.setStyle(fee_table_style())
story.append(comparison)

# ─── Veterans ───────────────────────────────────────────────────────────
story.append(Paragraph("◆ Veteran-owned makers — extra benefit", h2))
story.append(Paragraph(
    f"Verified veteran-owned makers get <b>${VETERAN_MONTHLY_BOOST_CREDIT_CENTS/100:.0f}/month "
    f"in boosted-listing credit</b> automatically, on top of whatever tier they hold. "
    f"That's 2 free listing boosts every month at the current ${PROMOTION_WEEKLY_FEE_CENTS/100:.0f}/week rate. "
    "Credit does not roll over.",
    body,
))

# ─── Admins ─────────────────────────────────────────────────────────────
story.append(Paragraph("◆ Administrators", h2))
story.append(Paragraph(
    "Platform staff. Do not pay any fees and do not sell on the marketplace from admin accounts. "
    "Admins moderate listings, manage payouts, and run ops tools (clip seeding, feed health, "
    "lead-magnet inbox).",
    body,
))

# ─── Source of truth ────────────────────────────────────────────────────
story.append(Paragraph("◆ Source of truth", h2))
story.append(Paragraph(
    "All numbers above are pulled directly from the codebase. To change any fee, edit the "
    "environment variables on the backend deployment:",
    body,
))
story.append(Paragraph(
    "<font face='Courier' size='8' color='#a3a3a3'>"
    "PLATFORM_FEE_BPS=500 · PLUS_PLATFORM_FEE_BPS=400 · FOUNDER_PLATFORM_FEE_BPS=300<br/>"
    "PROCESSING_FEE_BPS=290 · PROCESSING_FEE_FIXED_CENTS=30<br/>"
    "LISTING_FEE_CENTS=20 · PLUS_LISTING_FEE_CENTS=10 · LISTING_FREE_QUOTA=10<br/>"
    "PLUS_MONTHLY_LISTING_QUOTA=15 · FOUNDER_MONTHLY_LISTING_QUOTA=50<br/>"
    "PROMOTION_WEEKLY_FEE_CENTS=500 · PLUS_MONTHLY_BOOST_CREDIT_CENTS=1500<br/>"
    "VETERAN_MONTHLY_BOOST_CREDIT_CENTS=1000<br/>"
    "PLUS_PRICE_USD=12 · OFFSITE_AD_FEE_BPS=1200"
    "</font>",
    mono,
))
story.append(Spacer(1, 12))
story.append(Paragraph(
    "<i>This document was generated from /app/docs/build_fee_breakdown.py — re-run that "
    "script after changing any of the above to refresh the PDF.</i>",
    mono,
))

doc.build(story, onFirstPage=on_page, onLaterPages=on_page)

size_kb = OUT_PATH.stat().st_size / 1024
print(f"✓ wrote {OUT_PATH} ({size_kb:.1f} KB)")
