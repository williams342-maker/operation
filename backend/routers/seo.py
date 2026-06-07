"""SEO endpoints: sitemap.xml + robots.txt.

Sitemap conforms to sitemap.org 0.9 + Google's image extension. Robots is
intentionally welcoming to all major web crawlers AND AI crawlers
(GPTBot, ClaudeBot, PerplexityBot, etc.) — products show up as cited
results in AI answers, which is free distribution.
"""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse, Response

from core import db, site_root
from maker_auth import current_admin

router = APIRouter()


# SEO buyer-intent landing pages — mirror the slugs declared in
# frontend/src/pages/seoLandingConfig.js. Kept here so analytics &
# sitemap can reuse a single source of truth (Python side).
SEO_LANDING_SLUGS: tuple[str, ...] = (
    "cnc-metal-art", "cnc-laser-art", "cnc-manufacturing", "cnc-usa",
    "artisan-marketplace", "custom-handmade-goods",
    # Buyer-intent landing pages (iter177)
    "custom-metal-signs", "personalized-gifts", "farmhouse-decor",
    "garage-decor", "rustic-cabin-decor", "wedding-gifts",
    "memorial-pieces", "outdoor-metal-decor", "business-signs",
    "patriotic-decor", "custom-ranch-signs", "cnc-metal-wall-art",
    "handmade-gifts-for-dad",
    # SEO/Trust audit — category landing pages (iter321)
    "plasma-cut-wall-art", "cnc-wood-signs", "laser-engraved-gifts",
    "custom-address-signs", "engraved-cutting-boards",
)
SEO_LANDING_PATHS: tuple[str, ...] = tuple(f"/{s}" for s in SEO_LANDING_SLUGS)


# Any slug matching one of these patterns is considered a test/seed
# artifact and stripped from the sitemap. Google won't crawl it and
# we won't get dinged for low-quality content in Search Console.
#
# These patterns are narrow by design — we'd rather let a test slug
# slip through occasionally than strip a real listing titled "test-
# driven-signage" or "iterations-on-oak". Every pattern here must
# contain a signal that ONLY test/seed data would plausibly produce
# (iter digit suffix, hex UUID fragment, etc.).
_TEST_SLUG_PATTERNS: tuple[re.Pattern, ...] = (
    re.compile(r"^iter\d+[-_]", re.IGNORECASE),              # iter9-*, iter21-*
    re.compile(r"^final[-_]test($|[-_])", re.IGNORECASE),    # final-test, final-test-*
    re.compile(r"^api[-_]test($|[-_])", re.IGNORECASE),      # api-test, api-test-*
    re.compile(r"^test[-_]iter\d", re.IGNORECASE),           # test-iter21-*, TEST_iter68_*
    re.compile(r"^test[-_](studio|allowed)", re.IGNORECASE), # test-studio, test-allowedstudio-*
    re.compile(r"[-_]iter\d+[-_]", re.IGNORECASE),           # *-iter21-bg-*, *_iter18_*
    re.compile(r"[-_](bg|suffix)[-_][a-f0-9]{6,}$", re.IGNORECASE),  # *-bg-ba4bba
)


def _is_test_slug(slug: str) -> bool:
    """True if a slug looks like a test/seed artifact."""
    if not slug:
        return True
    return any(p.search(slug) for p in _TEST_SLUG_PATTERNS)


def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;").replace("<", "&lt;")
        .replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")
    )


@router.get("/sitemap.xml")
async def sitemap_xml(http_request: Request):
    root = site_root(http_request)
    today = datetime.now(timezone.utc).date().isoformat()

    # Curated priority + change-frequency hints (Google ignores priority but
    # still uses changefreq as a soft signal).
    static = [
        ("/",              "daily",   "1.0"),
        ("/shop",          "daily",   "0.9"),
        ("/makers",        "daily",   "0.9"),
        # SEO landing pages — keyword-targeted, mirror the slugs declared in
        # frontend/src/pages/seoLandingConfig.js (SEO_LANDING_SLUGS). Bumped
        # priority because these are designed to convert organic traffic.
        ("/cnc-metal-art",         "weekly", "0.85"),
        ("/cnc-laser-art",         "weekly", "0.85"),
        ("/cnc-manufacturing",     "weekly", "0.80"),
        ("/cnc-usa",               "weekly", "0.80"),
        ("/artisan-marketplace",   "weekly", "0.80"),
        ("/custom-handmade-goods", "weekly", "0.80"),
        # Buyer-intent landing pages (iter177) — high-converting search
        # phrases. Higher priority because each has direct purchase
        # intent (vs the maker-focused phrases above).
        ("/custom-metal-signs",    "weekly", "0.85"),
        ("/personalized-gifts",    "weekly", "0.85"),
        ("/farmhouse-decor",       "weekly", "0.80"),
        ("/garage-decor",          "weekly", "0.80"),
        ("/rustic-cabin-decor",    "weekly", "0.80"),
        ("/wedding-gifts",         "weekly", "0.85"),
        ("/memorial-pieces",       "weekly", "0.75"),
        ("/outdoor-metal-decor",   "weekly", "0.80"),
        ("/business-signs",        "weekly", "0.80"),
        ("/patriotic-decor",       "weekly", "0.80"),
        ("/custom-ranch-signs",    "weekly", "0.75"),
        ("/cnc-metal-wall-art",    "weekly", "0.85"),
        ("/handmade-gifts-for-dad", "weekly", "0.75"),
        # iter321 — SEO/Trust audit category landing pages. High priority
        # because each maps to a clear product-search intent.
        ("/plasma-cut-wall-art",     "weekly", "0.85"),
        ("/cnc-wood-signs",          "weekly", "0.85"),
        ("/laser-engraved-gifts",    "weekly", "0.85"),
        ("/custom-address-signs",    "weekly", "0.85"),
        ("/engraved-cutting-boards", "weekly", "0.85"),
        # Phase-3 SEO hub (iter300) — content page bridging landing
        # pages to the /custom-order form. High priority because it
        # converts informational searches into commission briefs.
        ("/how-custom-orders-work", "monthly", "0.85"),
        # Phase-4-C lead magnet (iter303) — free SVG/DXF starter pack.
        # High priority because it's an external-backlink magnet (CNC
        # forums, subreddits, maker blogs love free starter packs).
        ("/free-svg-pack", "weekly", "0.9"),
        # Phase-4 content guides (iter301) — educational hub linking to
        # both buyer-intent landing pages and product listings. Each
        # ships HowTo + FAQPage JSON-LD.
        ("/guides/plasma-vs-laser-vs-router", "monthly", "0.80"),
        ("/guides/outdoor-mounting-guide",    "monthly", "0.80"),
        ("/guides/metal-gauge-finish-guide",  "monthly", "0.80"),
        ("/journal",       "weekly",  "0.7"),
        ("/updates",       "weekly",  "0.6"),
        ("/custom-order",  "monthly", "0.6"),
        ("/apply",         "monthly", "0.5"),
        ("/contact",       "monthly", "0.4"),
        ("/policy",        "yearly",  "0.2"),
    ]
    products = await db.products.find(
        {"deleted_at": None, "status": {"$ne": "draft"}},
        {"_id": 0, "slug": 1, "created_at": 1, "images": 1, "title": 1},
    ).to_list(2000)
    makers = await db.makers.find(
        {}, {"_id": 0, "slug": 1, "created_at": 1, "name": 1, "cover": 1, "banner_image_url": 1, "location": 1},
    ).to_list(2000)
    posts = await db.blog_posts.find(
        {}, {"_id": 0, "slug": 1, "created_at": 1, "cover": 1, "title": 1},
    ).to_list(2000)

    def _u(path: str, lastmod: str | None = None,
           changefreq: str | None = None, priority: str | None = None,
           images: list[tuple[str, str]] | None = None) -> str:
        parts = [f"<loc>{root}{path}</loc>"]
        if lastmod:
            parts.append(f"<lastmod>{lastmod[:10]}</lastmod>")
        if changefreq:
            parts.append(f"<changefreq>{changefreq}</changefreq>")
        if priority:
            parts.append(f"<priority>{priority}</priority>")
        for src, caption in (images or []):
            if not src:
                continue
            parts.append(
                "<image:image>"
                f"<image:loc>{_xml_escape(src)}</image:loc>"
                f"<image:title>{_xml_escape(caption)}</image:title>"
                "</image:image>"
            )
        return "<url>" + "".join(parts) + "</url>"

    urls = [_u(p, today, cf, pr) for p, cf, pr in static]
    for p in products:
        if _is_test_slug(p.get("slug", "")):
            continue  # strip test/seed listings from the public sitemap
        imgs = [(img, p.get("title") or "") for img in (p.get("images") or [])[:3]]
        urls.append(_u(
            f"/shop/{p['slug']}", p.get("created_at"),
            "weekly", "0.8", imgs,
        ))
    for m in makers:
        if _is_test_slug(m.get("slug", "")):
            continue
        cover = m.get("banner_image_url") or m.get("cover")
        imgs = [(cover, m.get("name") or "")] if cover else []
        urls.append(_u(
            f"/makers/{m['slug']}", m.get("created_at"),
            "weekly", "0.7", imgs,
        ))
    for b in posts:
        if _is_test_slug(b.get("slug", "")):
            continue
        imgs = [(b["cover"], b.get("title") or "")] if b.get("cover") else []
        urls.append(_u(
            f"/journal/{b['slug']}", b.get("created_at"),
            "monthly", "0.6", imgs,
        ))

    # State landing pages (iter301) — only include states that actually
    # have ≥ 1 maker. We'd rather ship 13 dense pages than 50 thin
    # doorway pages, which Google deprioritizes.
    from routers.state_pages import state_for_location  # local import to avoid cycles
    state_counts: dict[str, int] = {}
    for m in makers:
        code = state_for_location(m.get("location"))
        if code:
            state_counts[code] = state_counts.get(code, 0) + 1
    for code in sorted(state_counts.keys()):
        urls.append(_u(
            f"/makers/state/{code.lower()}", today,
            "weekly", "0.75",
        ))

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
        ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">'
        + "".join(urls) + "</urlset>"
    )
    return Response(content=xml, media_type="application/xml")


@router.get("/seo/diag")
async def seo_diagnostics(http_request: Request):
    """Public SEO health check — confirms the sitemap and robots.txt are
    wired correctly. Returns what `site_root` resolves to (with/without
    env vars), the URL counts, and whether preview-domain leakage is
    happening.

    Safe to hit from any browser; helps operators verify that a deploy
    picked up `PUBLIC_SITE_URL` without needing SSH.
    """
    import os
    root = site_root(http_request)
    fwd_host = http_request.headers.get("x-forwarded-host") or ""

    products_all = await db.products.find(
        {"deleted_at": None, "status": {"$ne": "draft"}}, {"_id": 0, "slug": 1},
    ).to_list(2000)
    makers_all = await db.makers.find({}, {"_id": 0, "slug": 1}).to_list(2000)
    posts_all = await db.blog_posts.find({}, {"_id": 0, "slug": 1}).to_list(2000)
    products_n = sum(1 for p in products_all if not _is_test_slug(p.get("slug", "")))
    makers_n = sum(1 for m in makers_all if not _is_test_slug(m.get("slug", "")))
    posts_n = sum(1 for b in posts_all if not _is_test_slug(b.get("slug", "")))
    stripped = {
        "products": len(products_all) - products_n,
        "makers": len(makers_all) - makers_n,
        "blog_posts": len(posts_all) - posts_n,
    }

    # Flag any inner hostname that looks like a preview/staging URL so
    # the operator sees "leakage" immediately if env vars are misset.
    preview_markers = ("emergentagent.com", "vercel.app", "onrender.com", "preview.")
    leakage = any(m in root for m in preview_markers)

    return {
        "resolved_site_root": root,
        "public_site_url_env": os.environ.get("PUBLIC_SITE_URL") or None,
        "public_backend_url_env": os.environ.get("PUBLIC_BACKEND_URL") or None,
        "x_forwarded_host": fwd_host or None,
        "preview_domain_leakage": leakage,
        "total_indexable_urls": 9 + products_n + makers_n + posts_n,
        "breakdown": {
            "static_pages": 9,
            "products": products_n,
            "makers": makers_n,
            "blog_posts": posts_n,
        },
        "test_slugs_stripped": stripped,
        "checks": {
            "sitemap_endpoint": f"{root}/api/sitemap.xml",
            "robots_endpoint":  f"{root}/api/robots.txt",
            "static_index":     f"{root}/sitemap.xml",
        },
    }



@router.get("/robots.txt")
async def robots_txt(http_request: Request):
    root = site_root(http_request)
    body = (
        "# Crafters Market — open to all major search & AI crawlers\n"
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /maker/\n"
        "Disallow: /admin/\n"
        "Disallow: /checkout/\n"
        "Disallow: /community/auth/\n"
        "Disallow: /api/\n"
        "Crawl-delay: 1\n"
        "\n"
        "# AI crawlers — explicitly welcome (cited mentions in answers = free distribution)\n"
        "User-agent: GPTBot\n"
        "Allow: /\n"
        "\n"
        "User-agent: ChatGPT-User\n"
        "Allow: /\n"
        "\n"
        "User-agent: OAI-SearchBot\n"
        "Allow: /\n"
        "\n"
        "User-agent: ClaudeBot\n"
        "Allow: /\n"
        "\n"
        "User-agent: Claude-Web\n"
        "Allow: /\n"
        "\n"
        "User-agent: anthropic-ai\n"
        "Allow: /\n"
        "\n"
        "User-agent: PerplexityBot\n"
        "Allow: /\n"
        "\n"
        "User-agent: Google-Extended\n"
        "Allow: /\n"
        "\n"
        "User-agent: Applebot-Extended\n"
        "Allow: /\n"
        "\n"
        "User-agent: Bytespider\n"
        "Allow: /\n"
        "\n"
        "User-agent: CCBot\n"
        "Allow: /\n"
        "\n"
        f"Sitemap: {root}/api/sitemap.xml\n"
    )
    return PlainTextResponse(body)



# ============================================================
# IndexNow — instant search-engine ping (Bing / Yandex / Naver / Seznam / Yep)
# Google deprecated their /ping endpoint in 2023; for Google specifically
# the operator must submit the sitemap from Search Console manually. The
# admin endpoint below surfaces a deep-link to that page in its response.
# ============================================================
from fastapi import Body
from pydantic import BaseModel


@router.api_route("/indexnow-key.txt", methods=["GET", "HEAD"], include_in_schema=False)
async def indexnow_key_file():
    """LEGACY keyLocation route — kept for any external systems still
    pointing here. New code uses `/api/indexnow/<key>.txt` so the filename
    matches the key value (which the IndexNow protocol requires —
    submitting a payload with keyLocation pointing to a file whose name
    does NOT equal the key value triggers `InvalidRequestParameters
    · "URLs are not related to your site verified through the
    keylocation parameter"` even when every URL is on the same host)."""
    from seo_indexnow import get_key
    key = await get_key()
    return PlainTextResponse(content=key, media_type="text/plain; charset=utf-8")


@router.api_route("/indexnow/{key_param}.txt",
                  methods=["GET", "HEAD"], include_in_schema=False)
async def indexnow_key_file_canonical(key_param: str):
    """IndexNow ownership-verification file at the protocol-compliant path
    `/<key>.txt`. The filename portion (`{key_param}`) MUST equal the stored
    key value — otherwise IndexNow's validator rejects the entire submission.
    Also responds to HEAD because some IndexNow validators probe with HEAD
    first; a 405 there is the difference between "URLs are not related to
    your site" (false-positive 422) and a successful submission.
    """
    from seo_indexnow import get_key
    key = await get_key()
    if key_param != key:
        raise HTTPException(404, "key not found")
    return PlainTextResponse(content=key, media_type="text/plain; charset=utf-8")


class _PingBody(BaseModel):
    urls: list[str] | None = None  # operator can override the auto-collected list
    budget: int = 50               # how many catalog URLs to submit when auto-collecting


@router.post("/admin/seo/ping")
async def admin_seo_ping(payload: _PingBody = Body(default=_PingBody()),
                         _: dict = Depends(current_admin)):
    """Fire an IndexNow ping and return the result for surfacing in the admin
    dashboard. Best-effort: never raises, so the UI can render any failure
    cleanly instead of throwing a stack trace at the operator."""
    from seo_indexnow import ping
    result = await ping(urls=payload.urls, budget=int(payload.budget or 50))
    return result


@router.get("/admin/seo/ping/status")
async def admin_seo_ping_status(_: dict = Depends(current_admin)):
    """Last-ping audit state — used by the admin SEO card to show when
    the operator last pinged + whether it landed."""
    from seo_indexnow import status as ping_status
    return await ping_status()


@router.post("/admin/seo/gsc-submit-sitemap")
async def admin_seo_gsc_submit_sitemap(_: dict = Depends(current_admin)):
    """Manually re-submit the sitemap to Google Search Console.
    Throttled to once per hour (Google rate-limits anyway). Auto-fires on
    product publish / renew / journal post — this endpoint is the operator's
    escape hatch for cases like a 'lost' sitemap or a fresh deploy."""
    from gsc_client import submit_sitemap, is_gsc_enabled
    if not is_gsc_enabled():
        return {"ok": False, "error": "GSC not enabled (set GSC_ENABLED=1 in backend env)"}
    return await submit_sitemap()


@router.get("/admin/seo/gsc-submit-sitemap/status")
async def admin_seo_gsc_submit_sitemap_status(_: dict = Depends(current_admin)):
    """Latest GSC sitemap-submit audit row."""
    from gsc_client import sitemap_status
    return await sitemap_status()
