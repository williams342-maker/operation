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
from fastapi.responses import HTMLResponse, RedirectResponse

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
) -> str:
    """Build a minimal, crawler-perfect HTML doc.

    Real browsers honor the `meta http-equiv=refresh` and bounce to
    `redirect_url`. Crawlers ignore the refresh and read the meta tags."""
    # Allow callers to override `og:type` (e.g. "product", "profile",
    # "article") via extra_props. Having TWO og:type tags is invalid OG
    # and crawlers may pick either at random — pull the override out of
    # the extras list and let it replace the default cleanly.
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
    return (
        "<!doctype html>"
        "<html lang=\"en\"><head>"
        "<meta charset=\"utf-8\" />"
        f"<title>{_esc(title)}</title>"
        f"<meta name=\"description\" content=\"{_esc(description)}\" />"
        f"<link rel=\"canonical\" href=\"{_esc(canonical_url)}\" />"
        # OG / Facebook / LinkedIn / Discord / Slack / Pinterest
        f"<meta property=\"og:type\" content=\"{_esc(og_type)}\" />"
        "<meta property=\"og:site_name\" content=\"Crafters Market\" />"
        f"<meta property=\"og:title\" content=\"{_esc(title)}\" />"
        f"<meta property=\"og:description\" content=\"{_esc(description)}\" />"
        f"<meta property=\"og:url\" content=\"{_esc(canonical_url)}\" />"
        f"<meta property=\"og:image\" content=\"{_esc(image)}\" />"
        f"<meta property=\"og:image:alt\" content=\"{_esc(title)}\" />"
        f"{extras}"
        # Twitter / X
        f"<meta name=\"twitter:card\" content=\"{_esc(twitter_card)}\" />"
        f"<meta name=\"twitter:title\" content=\"{_esc(title)}\" />"
        f"<meta name=\"twitter:description\" content=\"{_esc(description)}\" />"
        f"<meta name=\"twitter:image\" content=\"{_esc(image)}\" />"
        # Real-browser fallback — crawlers ignore http-equiv refresh.
        f"<meta http-equiv=\"refresh\" content=\"0; url={_esc(redirect_url)}\" />"
        "<style>body{margin:0;background:#0a0a0a;color:#e5e5e5;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}"
        ".w{max-width:560px;margin:0 auto;padding:120px 24px;text-align:center}"
        "a{color:#ff4500;text-decoration:none;font-weight:700;font-size:12px;letter-spacing:0.18em;text-transform:uppercase}"
        "</style>"
        "</head><body>"
        # Visible content for the rare human who lands here directly with
        # JS-disabled or an aggressive ad-blocker that kills meta-refresh.
        "<div class=\"w\">"
        f"<p style=\"font-size:11px;letter-spacing:0.32em;color:#ff4500;text-transform:uppercase;margin:0 0 18px\">◆ Crafters Market</p>"
        f"<h1 style=\"font-family:Impact,Anton,sans-serif;font-size:40px;line-height:1.05;letter-spacing:-0.01em;margin:0 0 24px;text-transform:uppercase\">{_esc(title)}</h1>"
        f"<p style=\"font-size:13px;color:#a3a3a3;line-height:1.7;margin:0 0 32px\">{_esc(description)}</p>"
        f"<p><a href=\"{_esc(redirect_url)}\">Open the page →</a></p>"
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


# ============================================================
# Product
# ============================================================
@router.get("/og/product/{slug}", include_in_schema=False)
async def og_product(slug: str, http_request: Request):
    """Crawler-targeted prerender for a product detail page."""
    if not _SLUG_RE.match(slug or ""):
        return RedirectResponse(f"{_site()}/shop", status_code=302)
    doc = await db.products.find_one(
        {"slug": slug, "deleted_at": None, "status": {"$ne": "draft"}},
        {"_id": 0, "title": 1, "description": 1, "images": 1, "price": 1,
         "maker_name": 1, "maker_slug": 1},
    )
    if not doc:
        # Soft-404: bounce to /shop instead of 404 so a stale share link
        # still lands the user somewhere useful.
        logger.info("[og_prerender] product slug not found: %s", slug)
        return RedirectResponse(f"{_site()}/shop", status_code=302)

    title_raw = (doc.get("title") or "").strip() or slug
    maker = (doc.get("maker_name") or "").strip()
    title = f"{title_raw}{' · ' + maker if maker else ''} — Crafters Market"
    desc = _truncate(doc.get("description") or "", 200) \
        or f"Hand-built by {maker or 'a vetted independent maker'} on Crafters Market — curated CNC art, custom signs, and made-to-order originals."
    img = ((doc.get("images") or [None])[0]) or _placeholder_image()
    canonical = f"{_site()}/shop/{slug}"

    extras: list[tuple[str, str]] = []
    if doc.get("price") is not None:
        extras.append(("product:price:amount", f"{float(doc['price']):.2f}"))
        extras.append(("product:price:currency", "USD"))
        extras.append(("og:type", "product"))  # overrides "website" above

    html = _render_og_html(
        title=title, description=desc, image=img,
        canonical_url=canonical, redirect_url=canonical,
        extra_props=extras,
    )
    return HTMLResponse(content=html)


# ============================================================
# Maker
# ============================================================
@router.get("/og/maker/{slug}", include_in_schema=False)
async def og_maker(slug: str, http_request: Request):
    if not _SLUG_RE.match(slug or ""):
        return RedirectResponse(f"{_site()}/makers", status_code=302)
    doc = await db.makers.find_one(
        {"slug": slug},
        {"_id": 0, "name": 1, "bio": 1, "tagline": 1, "cover": 1,
         "banner_image_url": 1, "is_veteran_owned": 1},
    )
    if not doc:
        logger.info("[og_prerender] maker slug not found: %s", slug)
        return RedirectResponse(f"{_site()}/makers", status_code=302)

    name = (doc.get("name") or "").strip() or slug
    title = f"{name} — Crafters Market"
    desc_src = (doc.get("tagline") or doc.get("bio") or "").strip() \
        or f"{name} — vetted independent maker on Crafters Market. Hand-built CNC art and made-to-order originals, no mass production."
    desc = _truncate(desc_src, 200)
    if doc.get("is_veteran_owned"):
        desc = ("◆ Veteran-Owned · " + desc)[:220]
    img = (doc.get("banner_image_url") or doc.get("cover") or _placeholder_image())
    canonical = f"{_site()}/makers/{slug}"

    html = _render_og_html(
        title=title, description=desc, image=img,
        canonical_url=canonical, redirect_url=canonical,
        extra_props=[("og:type", "profile")],
    )
    return HTMLResponse(content=html)


# ============================================================
# Journal post
# ============================================================
@router.get("/og/journal/{slug}", include_in_schema=False)
async def og_journal(slug: str, http_request: Request):
    if not _SLUG_RE.match(slug or ""):
        return RedirectResponse(f"{_site()}/journal", status_code=302)
    doc = await db.blog_posts.find_one(
        {"slug": slug},
        {"_id": 0, "title": 1, "excerpt": 1, "summary": 1, "cover": 1,
         "author": 1, "created_at": 1},
    )
    if not doc:
        logger.info("[og_prerender] journal slug not found: %s", slug)
        return RedirectResponse(f"{_site()}/journal", status_code=302)

    title_raw = (doc.get("title") or "").strip() or slug
    title = f"{title_raw} — Crafters Market"
    desc = _truncate(doc.get("excerpt") or doc.get("summary") or "", 200) \
        or "Notes, builds, and behind-the-scenes from the makers and team at Crafters Market."
    img = doc.get("cover") or _placeholder_image()
    canonical = f"{_site()}/journal/{slug}"

    extras: list[tuple[str, str]] = [("og:type", "article")]
    if doc.get("author"):
        extras.append(("article:author", str(doc["author"])))
    if doc.get("created_at"):
        extras.append(("article:published_time", str(doc["created_at"])[:10]))

    html = _render_og_html(
        title=title, description=desc, image=img,
        canonical_url=canonical, redirect_url=canonical,
        extra_props=extras,
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
