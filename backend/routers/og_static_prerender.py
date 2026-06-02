"""iter318b — Prerender HTML for static + SEO-landing routes.

The existing `og_prerender.py` handles dynamic per-slug routes
(`/shop/{slug}`, `/makers/{slug}`, `/journal/{slug}`). This module
adds the static / index / SEO-landing routes that crawlers also hit
heavily but were previously getting the SPA shell:

    /api/og/home              → "/"
    /api/og/custom-order      → "/custom-order"
    /api/og/apply             → "/apply"
    /api/og/journal           → "/journal"  (index, not :slug)
    /api/og/policy            → "/policy"
    /api/og/landing/{slug}    → "/{slug}"   (one of SEO_LANDING_SLUGS)

The Cloudflare Worker (iter298) will route the bot traffic to these
endpoints. Real browsers continue to hit the SPA shell — but if a
crawler bypasses the Worker for some reason, the meta-refresh in
`_render_og_html` still bounces a real human to the SPA.

Every route emits:
  • unique <title>, meta description, canonical link
  • H1 + descriptive body content (≥150 words, internal links)
  • Schema.org JSON-LD appropriate to the page type
  • OG + Twitter Card tags for social unfurls
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from core import db
from routers.og_prerender import _esc, _site, _placeholder_image, _render_og_html
from routers.seo import SEO_LANDING_SLUGS

router = APIRouter()
log = logging.getLogger("crafters.og.static")


# ────────────────────────────────────────────────────────────────────
# SEO landing-page content map.
# Each entry mirrors the customer-facing copy in
# `/app/frontend/src/pages/seoLandingConfig.js` but only the bits a
# crawler needs (title, description, H1, intro paragraphs). Don't
# duplicate filter/CTA logic — that runs client-side in the SPA.
# ────────────────────────────────────────────────────────────────────

# title / desc are hand-tuned to match the H1 verbatim where Google
# expects keyword consistency. Each `paragraphs` value is fed verbatim
# into the prerender HTML body so the page has ≥150 words of unique
# content (Google's "thin content" floor).
_LANDING_CONTENT: dict[str, dict[str, object]] = {
    "cnc-metal-art": {
        "h1": "CNC Metal Art, Built by Hand.",
        "title": "CNC Metal Art — Plasma + Laser Cut by US Makers | Crafters Market",
        "desc": "Shop original CNC metal art from vetted US makers — plasma-cut, laser-cut, hand-finished steel, aluminum, and copper pieces. Made-to-order, ships nationwide.",
        "paragraphs": [
            "From rustic ranch signs to precision-cut compass roses, CNC metal art on Crafters Market is built one piece at a time. Each maker runs their own shop, programs their own cuts, and finishes every edge by hand — the difference shows up in texture, weight, and patina.",
            "Filter by technique (plasma, laser, router), by category (wall art, custom signs, garden art, business signage), or just scroll the curated grid. Every order pays the maker directly through Stripe Connect — no middleman, no anonymous factories.",
        ],
    },
    "cnc-laser-art": {
        "h1": "CNC Laser Art & Engraved Originals.",
        "title": "CNC Laser Art — Engraved Wood, Acrylic, and Metal | Crafters Market",
        "desc": "Precision laser-cut and laser-engraved wood, acrylic, and metal art from independent US makers. Custom monograms, photo-engraved keepsakes, wedding signs.",
        "paragraphs": [
            "Laser tooling pulls off details handheld tools can't — micro-engraved family photos in maple, lace-cut acrylic edge-lit lamps, intricate mandala wall panels. Crafters Market makers run vetted fiber and CO2 systems with the operator notes that separate good work from great.",
            "Looking to commission something one-off? Submit a custom-order brief and we'll route it to a laser-equipped artisan who can quote your file, your timeline, and your size — usually inside 24 hours.",
        ],
    },
    "cnc-manufacturing": {
        "h1": "CNC Manufacturing — One Piece at a Time.",
        "title": "Small-Batch CNC Manufacturing in the USA | Crafters Market",
        "desc": "Small-batch CNC manufacturing in the USA — connect with vetted plasma, laser, router, and forge shops. Submit a brief, get a quote, ship direct from the maker.",
        "paragraphs": [
            "Unlike industrial CNC shops chasing volume contracts, our makers specialize in run-of-one and small-batch precision — perfect for custom signs, branded gifts, architectural details, restoration parts, and commissioned art. You talk directly to the operator, not a sales department.",
            "Every approved maker submits real shop photos, machine specs, and past-work samples before they're listed. You see what they've built before you commit, and Stripe-secured payments only release when your piece ships.",
        ],
    },
    "cnc-usa": {
        "h1": "CNC USA — Built in American Shops.",
        "title": "CNC USA — American CNC Makers & Shops | Crafters Market",
        "desc": "Every CNC piece on Crafters Market is cut, finished, and shipped from an American shop. No drop-shipping, no overseas factories — just vetted independent US makers.",
        "paragraphs": [
            "We verify every applicant's workshop before they list. Real machines, real address, real past work — that's the floor. The result is a marketplace where 'Made in USA' is the default, not a premium tier.",
            "Many of our makers are veteran-owned, family-run, or solo-operator shops. Supporting them keeps precision craft skills alive in towns the big retailers ignore — and gives you a piece with a story you can actually trace.",
        ],
    },
    "artisan-marketplace": {
        "h1": "An Artisan Marketplace, Curated by Makers.",
        "title": "Artisan Marketplace — Vetted US Makers & Precision Craft | Crafters Market",
        "desc": "Crafters Market is the artisan marketplace built for precision craft — CNC metal art, laser-cut originals, wood signs, plasma-cut sculptures, custom commissions.",
        "paragraphs": [
            "Unlike sprawling craft sites where mass-produced imports drown out real makers, every listing here is hand-built by a vetted artisan in their own workshop. We screen every applicant, verify every shop, and let the makers' own work do the talking.",
            "Browse by category, technique, or maker. Read each shop's story before you buy. Track production from your dashboard. Pay the maker direct through Stripe Connect with no marketplace middleman skimming the proceeds.",
        ],
    },
    "custom-handmade-goods": {
        "h1": "Custom Handmade Goods, Built to Order.",
        "title": "Custom Handmade Goods — Made-to-Order by US Artisans | Crafters Market",
        "desc": "Order custom handmade goods direct from the artisan: monogrammed wall art, engraved cutting boards, plasma-cut address signs, wedding gifts, custom commissions.",
        "paragraphs": [
            "Submit a brief with your idea, your material preference, and your timeline. We'll route it to the right maker on the platform — usually within 24 hours. You'll get a quote, a turnaround estimate, and direct messaging with the artisan who'll build your piece.",
            "Need it in time for a specific event? Filter makers by processing time and rush-order availability. Want work-in-progress photos? Just ask the maker — most are happy to share.",
        ],
    },
    "custom-metal-signs": {
        "h1": "Custom Metal Signs — Plasma + Laser Cut to Order.",
        "title": "Custom Metal Signs — Plasma Cut by US Makers | Crafters Market",
        "desc": "Custom metal signs — plasma-cut and laser-cut steel, aluminum, and copper signage. Address plaques, family-name signs, business signs, monograms. Made to order.",
        "paragraphs": [
            "From address plaques to last-name family signs to garage logos and ranch entry markers, our makers cut, finish, and ship custom metal signage to spec. Choose your size, your steel gauge, your finish (raw, brushed, powder-coat, patina), and your mounting hardware. Every piece is one-off — never warehoused.",
            "Need an exact dimension to match an existing space? Send a brief and the maker quotes back inside 24 hours. Stainless mounting hardware on outdoor pieces, 16-gauge minimum on bigger panels, sealed substrates that won't warp through a Midwest winter.",
        ],
    },
    "personalized-gifts": {
        "h1": "Personalized Gifts, Hand-Made for Real People.",
        "title": "Personalized Gifts — Engraved & Custom by US Makers | Crafters Market",
        "desc": "Personalized gifts hand-made by US artisans: engraved cutting boards, monogrammed wall art, custom signs, photo-engraved keepsakes. No factory-printed mugs.",
        "paragraphs": [
            "Skip the printed-mug factories. Our makers engrave hardwood cutting boards, cut monogrammed steel wall art, hand-burn portrait plaques, and machine custom keepsakes that get pulled out and passed around years later — not stuffed in a drawer.",
            "Order timing matters? Filter by 'ships in 1 week' or 'ships in 2 weeks', or commission a one-off with a guaranteed deadline. Father's Day, Mother's Day, weddings, retirements, anniversaries, memorials — we've got vetted artisans who can hit any of them.",
        ],
    },
    "farmhouse-decor": {
        "h1": "Farmhouse Decor, Made by Real Makers.",
        "title": "Farmhouse Decor — Hand-Made Wood & Metal Pieces | Crafters Market",
        "desc": "Farmhouse decor hand-made by US artisans — distressed wood signs, plasma-cut metal wall art, custom ranch signs, kitchen serving boards, mantel pieces.",
        "paragraphs": [
            "The farmhouse aesthetic doesn't have to mean Hobby Lobby. Our makers source real reclaimed hardwoods, distress them by hand, and pair them with hand-cut metal accents — none of this stenciled MDF nonsense.",
            "Custom monograms, family-name signs, hand-burned mantel quotes, plasma-cut ranch silhouettes, hand-stitched kitchen runners. Filter by maker location to support a regional artisan, or order with your last name and the year your home was built.",
        ],
    },
    "garage-decor": {
        "h1": "Garage Decor for Real Builders.",
        "title": "Garage Decor — Plasma-Cut Logos & Workshop Wall Art | Crafters Market",
        "desc": "Garage decor for builders, mechanics, and shop dogs — plasma-cut logo signs, tool-themed wall art, vintage car silhouettes, custom shop names. Built by US makers.",
        "paragraphs": [
            "If your garage is your real workshop, your wall art should match. Our makers plasma-cut vintage truck silhouettes, engrave tool logos, weld scrap-stock pit-crew signs, and route hardwood pegboards that don't look like they came from a big-box store.",
            "Order a custom shop name, dial in the gauge and finish for harsh garage conditions, and mount with stainless hardware that survives oil, solvent, and the occasional bench-fail. Most pieces ship from a real American shop in 1-2 weeks.",
        ],
    },
    "rustic-cabin-decor": {
        "h1": "Rustic Cabin Decor, Made in Real Workshops.",
        "title": "Rustic Cabin Decor — Hand-Made by US Artisans | Crafters Market",
        "desc": "Rustic cabin decor hand-made by US craftsmen — distressed wood signs, plasma-cut wildlife silhouettes, antler accent pieces, family-name camp signs.",
        "paragraphs": [
            "Cabin decor that lives up to the cabin: reclaimed hardwood signs, plasma-cut deer + elk silhouettes, hand-forged iron coat hooks, family-camp signs with the year and the lake. None of it printed, none of it warehoused.",
            "Most pieces ship in 1-3 weeks. Custom orders welcome — send the cabin name, your year of ownership, and which animal silhouette you want and the maker quotes back inside 24 hours.",
        ],
    },
    "wedding-gifts": {
        "h1": "Wedding Gifts That Get Used, Not Returned.",
        "title": "Wedding Gifts — Personalized by US Artisans | Crafters Market",
        "desc": "Wedding gifts hand-made by US artisans: engraved cutting boards, monogrammed wall art, family-name signs, custom address plaques, photo-engraved keepsakes.",
        "paragraphs": [
            "The wedding gift that actually gets used is the one with their names on it — hand-engraved hardwood serving board, plasma-cut family-name wall sign, monogrammed address plaque for the new house. Our makers ship custom-built pieces in 1-3 weeks, rush options available for shorter timelines.",
            "Order with their wedding date, last name, and an optional design tweak. Stainless hardware on outdoor pieces, food-safe finishes on serving boards, and direct-from-maker shipping so it arrives the way it left the shop.",
        ],
    },
    "memorial-pieces": {
        "h1": "Memorial Pieces, Made to Last.",
        "title": "Memorial Pieces & Tribute Plaques by US Artisans | Crafters Market",
        "desc": "Memorial plaques, tribute pieces, and remembrance gifts hand-made by US artisans. Engraved hardwood, plasma-cut steel, photo-engraved keepsakes. Made to last.",
        "paragraphs": [
            "When the moment matters, the piece should outlast the moment. Our makers engrave memorial plaques in solid hardwood, plasma-cut tribute signs in raw steel, and machine bronze nameplates that won't fade in a generation. Family-friendly intake, direct messaging with the artisan, and rush options for service deadlines.",
            "Provide the name, dates, and any quote or scripture you'd like included. Outdoor pieces use weather-sealed finishes and stainless hardware. Indoor mantels and tribute walls in figured hardwood with hand-rubbed oil finishes.",
        ],
    },
    "outdoor-metal-decor": {
        "h1": "Outdoor Metal Decor That Survives Real Weather.",
        "title": "Outdoor Metal Decor — Weatherproof Signs & Art | Crafters Market",
        "desc": "Outdoor metal decor by US makers — plasma-cut yard signs, address plaques, garden art, mailbox flags. Sealed finishes, stainless hardware, survives real weather.",
        "paragraphs": [
            "Outdoor metal pieces fail one of three ways: thin gauge that warps, hardware that rusts, finishes that flake off in two seasons. Our vetted makers use 14-16 gauge steel minimum, stainless fasteners, and powder-coat or weather-sealed patina finishes — pieces built to last a real Midwest winter.",
            "Custom address signs, garden silhouettes, weather-vane scrollwork, plasma-cut house numbers, mailbox flags. Specify your mounting situation in the brief and the maker recommends the right gauge + finish for your environment.",
        ],
    },
    "business-signs": {
        "h1": "Business Signs, Plasma-Cut by Real Makers.",
        "title": "Custom Business Signs — Plasma & Laser Cut Steel by US Shops | Crafters Market",
        "desc": "Custom business signs plasma-cut and laser-cut by vetted US makers. Storefront signage, indoor lobbies, food-truck logos, brewery taproom plaques.",
        "paragraphs": [
            "Storefront, taproom, food truck, professional office — your business sign should match the craft you're selling. Our makers cut logos to spec in raw steel, brushed aluminum, or hardwood, mount with concealed standoffs, and ship direct so the finish arrives intact.",
            "Need ADA-compliant mounting? Backlit acrylic? Powder-coated finish in a specific brand color? Submit the brief with your logo file, dimensions, and environment, and the maker quotes back inside 24 hours.",
        ],
    },
    "patriotic-decor": {
        "h1": "Patriotic Decor, Made in America.",
        "title": "Patriotic Decor — American-Made Flag Art & Tributes | Crafters Market",
        "desc": "Patriotic decor hand-made by US craftsmen — wood-and-resin flags, plasma-cut eagles, veteran-tribute plaques, military-branch wall art. Veteran-owned shops welcome.",
        "paragraphs": [
            "American flag wall art that's actually made in America — hardwood-and-resin slat flags, plasma-cut weathered-steel eagles, branch-specific veteran tribute plaques. Many of our makers are veteran-owned, and we surface that on every shop profile so you can put your money where it counts.",
            "Custom branch / unit / deployment dates engraved into the piece. Outdoor finishes for porch and garage flags, indoor hardwood for living room and office. Most pieces ship in 1-3 weeks.",
        ],
    },
    "custom-ranch-signs": {
        "h1": "Custom Ranch Signs — Built for the Gate.",
        "title": "Custom Ranch Signs — Plasma-Cut Steel Entry Signs | Crafters Market",
        "desc": "Custom ranch signs plasma-cut and powder-coated by US makers. Gate signs, brand plaques, entry markers, livestock silhouettes — sized to your gate and county.",
        "paragraphs": [
            "Your ranch entry deserves better than a stencil-and-spray-paint sign. Our makers plasma-cut your ranch name in 14-gauge steel, weld in livestock silhouettes (cattle, horse, sheep, goat), and powder-coat the whole assembly so it survives the wind and the sun.",
            "Specify your gate width, your ranch name, and any brand or livestock graphic and the maker quotes back inside 24 hours. Mounting hardware sized for either standard pipe-fence gates or custom wood-and-iron entries.",
        ],
    },
    "cnc-metal-wall-art": {
        "h1": "CNC Metal Wall Art for Real Walls.",
        "title": "CNC Metal Wall Art — Plasma + Laser Cut Originals | Crafters Market",
        "desc": "CNC metal wall art hand-made by US makers. Plasma-cut steel sculptures, laser-cut copper accents, hand-finished aluminum panels — never mass-produced.",
        "paragraphs": [
            "The Hobby Lobby version of metal wall art is dollar-store steel stamped on a hydraulic press. Ours is plasma-cut by an artisan, hand-finished, mounted on concealed standoffs, and shipped direct from a real American shop. The difference shows.",
            "Browse the live grid for compass roses, mandala panels, family-name monograms, geometric statement pieces, wildlife silhouettes, and one-off commissions. Filter by maker location, technique, or finish.",
        ],
    },
    "handmade-gifts-for-dad": {
        "h1": "Handmade Gifts For Dad That He'll Actually Use.",
        "title": "Handmade Gifts For Dad — US-Made Wood & Metal | Crafters Market",
        "desc": "Handmade gifts for dad by vetted US makers: hardwood cutting boards, plasma-cut garage signs, leather portfolios, hand-burned plaques. No factory mugs.",
        "paragraphs": [
            "The good dad-gift problem isn't selection — it's that everything online is the same printed-mug factory garbage. Our makers cut, weld, engrave, and finish real materials your dad will actually display: solid hardwood boards, raw steel signs, leather portfolios, hand-burned plaques.",
            "Most pieces ship in 2-3 weeks with rush options for Father's Day, birthdays, and retirements. Filter by under-$50, under-$100, or commission a one-of-a-kind for the dad who has everything.",
        ],
    },
    # iter321 — SEO/Trust audit category landing pages
    "plasma-cut-wall-art": {
        "h1": "Plasma Cut Wall Art, Made in American Shops.",
        "title": "Plasma Cut Wall Art — Custom Steel Sculpture by US Makers | Crafters Market",
        "desc": "Plasma-cut steel wall art — abstract sculptures, family monograms, ranch silhouettes, geometric panels. Cut on real CNC plasma tables by vetted American makers.",
        "paragraphs": [
            "Plasma cutting gives steel a depth you can't fake — raw cut edges, controlled HAZ patina, and the weight that makes a 4-foot panel land on a wall instead of float on it. Our makers run Hypertherm Powermax and EDGE Pro tables on stock from 12-gauge up to 1/4-inch plate.",
            "Most plasma-cut wall pieces ship in 2-4 weeks. Custom monograms, ranch silhouettes, compass roses, and one-off commissions are bread-and-butter — submit a brief with your size, finish, and dimensions and the maker quotes back inside 24 hours.",
        ],
    },
    "cnc-wood-signs": {
        "h1": "CNC Wood Signs, Carved in American Shops.",
        "title": "CNC Wood Signs — V-Carved & Routed by US Makers | Crafters Market",
        "desc": "V-carved and 3D-routed wood signs in walnut, oak, cherry, maple — family-name, address, business, cabin, wedding, memorial pieces. Custom built by US makers.",
        "paragraphs": [
            "CNC wood signs look like they were carved by hand but with the precision of a laser — clean V-grooves, deep 3D relief, perfect repeatable letterforms in any font. Our makers run ShopBots, Avid CNCs, and large-format Laguna routers on solid hardwood up to 8 feet long.",
            "Standard finishes: hand-rubbed oil for indoor pieces, marine-grade spar urethane for porch and entry signs, and epoxy-filled inlays for high-contrast letter work. Most signs ship in 2-4 weeks; rush is available on most makers for an extra fee.",
        ],
    },
    "laser-engraved-gifts": {
        "h1": "Laser Engraved Gifts, Personalized in Real Shops.",
        "title": "Laser Engraved Gifts — Personalized by US Artisans | Crafters Market",
        "desc": "Engraved cutting boards, whiskey glasses, leather portfolios, slate coasters, photo-engraved keepsakes — laser-engraved by US makers. No screen-printed factory gifts.",
        "paragraphs": [
            "Laser engraving permanently marks wood, leather, slate, glass, anodized aluminum, and acrylic without changing the substrate's shape — the design becomes part of the material itself. Our makers run Epilog, Trotec, and OMTech CO2 and fiber lasers calibrated to keep edges crisp at any scale.",
            "Most engraved gifts ship in 5-10 business days because the engraving step itself is fast — the wait is the curing of any oil or wax finish after engraving. Rush orders for birthdays, anniversaries, weddings, and graduations are almost always available.",
        ],
    },
    "custom-address-signs": {
        "h1": "Custom Address Signs, Made for Your House Number.",
        "title": "Custom Address Signs — Plasma, Wood & Copper by US Makers | Crafters Market",
        "desc": "Personalized address plaques in plasma-cut steel, V-carved hardwood, and laser-cut copper. Built to your house number, street, and finish preferences by vetted US makers.",
        "paragraphs": [
            "A custom address sign is the cheapest curb-appeal upgrade in real estate. Our makers build address plaques in raw steel, powder-coated aluminum, V-carved walnut, hand-burnished copper, and stained hardwood — sized from a 12-inch porch number up to 36-inch mailbox or driveway-entry signs.",
            "Most address signs ship in 1-3 weeks with mounting hardware included (anchors sized for drywall, brick, stucco, or wood siding). Tell the maker your wall material and they'll send the right anchors in the box — no separate hardware-store trip after the sign arrives.",
        ],
    },
    "engraved-cutting-boards": {
        "h1": "Engraved Cutting Boards, Made for Real Kitchens.",
        "title": "Engraved Cutting Boards — Walnut, Maple, Cherry by US Makers | Crafters Market",
        "desc": "Hardwood cutting boards engraved with your family name, wedding date, or monogram. Walnut, maple, cherry, end-grain butcher blocks — food-safe, made by US artisans.",
        "paragraphs": [
            "An engraved cutting board is the wedding gift that gets used three times a week for 30 years. Our makers route and laser-engrave solid hardwood boards in sizes from 9x12 personal boards up to 18x24 carving boards. Standard finishes are food-safe mineral oil topped with beeswax conditioner — refresh once a quarter and the board stays beautiful for decades.",
            "Most engraved boards ship in 5-10 business days. End-grain butcher-block boards take longer (2-3 weeks) because each block is hand-glued from individual hardwood squares for self-healing knife marks and edge stability.",
        ],
    },
}
# Self-check at import — every slug in seo.SEO_LANDING_SLUGS should
# have a matching content entry so a crawler never lands on a 404
# prerender. Run as a soft warning so a missing entry doesn't crash
# the app on startup.
_missing = [s for s in SEO_LANDING_SLUGS if s not in _LANDING_CONTENT]
if _missing:
    log.warning(
        "[og_static] SEO landing slugs missing prerender content: %s — "
        "they'll fall back to a generic title.", _missing,
    )


def _generic_landing_content(slug: str) -> dict[str, object]:
    """Fallback for any landing slug not explicitly in _LANDING_CONTENT.
    Builds a sensible title/desc/H1 from the slug itself so the page
    still has unique meta tags."""
    keyword = " ".join(w.capitalize() for w in slug.split("-"))
    return {
        "h1": f"{keyword} on Crafters Market",
        "title": f"{keyword} — US Makers, Made-to-Order | Crafters Market",
        "desc": (
            f"Shop {keyword.lower()} hand-made by vetted US artisans on "
            "Crafters Market. Plasma, laser, CNC, and hand-finished pieces, "
            "made to order, ships nationwide."
        ),
        "paragraphs": [
            f"Every {keyword.lower()} piece on Crafters Market is built by a real "
            "American maker in a real workshop. Each shop is vetted before listing, "
            "every piece is made to order, and payment is held in Stripe Connect "
            "until the maker ships.",
            "Filter the live grid by maker location, technique, or category to "
            "find the exact piece you're after, or submit a custom-order brief "
            "to have one built to your spec.",
        ],
    }


# ────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────

def _wrap_paragraphs(paragraphs: list[str]) -> str:
    """Render a list of paragraphs as crawlable HTML — each <p> tag
    survives meta-refresh because crawlers don't honor the refresh."""
    return "".join(f"<p>{_esc(p)}</p>" for p in paragraphs)


def _website_jsonld(site: str) -> dict:
    """Re-used WebSite + Organization JSON-LD for every static page so
    Google's Knowledge Graph links them all to one entity."""
    return {
        "@type": "WebSite",
        "@id": f"{site}/#website",
        "url": f"{site}/",
        "name": "Crafters Market",
        "description": "A vetted marketplace for American CNC, plasma, laser, and wood makers.",
        "publisher": {"@id": f"{site}/#organization"},
        "potentialAction": {
            "@type": "SearchAction",
            "target": {"@type": "EntryPoint", "urlTemplate": f"{site}/shop?q={{search_term_string}}"},
            "query-input": "required name=search_term_string",
        },
    }


def _org_jsonld(site: str) -> dict:
    return {
        "@type": "Organization",
        "@id": f"{site}/#organization",
        "name": "Crafters Market",
        "url": f"{site}/",
        "logo": f"{site}/downloads/cnc-garage-builders.png",
        "description": "A vetted marketplace for American CNC, plasma, laser, and wood makers.",
        "sameAs": [
            "https://www.pinterest.com/craftersmarket/",
            "https://www.instagram.com/craftersmarket/",
        ],
    }


# ────────────────────────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────────────────────────

@router.get("/og/home", include_in_schema=False)
async def og_home(http_request: Request):
    """Homepage prerender. Hits the SPA at `/` after meta-refresh."""
    site = _site()
    title = "Crafters Market — Vetted US Makers · CNC, Plasma, Laser & Wood"
    desc = (
        "Buy custom CNC, plasma-cut, laser-engraved, and wood pieces direct from "
        "vetted American makers. Made to order, ships nationwide, Stripe-secured."
    )
    canonical = f"{site}/"
    body_html = (
        '<nav class="breadcrumb" aria-label="Breadcrumb"><span>Home</span></nav>'
        '<section class="sect"><h2>Made in America. One piece at a time.</h2>'
        '<p>Crafters Market is the vetted marketplace for American CNC, plasma, laser, '
        'and wood makers. Every listing is hand-built by an independent artisan in a '
        'real workshop — no drop-shipping, no anonymous factories, no mass-produced imports. '
        'You see who built your piece, how they made it, and where it shipped from.</p>'
        '<p>Makers keep 95% of the sale price (5% platform commission). Payment is processed '
        'by Stripe and held in escrow until the maker ships — so you never pay for a piece '
        'that doesn\'t arrive, and the maker never ships a piece they don\'t get paid for.</p>'
        '</section>'
        '<section class="sect"><h2>Start here</h2><ul>'
        f'<li><a href="{site}/shop">Browse the shop</a> — every published listing, latest first</li>'
        f'<li><a href="{site}/custom-order">Commission a custom piece</a> — submit a brief, get a quote in 24h</li>'
        f'<li><a href="{site}/makers">Meet the makers</a> — every vetted artisan + their workshop photos</li>'
        f'<li><a href="{site}/apply">Apply to sell</a> — vetted maker application + onboarding</li>'
        f'<li><a href="{site}/journal">Read the journal</a> — guides, profiles, and shop notes</li>'
        '</ul></section>'
        '<section class="sect"><h2>Popular categories</h2><ul>'
        f'<li><a href="{site}/custom-metal-signs">Custom metal signs</a></li>'
        f'<li><a href="{site}/cnc-metal-wall-art">CNC metal wall art</a></li>'
        f'<li><a href="{site}/personalized-gifts">Personalized gifts</a></li>'
        f'<li><a href="{site}/wedding-gifts">Wedding gifts</a></li>'
        f'<li><a href="{site}/memorial-pieces">Memorial pieces</a></li>'
        f'<li><a href="{site}/outdoor-metal-decor">Outdoor metal decor</a></li>'
        f'<li><a href="{site}/business-signs">Business signs</a></li>'
        f'<li><a href="{site}/patriotic-decor">Patriotic decor</a></li>'
        '</ul></section>'
    )
    json_ld = json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            _website_jsonld(site),
            _org_jsonld(site),
            {
                "@type": "WebPage",
                "@id": canonical,
                "url": canonical,
                "name": title,
                "description": desc,
                "isPartOf": {"@id": f"{site}/#website"},
            },
        ],
    }, separators=(",", ":"))
    html = _render_og_html(
        title=title, description=desc, image=_placeholder_image(),
        canonical_url=canonical, redirect_url=canonical,
        body_html=body_html, json_ld=json_ld,
    )
    return HTMLResponse(content=html)


@router.get("/og/custom-order", include_in_schema=False)
async def og_custom_order(http_request: Request):
    """Custom-order brief intake page prerender."""
    site = _site()
    title = "Commission a Custom Piece — Brief Intake | Crafters Market"
    desc = (
        "Commission a one-off custom piece from a vetted US maker. Submit a brief "
        "with your idea, material, and timeline — get a quote inside 24 hours."
    )
    canonical = f"{site}/custom-order"
    body_html = (
        '<nav class="breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{site}/">Home</a> · <span>Custom Order</span></nav>'
        '<section class="sect"><h2>How custom orders work</h2>'
        '<p>Tell us what you want built — material, size, technique, timeline, and any reference images. We route your brief to the right vetted maker on the platform (CNC plasma, laser, wood router, hand-forging, leather, etc.) and you get a quote inside 24 hours.</p>'
        '<p>You message the maker directly through the platform, approve the quote, and Stripe holds your payment until they ship. No middleman taking a cut beyond the standard 5% platform commission.</p>'
        '</section>'
        '<section class="sect"><h2>What we route well</h2><ul>'
        f'<li><a href="{site}/custom-metal-signs">Custom metal signs</a> — address plaques, family-name signs, gate signage</li>'
        f'<li><a href="{site}/memorial-pieces">Memorial pieces</a> — engraved hardwood, plasma-cut tribute signs</li>'
        f'<li><a href="{site}/wedding-gifts">Wedding gifts</a> — monogrammed, dated, themed for the couple</li>'
        f'<li><a href="{site}/business-signs">Business signs</a> — storefronts, taprooms, food trucks, lobbies</li>'
        f'<li><a href="{site}/custom-ranch-signs">Custom ranch signs</a> — gate entry markers, brand plaques</li>'
        '</ul></section>'
        '<section class="sect"><h2>What to include in the brief</h2><ul>'
        '<li>Description of the piece and reference images (sketches OK, AI mock-ups OK)</li>'
        '<li>Material preference (steel, aluminum, copper, hardwood, etc.) — or let the maker recommend</li>'
        '<li>Dimensions, or the space it has to fit</li>'
        '<li>Timeline / event date if rush handling is needed</li>'
        '<li>Budget range — helps the maker scope the right approach</li>'
        '</ul></section>'
    )
    json_ld = json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            _website_jsonld(site),
            _org_jsonld(site),
            {
                "@type": "WebPage",
                "@id": canonical,
                "url": canonical,
                "name": title,
                "description": desc,
                "isPartOf": {"@id": f"{site}/#website"},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{site}/"},
                    {"@type": "ListItem", "position": 2, "name": "Custom Order", "item": canonical},
                ],
            },
            {
                "@type": "Service",
                "name": "Custom Order Brief Intake",
                "provider": {"@id": f"{site}/#organization"},
                "areaServed": "United States",
                "description": desc,
            },
        ],
    }, separators=(",", ":"))
    html = _render_og_html(
        title=title, description=desc, image=_placeholder_image(),
        canonical_url=canonical, redirect_url=canonical,
        body_html=body_html, json_ld=json_ld,
    )
    return HTMLResponse(content=html)


@router.get("/og/apply", include_in_schema=False)
async def og_apply(http_request: Request):
    """Maker application page prerender."""
    site = _site()
    title = "Apply to Sell as a Maker — Vetted Application | Crafters Market"
    desc = (
        "Sell your CNC, plasma, laser, or wood pieces to vetted buyers nationwide. "
        "Apply in 10 minutes — we review every applicant's workshop and past work."
    )
    canonical = f"{site}/apply"
    body_html = (
        '<nav class="breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{site}/">Home</a> · <span>Apply</span></nav>'
        '<section class="sect"><h2>Sell on Crafters Market — vetted, no marketplace middleman</h2>'
        '<p>Crafters Market is built for independent American CNC, plasma, laser, and wood makers. Every applicant is reviewed — workshop photos, machine specs, past-work samples — and approved makers get a vetted-maker badge that buyers actually trust.</p>'
        '<p>You keep 95% of every sale (5% platform commission + 3% Stripe processing). Payments hit your Stripe Connect account on a rolling basis. No subscription required on the Free tier; first 10 listings are always free; Crafters Plus is optional at $12/month for power-sellers.</p>'
        '</section>'
        '<section class="sect"><h2>What we look for</h2><ul>'
        '<li>Real workshop with verifiable photos (your machines, your finished work)</li>'
        '<li>Original work — no resale, no drop-shipping, no overseas re-branding</li>'
        '<li>US-based shop with a verifiable address</li>'
        '<li>Stripe-eligible bank account for payouts</li>'
        '</ul></section>'
        '<section class="sect"><h2>What you get</h2><ul>'
        f'<li>Listing page with full SEO (auto-generated per-product structured data, OG tags, etc.)</li>'
        f'<li>Stripe Connect payouts, Shippo shipping labels, automatic catalog syndication to Google Merchant + Pinterest + Meta</li>'
        f'<li>Maker dashboard with sales analytics, MTD reports, dispute handling, refund approvals</li>'
        f'<li><a href="{site}/founders">Founder slots</a> — first 100 approved makers get a year of 0% commission</li>'
        '</ul></section>'
    )
    json_ld = json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            _website_jsonld(site),
            _org_jsonld(site),
            {
                "@type": "WebPage",
                "@id": canonical,
                "url": canonical,
                "name": title,
                "description": desc,
                "isPartOf": {"@id": f"{site}/#website"},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{site}/"},
                    {"@type": "ListItem", "position": 2, "name": "Apply", "item": canonical},
                ],
            },
        ],
    }, separators=(",", ":"))
    html = _render_og_html(
        title=title, description=desc, image=_placeholder_image(),
        canonical_url=canonical, redirect_url=canonical,
        body_html=body_html, json_ld=json_ld,
    )
    return HTMLResponse(content=html)


@router.get("/og/journal", include_in_schema=False)
async def og_journal_index(http_request: Request):
    """Journal index prerender — lists latest posts so the crawler can
    follow into the per-post prerender (`/api/og/journal/{slug}`)."""
    site = _site()
    # iter318b — show latest journal posts as anchored links so the
    # crawler can walk into each per-post prerender.
    posts = await db.journal_posts.find(
        {"status": "published", "deleted_at": {"$in": [None, ""]}},
        {"_id": 0, "slug": 1, "title": 1, "excerpt": 1, "published_at": 1, "author": 1},
    ).sort("published_at", -1).limit(50).to_list(50)

    title = "Journal — Guides, Maker Profiles & Shop Notes | Crafters Market"
    desc = (
        "Read the Crafters Market journal: maker workshop profiles, CNC technique "
        "guides, finish + material how-tos, and shop-running notes from real "
        "American artisans."
    )
    canonical = f"{site}/journal"
    list_items = "".join(
        f'<li><a href="{site}/journal/{_esc(p.get("slug",""))}">'
        f'{_esc(p.get("title",""))}'
        f'</a>{(" — " + _esc(p.get("excerpt",""))[:160]) if p.get("excerpt") else ""}</li>'
        for p in posts
    ) or "<li>No posts yet — check back soon.</li>"
    body_html = (
        '<nav class="breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{site}/">Home</a> · <span>Journal</span></nav>'
        '<section class="sect"><h2>The Crafters Market journal</h2>'
        '<p>Guides for CNC, plasma, laser, and wood makers — material selection, finishing, '
        'shipping outdoor pieces, photography for product listings, pricing your work, and '
        'running a one-person workshop without burning out. Plus weekly maker profiles so '
        'you can see how the people on the platform actually work.</p>'
        '</section>'
        f'<section class="sect"><h2>Latest posts</h2><ul>{list_items}</ul></section>'
    )
    item_list = [
        {
            "@type": "ListItem",
            "position": i + 1,
            "url": f"{site}/journal/{p.get('slug','')}",
            "name": p.get("title", "") or p.get("slug", ""),
        }
        for i, p in enumerate(posts[:24])
    ]
    json_ld = json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            _website_jsonld(site),
            _org_jsonld(site),
            {
                "@type": "CollectionPage",
                "@id": canonical,
                "name": title,
                "url": canonical,
                "description": desc,
                "isPartOf": {"@id": f"{site}/#website"},
            },
            {
                "@type": "ItemList",
                "name": "Latest journal posts",
                "numberOfItems": len(item_list),
                "itemListElement": item_list,
            },
        ],
    }, separators=(",", ":"))
    html = _render_og_html(
        title=title, description=desc, image=_placeholder_image(),
        canonical_url=canonical, redirect_url=canonical,
        body_html=body_html, json_ld=json_ld,
    )
    return HTMLResponse(content=html)


@router.get("/og/policy", include_in_schema=False)
async def og_policy(http_request: Request):
    """Policy page prerender — terms, shipping, returns, etc."""
    site = _site()
    title = "Site Policies — Terms, Shipping, Returns, Privacy | Crafters Market"
    desc = (
        "Crafters Market site policies — Terms of Service, Shipping, Returns, "
        "Custom Orders, Privacy, Makers Market commission, Prohibited Items, IP, "
        "and buyer/seller conduct."
    )
    canonical = f"{site}/policy"
    body_html = (
        '<nav class="breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{site}/">Home</a> · <span>Policy</span></nav>'
        '<section class="sect"><h2>Crafters Market site policies</h2>'
        '<p>The full operating manual for buying and selling on Crafters Market. '
        'Each section opens to its full text on the live page — please read the ones '
        'relevant to your transaction.</p>'
        '</section>'
        '<section class="sect"><h2>Sections</h2><ul>'
        f'<li><a href="{site}/policy#terms">Terms of Service</a></li>'
        f'<li><a href="{site}/policy#shipping">Shipping Policy</a></li>'
        f'<li><a href="{site}/policy#returns">Returns &amp; Refunds</a></li>'
        f'<li><a href="{site}/policy#custom">Custom Order Policy</a></li>'
        f'<li><a href="{site}/policy#payment">Payment Policy</a></li>'
        f'<li><a href="{site}/policy#marketplace">Makers Market — Buyer Protection &amp; Maker Agreement</a></li>'
        f'<li><a href="{site}/policy#buyer-protection">Buyer Protection</a></li>'
        f'<li><a href="{site}/policy#maker-agreement">Maker Agreement</a></li>'
        f'<li><a href="{site}/policy#privacy">Privacy Policy</a></li>'
        f'<li><a href="{site}/policy#prohibited">Prohibited Items</a></li>'
        f'<li><a href="{site}/policy#ip">Intellectual Property</a></li>'
        '</ul></section>'
    )
    json_ld = json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            _website_jsonld(site),
            _org_jsonld(site),
            {
                "@type": "WebPage",
                "@id": canonical,
                "url": canonical,
                "name": title,
                "description": desc,
                "isPartOf": {"@id": f"{site}/#website"},
            },
        ],
    }, separators=(",", ":"))
    html = _render_og_html(
        title=title, description=desc, image=_placeholder_image(),
        canonical_url=canonical, redirect_url=canonical,
        body_html=body_html, json_ld=json_ld,
    )
    return HTMLResponse(content=html)


@router.get("/og/landing/{slug}", include_in_schema=False)
async def og_landing(slug: str, http_request: Request):
    """SEO landing-page prerender — one of the ~19 keyword-targeted
    landing pages defined in `SEO_LANDING_SLUGS`."""
    if slug not in SEO_LANDING_SLUGS:
        # Don't 404 for unknown slugs; the Worker may have routed a
        # legitimate path through this handler. Render a generic
        # marketplace-index page instead so the crawler still gets
        # crawlable content (worst case is a duplicate canonical).
        cfg = _generic_landing_content(slug)
    else:
        cfg = _LANDING_CONTENT.get(slug) or _generic_landing_content(slug)

    site = _site()
    title = str(cfg["title"])
    desc = str(cfg["desc"])
    canonical = f"{site}/{slug}"
    h1 = str(cfg["h1"])

    # Sample 12 live products that the SPA's `match` predicate would
    # surface. We can't run the JS predicate server-side, so instead
    # we just pull the latest 12 published products with a maker_slug
    # — gives the crawler enough real internal links to follow.
    products = await db.products.find(
        {"status": "published", "deleted_at": {"$in": [None, ""]}},
        {"_id": 0, "slug": 1, "title": 1, "price": 1, "maker_name": 1},
    ).sort("created_at", -1).limit(12).to_list(12)

    paragraphs_html = _wrap_paragraphs(list(cfg["paragraphs"]))  # type: ignore[arg-type]
    list_items = "".join(
        f'<li><a href="{site}/shop/{_esc(p.get("slug",""))}">'
        f'{_esc(p.get("title",""))}'
        f'{" — $" + str(int(p["price"])) if p.get("price") else ""}'
        f'{" · " + _esc(p["maker_name"]) if p.get("maker_name") else ""}'
        f'</a></li>'
        for p in products
    )
    related = [
        ("Custom metal signs",      "/custom-metal-signs"),
        ("CNC metal wall art",      "/cnc-metal-wall-art"),
        ("Personalized gifts",      "/personalized-gifts"),
        ("Wedding gifts",           "/wedding-gifts"),
        ("Memorial pieces",         "/memorial-pieces"),
        ("Outdoor metal decor",     "/outdoor-metal-decor"),
        ("Business signs",          "/business-signs"),
        ("Patriotic decor",         "/patriotic-decor"),
    ]
    related_html = "".join(
        f'<li><a href="{site}{path}">{_esc(label)}</a></li>'
        for label, path in related if path != f"/{slug}"
    )

    body_html = (
        '<nav class="breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{site}/">Home</a> · <a href="{site}/shop">Shop</a> · '
        f'<span>{_esc(h1)}</span></nav>'
        f'<section class="sect"><h2>{_esc(h1)}</h2>{paragraphs_html}</section>'
        + (f'<section class="sect"><h2>Live listings on Crafters Market</h2><ul>{list_items}</ul></section>' if list_items else "")
        + f'<section class="sect"><h2>Related categories</h2><ul>{related_html}</ul></section>'
    )

    json_ld = json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            _website_jsonld(site),
            _org_jsonld(site),
            {
                "@type": "CollectionPage",
                "@id": canonical,
                "name": title,
                "url": canonical,
                "description": desc,
                "isPartOf": {"@id": f"{site}/#website"},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{site}/"},
                    {"@type": "ListItem", "position": 2, "name": "Shop", "item": f"{site}/shop"},
                    {"@type": "ListItem", "position": 3, "name": h1, "item": canonical},
                ],
            },
        ],
    }, separators=(",", ":"))
    html = _render_og_html(
        title=title, description=desc, image=_placeholder_image(),
        canonical_url=canonical, redirect_url=canonical,
        body_html=body_html, json_ld=json_ld,
    )
    return HTMLResponse(content=html)
