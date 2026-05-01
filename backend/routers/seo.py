"""SEO endpoints: sitemap.xml + robots.txt.

Sitemap conforms to sitemap.org 0.9 + Google's image extension. Robots is
intentionally welcoming to all major web crawlers AND AI crawlers
(GPTBot, ClaudeBot, PerplexityBot, etc.) — products show up as cited
results in AI answers, which is free distribution.
"""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse, Response

from core import db, site_root

router = APIRouter()


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
        ("/journal",       "weekly",  "0.7"),
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
        {}, {"_id": 0, "slug": 1, "created_at": 1, "name": 1, "cover": 1, "banner_image_url": 1},
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
        "total_indexable_urls": 8 + products_n + makers_n + posts_n,
        "breakdown": {
            "static_pages": 8,
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
