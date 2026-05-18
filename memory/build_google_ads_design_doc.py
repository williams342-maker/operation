"""Generate the Google Ads API Design Documentation PDF
   for CraftersMarket's developer-token application."""
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, black
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT, TA_JUSTIFY

OUT = "/app/memory/CraftersMarket_GoogleAdsAPI_DesignDoc.pdf"

doc = SimpleDocTemplate(
    OUT,
    pagesize=LETTER,
    leftMargin=0.9 * inch,
    rightMargin=0.9 * inch,
    topMargin=0.9 * inch,
    bottomMargin=0.8 * inch,
    title="CraftersMarket — Google Ads API Design Documentation",
    author="CraftersMarket",
)

styles = getSampleStyleSheet()
NAVY = HexColor("#0B2545")
ACCENT = HexColor("#1B7F4E")
GREY = HexColor("#444444")

h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontName="Helvetica-Bold",
                   fontSize=20, textColor=NAVY, spaceAfter=10, leading=24)
h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontName="Helvetica-Bold",
                   fontSize=13, textColor=NAVY, spaceBefore=14, spaceAfter=6, leading=16)
h3 = ParagraphStyle("h3", parent=styles["Heading3"], fontName="Helvetica-Bold",
                   fontSize=11, textColor=ACCENT, spaceBefore=8, spaceAfter=3, leading=14)
body = ParagraphStyle("body", parent=styles["BodyText"], fontName="Helvetica",
                     fontSize=10.5, textColor=black, leading=15, alignment=TA_JUSTIFY,
                     spaceAfter=6)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=18, bulletIndent=6,
                       spaceAfter=3)
small = ParagraphStyle("small", parent=body, fontSize=9, textColor=GREY, leading=12)
code = ParagraphStyle("code", parent=body, fontName="Courier", fontSize=9,
                     leading=12, textColor=HexColor("#222"),
                     backColor=HexColor("#F4F6F8"),
                     borderPadding=6, leftIndent=8, rightIndent=8, spaceAfter=8)

story = []

# ----------------------------- COVER ----------------------------- #
story += [
    Paragraph("CraftersMarket", h1),
    Paragraph("Google Ads API — Design Documentation", h2),
    Spacer(1, 8),
    Paragraph(
        "<b>Applicant:</b> CraftersMarket LLC<br/>"
        "<b>Tool name:</b> CraftersMarket Maker Analytics<br/>"
        "<b>Tool URL:</b> https://craftersmarket.org<br/>"
        "<b>Contact email:</b> williams1cnc@gmail.com<br/>"
        "<b>Access tier requested:</b> Basic Access (read-only reporting)<br/>"
        "<b>Document version:</b> 1.0 — February 2026",
        body,
    ),
    Spacer(1, 14),
]

# ----------------------------- 1. OVERVIEW ----------------------------- #
story += [
    Paragraph("1. Tool Overview", h2),
    Paragraph(
        "CraftersMarket is an Etsy-style e-commerce marketplace serving CNC machinists "
        "and woodworking artisans. The platform allows independent makers to list "
        "physical products, accept payments through Stripe Connect, and ship orders "
        "directly to consumers in the United States and Canada.",
        body,
    ),
    Paragraph(
        "<b>CraftersMarket Maker Analytics</b> is the internal admin dashboard "
        "(located at <font face='Courier'>/admin/dashboard?tab=ads</font>) that the "
        "CraftersMarket marketing team uses to monitor the ROI of paid advertising "
        "campaigns run on Google Ads and Meta Ads. The Google Ads API integration "
        "powers a single feature: <b>read-only daily import of campaign performance "
        "metrics</b> (spend, impressions, clicks, conversions) into our internal "
        "ledger so the marketing team can correlate ad spend with marketplace orders.",
        body,
    ),
    Paragraph(
        "We are <b>not</b> an agency tool, ad-management product, third-party SaaS, "
        "or a reseller. The API is used exclusively against Google Ads accounts that "
        "CraftersMarket owns under its own Manager (MCC) account. No external user "
        "ever authenticates with the Google Ads API through our system.",
        body,
    ),
]

# ----------------------------- 2. USE CASE ----------------------------- #
story += [
    Paragraph("2. Use Case &amp; Business Justification", h2),
    Paragraph(
        "<b>Problem.</b> The CraftersMarket growth team runs Google Search and "
        "Performance Max campaigns to drive traffic to maker storefronts. "
        "Reconciling daily ad spend against marketplace conversions manually "
        "(via CSV export) is slow and error-prone.",
        body,
    ),
    Paragraph(
        "<b>Solution.</b> A nightly job pulls yesterday's campaign-level metrics "
        "from the Google Ads API and writes them into our internal "
        "<font face='Courier'>ad_spend</font> collection. The admin dashboard then "
        "joins that data with marketplace order data to compute true ROAS per "
        "campaign.",
        body,
    ),
    Paragraph(
        "<b>Scope of access.</b> Read-only. We do not create, modify, or pause "
        "campaigns. We do not bid, target, or generate ad copy. The integration "
        "only issues <font face='Courier'>SearchStream</font> queries against the "
        "<font face='Courier'>campaign</font> resource.",
        body,
    ),
]

# Stats table
data = [
    ["Metric", "Value"],
    ["Expected daily API operations", "~500 ops/day"],
    ["Peak daily operations (worst case)", "~2,000 ops/day"],
    ["Number of Google Ads accounts accessed", "1–3 (all owned by CraftersMarket)"],
    ["Number of external end-users authenticating", "0 (first-party use only)"],
    ["Authentication method", "OAuth 2.0 refresh-token (offline access)"],
    ["Services used", "GoogleAdsService.SearchStream, CustomerService.ListAccessibleCustomers"],
    ["Mutating calls (create/update/remove)", "None"],
]
tbl = Table(data, colWidths=[2.4 * inch, 3.7 * inch])
tbl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY),
    ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#FFFFFF")),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTSIZE", (0, 0), (-1, -1), 9.5),
    ("ALIGN", (0, 0), (-1, -1), "LEFT"),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#FFFFFF"), HexColor("#F4F6F8")]),
    ("BOX", (0, 0), (-1, -1), 0.5, GREY),
    ("INNERGRID", (0, 0), (-1, -1), 0.25, GREY),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story += [Spacer(1, 4), tbl, Spacer(1, 10)]

# ----------------------------- 3. ARCHITECTURE ----------------------------- #
story += [
    Paragraph("3. System Architecture", h2),
    Paragraph(
        "CraftersMarket runs a three-tier stack: a React 18 single-page frontend, "
        "a FastAPI (Python 3.11) backend, and a MongoDB Atlas datastore. The "
        "Google Ads integration lives entirely on the backend.",
        body,
    ),
    Paragraph("3.1 Component Diagram", h3),
    Paragraph(
        "<font face='Courier'>"
        "[Admin Browser] &nbsp;&nbsp;&rarr;&nbsp;&nbsp; [FastAPI Backend] &nbsp;&nbsp;&rarr;&nbsp;&nbsp; [Google Ads API]<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&darr;<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[MongoDB: ad_spend, integration_credentials]"
        "</font>",
        body,
    ),
    Paragraph("3.2 Modules involved", h3),
    Paragraph(
        "&bull; <b>routers/google_ads.py</b> &mdash; OAuth start/callback, connection-status, "
        "and ad-hoc sync endpoints. All routes are admin-only and require a valid "
        "admin JWT.<br/>"
        "&bull; <b>scheduler.py</b> &mdash; APScheduler job that fires at 03:30 UTC daily "
        "and calls the sync function for the previous calendar day.<br/>"
        "&bull; <b>routers/ad_spend.py</b> &mdash; Platform-agnostic ledger that the "
        "admin Ads tab reads from. Google rows are upserted into this collection.",
        body,
    ),
    Paragraph("3.3 Data flow", h3),
    Paragraph(
        "1. Admin clicks <i>Connect Google Ads</i> in the admin dashboard.<br/>"
        "2. Backend issues an OAuth authorization URL with a CSRF state token "
        "and the <font face='Courier'>https://www.googleapis.com/auth/adwords</font> scope.<br/>"
        "3. Admin consents in Google's UI; Google redirects back to "
        "<font face='Courier'>/api/admin/integrations/google-ads/oauth/callback</font>.<br/>"
        "4. Backend exchanges the authorization code for a refresh token and stores "
        "it (encrypted at rest) in MongoDB's <font face='Courier'>integration_credentials</font> "
        "collection keyed by <font face='Courier'>_id=&quot;google_ads&quot;</font>.<br/>"
        "5. The nightly scheduler reads the refresh token, instantiates the official "
        "<font face='Courier'>google-ads</font> Python SDK, runs a single GAQL query, "
        "and upserts the rows into <font face='Courier'>ad_spend</font>.<br/>"
        "6. The existing admin Ads tab UI renders the new data — no per-platform "
        "rendering logic is needed in the frontend.",
        body,
    ),
]

# ----------------------------- 4. GAQL QUERY ----------------------------- #
story += [
    Paragraph("4. GAQL Query Used (Read-Only)", h2),
    Paragraph(
        "Exactly one query shape is issued. It is parameterized only by the "
        "reporting date.",
        body,
    ),
    Paragraph(
        "<font face='Courier'>"
        "SELECT<br/>"
        "&nbsp;&nbsp;campaign.id,<br/>"
        "&nbsp;&nbsp;campaign.name,<br/>"
        "&nbsp;&nbsp;campaign.status,<br/>"
        "&nbsp;&nbsp;metrics.cost_micros,<br/>"
        "&nbsp;&nbsp;metrics.impressions,<br/>"
        "&nbsp;&nbsp;metrics.clicks,<br/>"
        "&nbsp;&nbsp;metrics.conversions,<br/>"
        "&nbsp;&nbsp;segments.date<br/>"
        "FROM campaign<br/>"
        "WHERE segments.date = '{YYYY-MM-DD}'"
        "</font>",
        code,
    ),
    Paragraph(
        "No <font face='Courier'>MutateOperations</font> are constructed. No "
        "<font face='Courier'>Service.Mutate*</font> methods are imported. The "
        "integration is provably read-only at the static-analysis level.",
        body,
    ),
]

# ----------------------------- 5. AUTH ----------------------------- #
story += [
    Paragraph("5. Authentication &amp; Authorization", h2),
    Paragraph("5.1 OAuth client", h3),
    Paragraph(
        "A single OAuth 2.0 <b>Web Application</b> client is configured in our "
        "Google Cloud Console project. The OAuth consent screen lists the "
        "<font face='Courier'>auth/adwords</font> scope only, no other Google "
        "scopes are requested.",
        body,
    ),
    Paragraph("5.2 Token storage", h3),
    Paragraph(
        "Refresh tokens are stored in MongoDB, encrypted at rest by MongoDB Atlas "
        "(KMS-backed AES-256). The application reads tokens only via a server-side "
        "service account; tokens never leave the backend tier and never appear in "
        "any HTTP response body, log line, or client-visible payload.",
        body,
    ),
    Paragraph("5.3 Access control", h3),
    Paragraph(
        "All Google Ads endpoints sit behind the <font face='Courier'>current_admin</font> "
        "FastAPI dependency, which validates an admin-role JWT issued by our "
        "first-party auth system. No other roles (maker, buyer, anonymous) can "
        "reach these endpoints.",
        body,
    ),
]

# ----------------------------- 6. POLICY COMPLIANCE ----------------------------- #
story += [
    Paragraph("6. Policy Compliance", h2),
    Paragraph(
        "&bull; <b>Google API Services User Data Policy.</b> CraftersMarket "
        "uses Google Ads data exclusively for the internal-analytics purpose "
        "stated above. We do not sell, transfer, or share Google Ads data with "
        "any third party. The data is not used for advertising targeting outside "
        "Google Ads.<br/>"
        "&bull; <b>Required Minimum Functionality.</b> The dashboard provides "
        "meaningful, non-trivial reporting value to the marketing team beyond "
        "what the native Google Ads UI offers, because it joins ad data with "
        "marketplace order data we own.<br/>"
        "&bull; <b>Limited Use.</b> Data is retained for 24 months for "
        "year-over-year reporting then purged by a scheduled cleanup job.<br/>"
        "&bull; <b>Security.</b> All API traffic is HTTPS. Secrets live in "
        "environment variables managed by Emergent's hosted secrets vault, never "
        "in source control.<br/>"
        "&bull; <b>Privacy Policy.</b> Our public privacy policy at "
        "https://craftersmarket.org/privacy discloses the Google Ads API "
        "integration and references the Google API Services User Data Policy.",
        body,
    ),
]

# ----------------------------- 7. SCREENSHOTS / UI ----------------------------- #
story += [
    Paragraph("7. UI Surfaces That Consume This Data", h2),
    Paragraph(
        "All Google Ads data is rendered in a single internal admin view:",
        body,
    ),
    Paragraph(
        "&bull; <b>Admin → Dashboard → Ads tab</b> "
        "(<font face='Courier'>https://craftersmarket.org/admin/dashboard?tab=ads</font>). "
        "This tab shows: daily/weekly/monthly spend totals, cost-per-acquisition, "
        "campaign-level breakdown, ROAS vs marketplace orders, and a "
        "<i>Connect / Reconnect</i> button card that exposes the OAuth flow.",
        body,
    ),
    Paragraph(
        "No Google Ads data is ever shown to makers, buyers, or anonymous "
        "visitors. There is no public-facing surface that consumes this API.",
        body,
    ),
]

# ----------------------------- 8. RATE & ERROR HANDLING ----------------------------- #
story += [
    Paragraph("8. Rate Limiting &amp; Error Handling", h2),
    Paragraph(
        "&bull; Sync runs once per day per linked customer; we are nowhere near "
        "the 15,000 ops/day Basic-tier cap.<br/>"
        "&bull; The SDK call runs inside a thread pool with a 60-second timeout. "
        "On <font face='Courier'>GoogleAdsException</font> we log the request_id "
        "and error code, surface a 'needs reconnect' state in the admin UI for "
        "auth errors, and retry transient errors with exponential backoff "
        "(max 3 attempts).<br/>"
        "&bull; Quota-exceeded responses pause the scheduler and email the admin "
        "team via Mailgun.",
        body,
    ),
]

# ----------------------------- 9. CONTACT ----------------------------- #
story += [
    Paragraph("9. Contact &amp; Maintenance", h2),
    Paragraph(
        "<b>Primary technical contact:</b> williams1cnc@gmail.com<br/>"
        "<b>Response SLA to Google review emails:</b> &lt; 24 hours, "
        "monitored 7 days a week.<br/>"
        "<b>Source code location:</b> Private repository, "
        "<font face='Courier'>backend/routers/google_ads.py</font>. "
        "Module docstring serves as the canonical operational runbook and is "
        "kept in sync with this document.",
        body,
    ),
    Spacer(1, 14),
    Paragraph(
        "— End of document —",
        small,
    ),
]

doc.build(story)
print(f"Generated: {OUT}")
