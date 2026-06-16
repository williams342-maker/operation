"""OG prerender — server-side HTML for crawlers (Facebook, LinkedIn, Discord,
Pinterest, Slack, Twitter/X) that don't execute JavaScript.

Background: the React SPA serves a single static `index.html` with
generic Open Graph tags. When a maker pastes a product link into Slack
or Pinterest, the crawler hits `/shop/<slug>`, gets the SPA shell, and
rendered the generic homepage card every time — no per-product image,
no per-product title, no per-product price.

This router returns full HTML with the *correct* OG + Twitter Card meta
tags for a specific product / maker / journal-post slug. A `<meta
http-equiv="refresh" content="0;url=/shop/<slug>">` tag bounces real
human visitors to the SPA so the URL stays useful as a direct link too
— crawlers don't honor meta-refresh, browsers do.

Routes (all under the `/api` API prefix that the K8s ingress sends to
the backend):
  GET /api/og/product/<slug>
  GET /api/og/maker/<slug>
  GET /api/og/journal/<slug>

Wiring crawler traffic to these routes (operator action, optional):
  Cloudflare Worker — when `User-Agent` matches a known social crawler
  AND the path matches `/shop/<slug>` / `/makers/<slug>` /
  `/journal/<slug>`, rewrite to the corresponding `/api/og/<kind>/<slug>`
  route. Without a Worker, makers can manually share the `/api/og/...`
  URL and get rich previews.
"""
from __future__ import annotations

import os
import re
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from core import db, site_root, logger

router = APIRouter()

# Slug guard — prevent path traversal and absurd inputs from running a
# DB query at all. Real slugs are kebab-case alphanumeric, ≤120 chars.
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,119}$", re.IGNORECASE)


def _esc(s: Optional[str]) -> str:
    """HTML/attr-safe escape — minimal but covers `< > & " '` plus
    newlines (which break meta tag attributes silently in some crawlers)."""
    if not s:
        return ""
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
         .replace("'", "&#39;")
         .replace("\n", " ")
         .replace("\r", " ")
    )


def _truncate(s: Optional[str], n: int) -> str:
    """Soft-truncate to `n` chars on a word boundary, append … if cut.
    Crawlers usually cap descriptions ~200 chars; keep us under that."""
    if not s:
        return ""
    s = s.strip()
    if len(s) <= n:
        return s
    cut = s[:n].rsplit(" ", 1)[0].rstrip(",.;:—- ")
    return cut + "…"


def _render_og_html(
    *,
    title: str,
    description: str,
    image: str,
    canonical_url: str,
    redirect_url: str,
    extra_props: Optional[list[tuple[str, str]]] = None,
    twitter_card: str = "summary_large_image",
    body_html: str = "",
    json_ld: Optional[str] = None,
) -> str:
    """Build a minimal, crawler-perfect HTML doc.

    Real browsers honor the `meta http-equiv=refresh` and bounce to
    `redirect_url`. Crawlers ignore the refresh and read the meta tags.

    `body_html` is injected after the H1/description block — pass real
    content (long description, breadcrumb, related-items, internal
    links) so SEO crawlers (not just social unfurlers) get a fully
    indexable page when Cloudflare's Worker routes them here.

    `json_ld` is a JSON string injected into `<script type="application/ld+json">`
    — Schema.org Product / Person / Article structured data so Google
    rich-results, Bing entity panels, etc. light up.
    """
    extras_list = list(extra_props or [])
    og_type = "website"
    for k, v in extras_list:
        if k == "og:type" and v:
            og_type = v
    extras_list = [(k, v) for k, v in extras_list if k != "og:type"]
    extras = "".join(
        f'<meta property="{_esc(k)}" content="{_esc(v)}" />'
        for k, v in extras_list
        if v
    )
    json_ld_block = (
        f'<script type="application/ld+json">{json_ld}</script>'
        if json_ld else ""
    )
    return (
        "<!doctype html>"
        "<html lang=\"en\"><head>"
        "<meta charset=\"utf-8\" />"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />"
        "<meta name=\"robots\" content=\"index, follow, max-snippet:-1, max-image-preview:large\" />"
        f"<title>{_esc(title)}</title>"
        f"<meta name=\"description\" content=\"{_esc(description)}\" />"
        f"<link rel=\"canonical\" href=\"{_esc(canonical_url)}\" />"
        # OG / Facebook / LinkedIn / Discord / Slack / Pinterest
        f"<meta property=\"og:type\" content=\"{_esc(og_type)}\" />"
        "<meta property=\"og:site_name\" content=\"Crafters Market\" />"
        "<meta property=\"og:locale\" content=\"en_US\" />"
        f"<meta property=\"og:title\" content=\"{_esc(title)}\" />"
        f"<meta property=\"og:description\" content=\"{_esc(description)}\" />"
        f"<meta property=\"og:url\" content=\"{_esc(canonical_url)}\" />"
        f"<meta property=\"og:image\" content=\"{_esc(image)}\" />"
        f"<meta property=\"og:image:secure_url\" content=\"{_esc(image)}\" />"
        f"<meta property=\"og:image:alt\" content=\"{_esc(title)}\" />"
        # Pinterest Rich Pins specifically look for these dimensions —
        # tags without dimensions sometimes get rejected by Pinterest's
        # validator even when the image actually exists.
        "<meta property=\"og:image:width\" content=\"1200\" />"
        "<meta property=\"og:image:height\" content=\"1200\" />"
        f"{extras}"
        # Twitter / X
        f"<meta name=\"twitter:card\" content=\"{_esc(twitter_card)}\" />"
        f"<meta name=\"twitter:title\" content=\"{_esc(title)}\" />"
        f"<meta name=\"twitter:description\" content=\"{_esc(description)}\" />"
        f"<meta name=\"twitter:image\" content=\"{_esc(image)}\" />"
        # JSON-LD structured data
        f"{json_ld_block}"
        # Real-browser fallback — crawlers ignore http-equiv refresh.
        f"<meta http-equiv=\"refresh\" content=\"0; url={_esc(redirect_url)}\" />"
        "<style>body{margin:0;background:#0a0a0a;color:#e5e5e5;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;line-height:1.6}"
        ".w{max-width:760px;margin:0 auto;padding:60px 24px}"
        "a{color:#ff4500;text-decoration:underline;font-weight:600}"
        ".hero{text-align:center;margin-bottom:48px}"
        ".hero h1{font-family:Impact,Anton,sans-serif;font-size:44px;line-height:1.05;letter-spacing:-0.01em;margin:0 0 20px;text-transform:uppercase;color:#fff}"
        ".eyebrow{font-size:11px;letter-spacing:0.32em;color:#ff4500;text-transform:uppercase;margin:0 0 16px}"
        ".lede{font-size:14px;color:#a3a3a3;margin:0 0 28px}"
        ".cta{display:inline-block;border:1px solid #ff4500;padding:12px 24px;font-size:11px;letter-spacing:0.22em;text-transform:uppercase}"
        ".sect{margin:36px 0;padding:24px 0;border-top:1px solid #262626}"
        ".sect h2{font-size:14px;letter-spacing:0.18em;text-transform:uppercase;color:#ff4500;margin:0 0 12px}"
        "ul{padding-left:20px;margin:8px 0}li{margin:6px 0}"
        ".breadcrumb{font-size:11px;color:#737373;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:18px}"
        ".breadcrumb a{color:#a3a3a3;font-weight:500}"
        "</style>"
        "</head><body>"
        "<div class=\"w\">"
        f"<div class=\"hero\">"
        f"<p class=\"eyebrow\">◆ Crafters Market</p>"
        f"<h1>{_esc(title)}</h1>"
        f"<p class=\"lede\">{_esc(description)}</p>"
        f"<p><a class=\"cta\" href=\"{_esc(redirect_url)}\">Open the page →</a></p>"
        f"</div>"
        f"{body_html}"
        "</div></body></html>"
    )


def _site() -> str:
    """Canonical apex — never preview. Falls back to a hard-coded apex
    if `PUBLIC_SITE_URL` is missing or accidentally pointed at preview."""
    raw = (os.environ.get("PUBLIC_SITE_URL") or "").rstrip("/")
    if raw and "preview." not in raw and not raw.endswith(".emergentagent.com"):
        return raw
    return "https://craftersmarket.org"


def _placeholder_image() -> str:
    return f"{_site()}/downloads/cnc-garage-builders.png"


def _not_found_html(kind: str, back_url: str) -> HTMLResponse:
    """iter372 — crawler-correct 404 for dead slugs.

    Old behavior 302-bounced unknown slugs to the index page, which Google
    reports as "Page with redirect" and can soft-404 the target. A real
    404 + noindex makes Google drop the URL cleanly. Humans still get a
    styled page with an onward link (plus a 2s meta-refresh convenience)."""
    html = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\" />"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />"
        "<meta name=\"robots\" content=\"noindex, follow\" />"
        f"<title>{_esc(kind)} not found — Crafters Market</title>"
        f"<meta http-equiv=\"refresh\" content=\"2; url={_esc(back_url)}\" />"
        "<style>body{margin:0;background:#0a0a0a;color:#e5e5e5;"
        "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;"
        "text-align:center;padding:80px 24px}a{color:#ff4500}</style>"
        "</head><body>"
        f"<h1>404 — this {_esc(kind.lower())} isn&rsquo;t here.</h1>"
        "<p>It may have sold, expired, or moved.</p>"
        f"<p><a href=\"{_esc(back_url)}\">Continue to Crafters Market →</a></p>"
        "</body></html>"
    )
    return HTMLResponse(content=html, status_code=404)


# ============================================================
# Product
# ============================================================
@router.get("/og/product/{slug}", include_in_schema=False)
async def og_product(slug: str, http_request: Request):
    """Crawler-targeted prerender for a product detail page."""
    if not _SLUG_RE.match(slug or ""):
        return _not_found_html("Listing", f"{_site()}/shop")
    doc = await db.products.find_one(
        {"slug": slug, "deleted_at": None, "status": {"$ne": "draft"}},
        {"_id": 0, "title": 1, "description": 1, "images": 1, "price": 1,
         "maker_name": 1, "maker_slug": 1, "category": 1, "in_stock": 1,
         "tags": 1, "materials": 1},
    )
    if not doc:
        # Real 404 (iter372): dead listings drop out of Google instead of
        # accumulating as "Page with redirect" / soft-404 rows in GSC.
        logger.info("[og_prerender] product slug not found: %s", slug)
        return _not_found_html("Listing", f"{_site()}/shop")

    title_raw = (doc.get("title") or "").strip() or slug
    maker = (doc.get("maker_name") or "").strip()
    maker_slug = (doc.get("maker_slug") or "").strip()
    title = f"{title_raw}{' · ' + maker if maker else ''} — Crafters Market"
    full_desc = (doc.get("description") or "").strip()
    desc = _truncate(full_desc, 200) \
        or f"Hand-built by {maker or 'a vetted independent maker'} on Crafters Market — curated CNC art, custom signs, and made-to-order originals."
    img = ((doc.get("images") or [None])[0]) or _placeholder_image()
    # iter413as — Ensure og:image is absolute (Pinterest/Facebook/LinkedIn
    # crawlers reject relative URLs). Legacy seed images live at
    # /seed-images/... — prefix with the site origin.
    if img and not img.startswith(("http://", "https://")):
        img = f"{_site().rstrip('/')}/{img.lstrip('/')}"
    canonical = f"{_site()}/shop/{slug}"
    site = _site()

    extras: list[tuple[str, str]] = [("og:type", "product")]
    price = doc.get("price")
    if price is not None:
        price_str = f"{float(price):.2f}"
        # Both flavors — Pinterest reads `og:price:*`, Facebook reads
        # `product:price:*`. Belt-and-suspenders so both validators pass.
        extras.append(("og:price:amount", price_str))
        extras.append(("og:price:currency", "USD"))
        extras.append(("product:price:amount", price_str))
        extras.append(("product:price:currency", "USD"))
    # Availability — required for Pinterest Product Rich Pins and used
    # by Facebook Shop tab. Allowed values: "in stock" / "out of stock" /
    # "preorder" / "available for order". We treat made-to-order as
    # `available for order` so search results still render a buyable badge.
    in_stock_meta = "in stock" if bool(doc.get("in_stock", True)) else "available for order"
    extras.append(("og:availability", in_stock_meta))
    extras.append(("product:availability", in_stock_meta))
    extras.append(("product:condition", "new"))
    if maker or maker_slug:
        # Pinterest validators care about *presence*, not perfect display
        # — fall back to the maker slug when the denormalized `maker_name`
        # is missing on the product doc (older catalog rows).
        extras.append(("product:brand", maker or maker_slug))

    # Long-form indexable body — full description, materials, tags,
    # navigation breadcrumb, price + availability. Crawlers read this
    # as the primary content of the page.
    in_stock = bool(doc.get("in_stock", True))
    category = (doc.get("category") or "").strip()
    materials = doc.get("materials") or []
    tags = (doc.get("tags") or [])[:8]

    body_parts: list[str] = []
    body_parts.append(
        '<nav class="breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{site}/">Home</a> · <a href="{site}/shop">Shop</a>'
        f'{" · <a href=&quot;" + site + "/shop?category=" + _esc(category) + "&quot;>" + _esc(category) + "</a>" if category else ""}'
        f' · <span>{_esc(title_raw)}</span>'
        '</nav>'
    )
    if full_desc:
        body_parts.append(
            f'<section class="sect"><h2>About this piece</h2>'
            f'<p>{_esc(full_desc[:1500])}</p></section>'
        )
    if maker:
        body_parts.append(
            f'<section class="sect"><h2>Maker</h2>'
            f'<p>Hand-built by <a href="{site}/makers/{_esc(maker_slug or "")}">{_esc(maker)}</a> — '
            f'one of the vetted independent artisans on Crafters Market. Every piece in this shop is built to order in {_esc(maker)}\'s own workshop, never mass-produced.</p>'
            '</section>'
        )
    detail_lines: list[str] = []
    if price is not None:
        detail_lines.append(f"<li><strong>Price:</strong> ${float(price):.2f} USD</li>")
    detail_lines.append(
        f"<li><strong>Availability:</strong> {'In stock — ready to ship' if in_stock else 'Made to order'}</li>"
    )
    if category:
        detail_lines.append(f"<li><strong>Category:</strong> {_esc(category)}</li>")
    if materials:
        detail_lines.append(f"<li><strong>Materials:</strong> {_esc(', '.join(materials[:6]))}</li>")
    if tags:
        detail_lines.append(f"<li><strong>Tags:</strong> {_esc(', '.join(tags))}</li>")
    body_parts.append(
        '<section class="sect"><h2>Details</h2>'
        f'<ul>{"".join(detail_lines)}</ul></section>'
    )
    body_parts.append(
        '<section class="sect"><h2>Browse more</h2><ul>'
        f'<li><a href="{site}/shop">All listings on Crafters Market</a></li>'
        f'{"<li><a href=&quot;" + site + "/makers/" + _esc(maker_slug) + "&quot;>More from " + _esc(maker) + "</a></li>" if maker_slug and maker else ""}'
        f'{"<li><a href=&quot;" + site + "/shop?category=" + _esc(category) + "&quot;>More in " + _esc(category) + "</a></li>" if category else ""}'
        f'<li><a href="{site}/custom-order">Request a custom order</a></li>'
        '</ul></section>'
    )
    body_html = "".join(body_parts)

    # AggregateRating (iter302) — read the public review aggregate
    # for this product slug. When count is 0 we OMIT the field
    # entirely; Schema.org rejects AggregateRating with reviewCount=0.
    agg_pipeline = [
        {"$match": {
            "product_slug": slug,
            "$or": [
                {"source": {"$exists": False}},
                {"source": None},
                {"published_publicly": {"$ne": False}},
            ],
        }},
        {"$group": {"_id": None, "count": {"$sum": 1}, "sum": {"$sum": "$rating"}}},
    ]
    agg_rows = await db.reviews.aggregate(agg_pipeline).to_list(1)
    aggregate_rating = None
    if agg_rows and agg_rows[0]["count"] > 0:
        aggregate_rating = {
            "@type": "AggregateRating",
            "ratingValue": f"{round(agg_rows[0]['sum'] / agg_rows[0]['count'], 1):.1f}",
            "reviewCount": agg_rows[0]["count"],
            "bestRating": "5",
            "worstRating": "1",
        }

    # Schema.org Product structured data + BreadcrumbList (iter298 — adds
    # the breadcrumb to the search-result trail under each product entry).
    # iter302 — adds AggregateRating when ≥ 1 public review.
    import json as _json
    breadcrumb_items = [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{site}/"},
        {"@type": "ListItem", "position": 2, "name": "Shop", "item": f"{site}/shop"},
    ]
    if category:
        breadcrumb_items.append({
            "@type": "ListItem", "position": 3, "name": category,
            "item": f"{site}/shop?category={category}",
        })
    breadcrumb_items.append({
        "@type": "ListItem",
        "position": len(breadcrumb_items) + 1,
        "name": title_raw, "item": canonical,
    })
    product_node = {
        "@type": "Product",
        "name": title_raw,
        "description": _truncate(full_desc, 500) or desc,
        "image": img,
        "url": canonical,
        "brand": {"@type": "Brand", "name": maker or "Crafters Market"},
        "offers": {
            "@type": "Offer",
            "url": canonical,
            "priceCurrency": "USD",
            "price": f"{float(price):.2f}" if price is not None else "0.00",
            "availability": "https://schema.org/InStock" if in_stock else "https://schema.org/PreOrder",
            "itemCondition": "https://schema.org/NewCondition",
        },
    }
    if aggregate_rating:
        product_node["aggregateRating"] = aggregate_rating
    json_ld = _json.dumps({
        "@context": "https://schema.org/",
        "@graph": [
            product_node,
            {
                "@type": "BreadcrumbList",
                "itemListElement": breadcrumb_items,
            },
        ],
    }, separators=(",", ":"))

    html = _render_og_html(
        title=title, description=desc, image=img,
        canonical_url=canonical, redirect_url=canonical,
        extra_props=extras,
        body_html=body_html,
        json_ld=json_ld,
    )
    return HTMLResponse(content=html)


# ============================================================
# Community design file (shareable link target)
# ============================================================
# Design files are referenced by UUID, not slug, so the SLUG_RE guard
# doesn't fit — use a UUID-shaped guard instead. Falls back to /community
# on misses (same soft-404 pattern as products/makers).
_UUID_RE = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", re.IGNORECASE)


@router.get("/og/community/file/{file_id}", include_in_schema=False)
async def og_community_file(file_id: str, http_request: Request):
    """Crawler-targeted prerender for a community design file's share URL.

    Crawlers fetch this route directly (no JS), get rich OG / Twitter /
    Pinterest metadata + an indexable HTML body. Real browsers hit the
    meta-refresh and end up at /community#files .
    """
    if not _UUID_RE.match(file_id or ""):
        return _not_found_html("Design file", f"{_site()}/community")
    doc = await db.design_files.find_one(
        {"id": file_id, "deleted_at": None},
        {"_id": 0, "id": 1, "title": 1, "description": 1, "thumbnail_url": 1,
         "maker_name": 1, "maker_slug": 1, "uploader_id": 1,
         "file_type": 1, "variants": 1, "downloads": 1,
         "seo_tags": 1, "seo_description": 1},
    )
    if not doc:
        logger.info("[og_prerender] community file not found: %s", file_id)
        return _not_found_html("Design file", f"{_site()}/community")

    title_raw = (doc.get("title") or "").strip() or "Design Bundle"
    maker = (doc.get("maker_name") or "").strip()
    title = f"{title_raw}{' · ' + maker if maker else ''} — Crafters Market Design Files"
    full_desc = (doc.get("description") or "").strip()
    desc = (doc.get("seo_description") or "").strip() \
        or _truncate(full_desc, 200) \
        or "A community-shared design bundle from Crafters Market — free CNC, laser, and plasma-cut design files."
    img = (doc.get("thumbnail_url") or "").strip() or _placeholder_image()
    canonical = f"{_site()}/community/files/{file_id}"
    site = _site()

    seo_tags = doc.get("seo_tags") or []
    file_type = (doc.get("file_type") or "").upper()
    variants = doc.get("variants") or []
    formats = [file_type] + [(v.get("format") or "").upper() for v in variants]
    formats = [f for f in formats if f]

    # Pinterest Rich Pin "article:tag" + standard `keywords` meta tag.
    extras: list[tuple[str, str]] = [("og:type", "article")]
    for t in seo_tags[:10]:
        extras.append(("article:tag", t))
    if maker:
        extras.append(("article:author", maker))

    keywords_meta = ", ".join(seo_tags[:12])

    body_parts: list[str] = []
    body_parts.append(
        '<nav class="breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{site}/">Home</a> · <a href="{site}/community">Community</a>'
        f' · <span>{_esc(title_raw)}</span>'
        '</nav>'
    )
    if full_desc:
        body_parts.append(
            f'<section class="sect"><h2>About this bundle</h2>'
            f'<p>{_esc(full_desc[:1500])}</p></section>'
        )
    detail_lines: list[str] = []
    detail_lines.append(f"<li><strong>Formats included:</strong> {_esc(', '.join(formats))}</li>")
    if maker:
        detail_lines.append(f"<li><strong>Uploaded by:</strong> {_esc(maker)}</li>")
    if doc.get("downloads"):
        detail_lines.append(f"<li><strong>Downloads:</strong> {int(doc['downloads'])}</li>")
    if seo_tags:
        detail_lines.append(f"<li><strong>Tags:</strong> {_esc(', '.join(seo_tags[:10]))}</li>")
    body_parts.append(
        '<section class="sect"><h2>Bundle details</h2>'
        f'<ul>{"".join(detail_lines)}</ul></section>'
    )
    body_parts.append(
        '<section class="sect"><h2>Browse more</h2><ul>'
        f'<li><a href="{site}/community">All community design files</a></li>'
        f'<li><a href="{site}/shop">Shop hand-built originals</a></li>'
        f'<li><a href="{site}/custom-order">Request a custom order</a></li>'
        '</ul></section>'
    )
    body_html = "".join(body_parts)

    import json as _json
    json_ld = _json.dumps({
        "@context": "https://schema.org/",
        "@type": "CreativeWork",
        "name": title_raw,
        "description": _truncate(full_desc, 500) or desc,
        "image": img,
        "url": canonical,
        "keywords": keywords_meta,
        "author": {"@type": "Person", "name": maker or "Crafters Market community"},
        "encodingFormat": ", ".join(formats),
    }, separators=(",", ":"))

    html = _render_og_html(
        title=title, description=desc, image=img,
        canonical_url=canonical, redirect_url=f"{site}/community",
        extra_props=extras,
        body_html=body_html,
        json_ld=json_ld,
    )
    if keywords_meta:
        html = html.replace(
            "</head>",
            f'<meta name="keywords" content="{_esc(keywords_meta)}" /></head>',
            1,
        )
    return HTMLResponse(content=html)


# ============================================================
# Maker
# ============================================================
@router.get("/og/maker/{slug}", include_in_schema=False)
async def og_maker(slug: str, http_request: Request):
    if not _SLUG_RE.match(slug or ""):
        return _not_found_html("Maker", f"{_site()}/makers")
    doc = await db.makers.find_one(
        {"slug": slug},
        {"_id": 0, "name": 1, "bio": 1, "tagline": 1, "cover": 1,
         "banner_image_url": 1, "is_veteran_owned": 1, "location": 1,
         "techniques": 1, "headline": 1},
    )
    if not doc:
        logger.info("[og_prerender] maker slug not found: %s", slug)
        return _not_found_html("Maker", f"{_site()}/makers")

    name = (doc.get("name") or "").strip() or slug
    location = (doc.get("location") or "").strip()
    title = f"{name} — Crafters Market"
    full_bio = (doc.get("bio") or "").strip()
    tagline = (doc.get("tagline") or doc.get("headline") or "").strip()
    desc_src = tagline or full_bio \
        or f"{name} — vetted independent maker on Crafters Market. Hand-built CNC art and made-to-order originals, no mass production."
    desc = _truncate(desc_src, 200)
    if doc.get("is_veteran_owned"):
        desc = ("◆ Veteran-Owned · " + desc)[:220]
    img = (doc.get("banner_image_url") or doc.get("cover") or _placeholder_image())
    canonical = f"{_site()}/makers/{slug}"
    site = _site()

    # Pull a few of this maker's most recent published listings to add
    # real internal links + topical relevance for crawlers.
    listings = await db.products.find(
        {"maker_slug": slug, "deleted_at": None, "status": {"$ne": "draft"}},
        {"_id": 0, "slug": 1, "title": 1, "price": 1},
    ).sort("created_at", -1).limit(6).to_list(6)
    techniques = doc.get("techniques") or []

    body_parts: list[str] = []
    body_parts.append(
        '<nav class="breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{site}/">Home</a> · <a href="{site}/makers">Makers</a> · '
        f'<span>{_esc(name)}</span>'
        '</nav>'
    )
    if full_bio:
        body_parts.append(
            f'<section class="sect"><h2>About {_esc(name)}</h2>'
            f'<p>{_esc(full_bio[:1500])}</p></section>'
        )
    facts: list[str] = []
    if location:
        facts.append(f"<li><strong>Based in:</strong> {_esc(location)}</li>")
    if techniques:
        facts.append(f"<li><strong>Techniques:</strong> {_esc(', '.join(techniques[:6]))}</li>")
    if doc.get("is_veteran_owned"):
        facts.append("<li><strong>Veteran-owned</strong> — supported on Crafters Market.</li>")
    facts.append("<li><strong>Marketplace:</strong> Independent maker on Crafters Market.</li>")
    body_parts.append(
        f'<section class="sect"><h2>About this shop</h2><ul>{"".join(facts)}</ul></section>'
    )
    if listings:
        list_items = "".join(
            f'<li><a href="{site}/shop/{_esc(p.get("slug",""))}">{_esc(p.get("title",""))}'
            f'{" — $" + str(int(p["price"])) if p.get("price") else ""}</a></li>'
            for p in listings
        )
        body_parts.append(
            '<section class="sect"><h2>Recent listings</h2>'
            f'<ul>{list_items}</ul></section>'
        )
    body_parts.append(
        '<section class="sect"><h2>Explore the marketplace</h2><ul>'
        f'<li><a href="{site}/shop">Browse all listings</a></li>'
        f'<li><a href="{site}/makers">Other vetted makers</a></li>'
        f'<li><a href="{site}/custom-order">Request a custom order</a></li>'
        '</ul></section>'
    )
    body_html = "".join(body_parts)

    # AggregateRating for the maker (iter302) — sum of public reviews
    # explicitly tagged with this maker_slug. Sourced from the same
    # `db.reviews` collection as the product aggregate.
    maker_agg_rows = await db.reviews.aggregate([
        {"$match": {
            "maker_slug": slug,
            "$or": [
                {"source": {"$exists": False}},
                {"source": None},
                {"published_publicly": {"$ne": False}},
            ],
        }},
        {"$group": {"_id": None, "count": {"$sum": 1}, "sum": {"$sum": "$rating"}}},
    ]).to_list(1)
    maker_aggregate_rating = None
    if maker_agg_rows and maker_agg_rows[0]["count"] > 0:
        maker_aggregate_rating = {
            "@type": "AggregateRating",
            "ratingValue": f"{round(maker_agg_rows[0]['sum'] / maker_agg_rows[0]['count'], 1):.1f}",
            "reviewCount": maker_agg_rows[0]["count"],
            "bestRating": "5",
            "worstRating": "1",
        }

    import json as _json
    person_node = {
        "@type": "Person",
        "name": name,
        "description": _truncate(full_bio or tagline or desc, 500),
        "image": img,
        "url": canonical,
        "address": {"@type": "PostalAddress", "addressLocality": location} if location else None,
        "knowsAbout": techniques[:6] if techniques else None,
    }
    if maker_aggregate_rating:
        person_node["aggregateRating"] = maker_aggregate_rating
    json_ld = _json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            person_node,
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{site}/"},
                    {"@type": "ListItem", "position": 2, "name": "Makers", "item": f"{site}/makers"},
                    {"@type": "ListItem", "position": 3, "name": name, "item": canonical},
                ],
            },
        ],
    }, separators=(",", ":"), default=str)

    html = _render_og_html(
        title=title, description=desc, image=img,
        canonical_url=canonical, redirect_url=canonical,
        extra_props=[("og:type", "profile")],
        body_html=body_html,
        json_ld=json_ld,
    )
    return HTMLResponse(content=html)


# ============================================================
# Journal post
# ============================================================
@router.get("/og/journal/{slug}", include_in_schema=False)
async def og_journal(slug: str, http_request: Request):
    if not _SLUG_RE.match(slug or ""):
        return _not_found_html("Journal post", f"{_site()}/journal")
    doc = await db.blog_posts.find_one(
        {"slug": slug},
        {"_id": 0, "title": 1, "excerpt": 1, "summary": 1, "cover": 1,
         "author": 1, "created_at": 1, "body": 1, "content": 1},
    )
    if not doc:
        logger.info("[og_prerender] journal slug not found: %s", slug)
        return _not_found_html("Journal post", f"{_site()}/journal")

    title_raw = (doc.get("title") or "").strip() or slug
    title = f"{title_raw} — Crafters Market"
    excerpt = (doc.get("excerpt") or doc.get("summary") or "").strip()
    desc = _truncate(excerpt or "", 200) \
        or "Notes, builds, and behind-the-scenes from the makers and team at Crafters Market."
    img = doc.get("cover") or _placeholder_image()
    canonical = f"{_site()}/journal/{slug}"
    site = _site()
    body_text = (doc.get("body") or doc.get("content") or excerpt or "").strip()
    # Strip HTML tags lightly for the SEO body — full markup lives on the SPA page.
    import re as _re
    body_plain = _re.sub(r"<[^>]+>", " ", body_text)
    body_plain = _re.sub(r"\s+", " ", body_plain).strip()
    author = (doc.get("author") or "").strip()
    created = str(doc.get("created_at") or "")[:10]

    extras: list[tuple[str, str]] = [("og:type", "article")]
    if author:
        extras.append(("article:author", author))
    if created:
        extras.append(("article:published_time", created))

    body_parts: list[str] = []
    body_parts.append(
        '<nav class="breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{site}/">Home</a> · <a href="{site}/journal">Journal</a> · '
        f'<span>{_esc(title_raw)}</span>'
        '</nav>'
    )
    if body_plain:
        body_parts.append(
            f'<section class="sect"><h2>Article</h2>'
            f'<p>{_esc(body_plain[:2000])}</p></section>'
        )
    meta_lines: list[str] = []
    if author:
        meta_lines.append(f"<li><strong>Author:</strong> {_esc(author)}</li>")
    if created:
        meta_lines.append(f"<li><strong>Published:</strong> {_esc(created)}</li>")
    if meta_lines:
        body_parts.append(
            f'<section class="sect"><h2>Details</h2><ul>{"".join(meta_lines)}</ul></section>'
        )
    body_parts.append(
        '<section class="sect"><h2>Keep reading</h2><ul>'
        f'<li><a href="{site}/journal">More on the workshop journal</a></li>'
        f'<li><a href="{site}/shop">Browse the shop</a></li>'
        f'<li><a href="{site}/makers">Meet the makers</a></li>'
        '</ul></section>'
    )
    body_html = "".join(body_parts)

    import json as _json
    json_ld = _json.dumps({
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": title_raw,
        "description": desc,
        "image": img,
        "url": canonical,
        "datePublished": created or None,
        "author": {"@type": "Person", "name": author} if author else None,
        "publisher": {"@type": "Organization", "name": "Crafters Market"},
    }, separators=(",", ":"), default=str)

    html = _render_og_html(
        title=title, description=desc, image=img,
        canonical_url=canonical, redirect_url=canonical,
        extra_props=extras,
        body_html=body_html,
        json_ld=json_ld,
    )
    return HTMLResponse(content=html)


# ============================================================
# Shop index — `/shop` crawler prerender (iter298)
# ============================================================
@router.get("/og/shop", include_in_schema=False)
async def og_shop_index(http_request: Request):
    """Crawler-targeted prerender for the `/shop` catalog index page.

    Returns an ItemList JSON-LD + crawlable HTML grid of the latest
    published listings. Real browsers hit the meta-refresh and end up on
    the SPA at `/shop`; crawlers index the static catalog grid + schema.
    """
    site = _site()
    products = await db.products.find(
        {"deleted_at": None, "status": {"$ne": "draft"}},
        {"_id": 0, "slug": 1, "title": 1, "price": 1, "images": 1,
         "category": 1, "maker_name": 1},
    ).sort("created_at", -1).limit(48).to_list(48)

    title = "Shop — Handmade Metal Signs, CNC Wood Signs & Laser-Cut Art | Crafters Market"
    desc = (
        "Browse handcrafted metal signs, CNC wood signs, plasma-cut wall art, "
        "and laser-engraved cutting boards from vetted independent US makers. "
        "Made-to-order, ships nationwide, Stripe-secured checkout."
    )
    canonical = f"{site}/shop"
    img = _placeholder_image()
    if products and (products[0].get("images") or []):
        img = (products[0]["images"] or [_placeholder_image()])[0]

    # Indexable HTML grid of the latest listings — each entry an
    # internal link the crawler can follow into the per-product
    # prerender (which already has Product + BreadcrumbList JSON-LD).
    body_parts: list[str] = []
    body_parts.append(
        '<nav class="breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{site}/">Home</a> · <span>Shop</span>'
        '</nav>'
    )
    body_parts.append(
        '<section class="sect"><h2>What you can buy on Crafters Market</h2>'
        '<p>Every listing below is hand-built by a vetted independent maker — '
        'plasma-cut metal signs, CNC-routed wood signs, laser-engraved cutting boards, '
        'monogrammed wall art, and one-off custom pieces. No mass production, no '
        'drop-shipping, no overseas re-branding.</p></section>'
    )
    if products:
        list_items = "".join(
            f'<li><a href="{site}/shop/{_esc(p.get("slug",""))}">'
            f'{_esc(p.get("title", ""))}'
            f'{" — $" + str(int(p["price"])) if p.get("price") else ""}'
            f'{" · " + _esc(p["maker_name"]) if p.get("maker_name") else ""}'
            f'</a></li>'
            for p in products
        )
        body_parts.append(
            '<section class="sect"><h2>Latest listings</h2>'
            f'<ul>{list_items}</ul></section>'
        )
    body_parts.append(
        '<section class="sect"><h2>Explore by category</h2><ul>'
        f'<li><a href="{site}/custom-metal-signs">Custom metal signs</a></li>'
        f'<li><a href="{site}/cnc-metal-wall-art">CNC metal wall art</a></li>'
        f'<li><a href="{site}/cnc-laser-art">CNC &amp; laser art</a></li>'
        f'<li><a href="{site}/personalized-gifts">Personalized gifts</a></li>'
        f'<li><a href="{site}/wedding-gifts">Wedding gifts</a></li>'
        f'<li><a href="{site}/outdoor-metal-decor">Outdoor metal decor</a></li>'
        f'<li><a href="{site}/business-signs">Business signs</a></li>'
        f'<li><a href="{site}/makers">Meet the makers</a></li>'
        f'<li><a href="{site}/custom-order">Request a custom order</a></li>'
        '</ul></section>'
    )
    body_html = "".join(body_parts)

    import json as _json
    item_list = [
        {
            "@type": "ListItem",
            "position": i + 1,
            "url": f"{site}/shop/{p.get('slug','')}",
            "name": p.get("title", "") or p.get("slug", ""),
        }
        for i, p in enumerate(products[:24])
    ]
    json_ld = _json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "CollectionPage",
                "name": "Shop · Crafters Market",
                "url": canonical,
                "description": desc,
                "isPartOf": {"@id": f"{site}/#website"},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{site}/"},
                    {"@type": "ListItem", "position": 2, "name": "Shop", "item": canonical},
                ],
            },
            {
                "@type": "ItemList",
                "name": "Latest listings on Crafters Market",
                "numberOfItems": len(item_list),
                "itemListElement": item_list,
            },
        ],
    }, separators=(",", ":"))

    html = _render_og_html(
        title=title, description=desc, image=img,
        canonical_url=canonical, redirect_url=canonical,
        extra_props=[("og:type", "website")],
        body_html=body_html,
        json_ld=json_ld,
    )
    return HTMLResponse(content=html)


# ============================================================
# Makers index — `/makers` crawler prerender (iter298)
# ============================================================
@router.get("/og/makers", include_in_schema=False)
async def og_makers_index(http_request: Request):
    """Crawler-targeted prerender for the `/makers` index page.

    Returns an ItemList JSON-LD + crawlable list of all vetted makers
    with internal links into each maker's prerender. Real browsers
    bounce to the SPA at `/makers`.
    """
    site = _site()
    makers = await db.makers.find(
        {}, {"_id": 0, "slug": 1, "name": 1, "location": 1, "tagline": 1,
             "headline": 1, "techniques": 1, "is_veteran_owned": 1},
    ).sort("created_at", -1).limit(100).to_list(100)

    title = "Meet the Makers — Vetted CNC, Plasma & Laser Artisans | Crafters Market"
    desc = (
        "Browse every vetted independent maker on Crafters Market — plasma-cutters, "
        "CNC routers, laser engravers, and woodworkers shipping handcrafted goods "
        "nationwide. Read their stories, see their workshops, message them directly."
    )
    canonical = f"{site}/makers"
    img = _placeholder_image()

    body_parts: list[str] = []
    body_parts.append(
        '<nav class="breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{site}/">Home</a> · <span>Makers</span>'
        '</nav>'
    )
    body_parts.append(
        '<section class="sect"><h2>Vetted independent makers, no factories</h2>'
        '<p>Every maker below was hand-vetted by the Crafters Market team — we verified '
        'workshop photos, machines, and past commissions before approving them to list. '
        'No drop-shippers, no overseas re-branding, no warehouse middlemen. Just '
        'real artisans running real shops across the United States.</p></section>'
    )
    if makers:
        list_items = "".join(
            f'<li><a href="{site}/makers/{_esc(m.get("slug",""))}">'
            f'{_esc(m.get("name", "") or m.get("slug", ""))}'
            f'{" · " + _esc(m["location"]) if m.get("location") else ""}'
            f'{" · Veteran-owned" if m.get("is_veteran_owned") else ""}'
            f'</a>'
            f'{" — " + _esc(m["tagline"] or m["headline"] or "") if (m.get("tagline") or m.get("headline")) else ""}'
            f'</li>'
            for m in makers[:60]
        )
        body_parts.append(
            '<section class="sect"><h2>All makers</h2>'
            f'<ul>{list_items}</ul></section>'
        )
    body_parts.append(
        '<section class="sect"><h2>Looking for something specific?</h2><ul>'
        f'<li><a href="{site}/shop">Browse all listings</a></li>'
        f'<li><a href="{site}/custom-order">Request a custom build</a></li>'
        f'<li><a href="{site}/apply">Apply to sell on Crafters Market</a></li>'
        '</ul></section>'
    )
    body_html = "".join(body_parts)

    import json as _json
    item_list = [
        {
            "@type": "ListItem",
            "position": i + 1,
            "url": f"{site}/makers/{m.get('slug','')}",
            "name": m.get("name", "") or m.get("slug", ""),
        }
        for i, m in enumerate(makers[:24])
    ]
    json_ld = _json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "CollectionPage",
                "name": "Meet the Makers · Crafters Market",
                "url": canonical,
                "description": desc,
                "isPartOf": {"@id": f"{site}/#website"},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{site}/"},
                    {"@type": "ListItem", "position": 2, "name": "Makers", "item": canonical},
                ],
            },
            {
                "@type": "ItemList",
                "name": "Vetted makers on Crafters Market",
                "numberOfItems": len(item_list),
                "itemListElement": item_list,
            },
        ],
    }, separators=(",", ":"))

    html = _render_og_html(
        title=title, description=desc, image=img,
        canonical_url=canonical, redirect_url=canonical,
        extra_props=[("og:type", "website")],
        body_html=body_html,
        json_ld=json_ld,
    )
    return HTMLResponse(content=html)


# ============================================================
# Diagnostics
# ============================================================
@router.get("/og/diag")
async def og_prerender_diag():
    """Public health check: returns a sample of slugs the prerender
    routes can serve right now. Useful for verifying the catalog → OG
    pipeline after a deploy without leaving the admin dashboard."""
    products = await db.products.find(
        {"deleted_at": None, "status": {"$ne": "draft"}},
        {"_id": 0, "slug": 1, "title": 1},
    ).limit(3).to_list(3)
    makers = await db.makers.find({}, {"_id": 0, "slug": 1, "name": 1}).limit(3).to_list(3)
    posts = await db.blog_posts.find({}, {"_id": 0, "slug": 1, "title": 1}).limit(3).to_list(3)
    site = _site()
    return {
        "site_root": site,
        "indexes": {
            "shop":   {"og_url": f"{site}/api/og/shop",   "spa_url": f"{site}/shop"},
            "makers": {"og_url": f"{site}/api/og/makers", "spa_url": f"{site}/makers"},
        },
        "samples": {
            "products": [
                {"slug": p["slug"], "og_url": f"{site}/api/og/product/{p['slug']}",
                 "spa_url": f"{site}/shop/{p['slug']}"}
                for p in products
            ],
            "makers": [
                {"slug": m["slug"], "og_url": f"{site}/api/og/maker/{m['slug']}",
                 "spa_url": f"{site}/makers/{m['slug']}"}
                for m in makers
            ],
            "journal": [
                {"slug": b["slug"], "og_url": f"{site}/api/og/journal/{b['slug']}",
                 "spa_url": f"{site}/journal/{b['slug']}"}
                for b in posts
            ],
        },
    }
