"""SEO endpoints: sitemap.xml + robots.txt.

Sitemap conforms to sitemap.org 0.9 + Google's image extension. Robots is
intentionally welcoming to all major web crawlers AND AI crawlers
(GPTBot, ClaudeBot, PerplexityBot, etc.) — products show up as cited
results in AI answers, which is free distribution.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse, Response

from core import db, site_root

router = APIRouter()


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
        imgs = [(img, p.get("title") or "") for img in (p.get("images") or [])[:3]]
        urls.append(_u(
            f"/shop/{p['slug']}", p.get("created_at"),
            "weekly", "0.8", imgs,
        ))
    for m in makers:
        cover = m.get("banner_image_url") or m.get("cover")
        imgs = [(cover, m.get("name") or "")] if cover else []
        urls.append(_u(
            f"/makers/{m['slug']}", m.get("created_at"),
            "weekly", "0.7", imgs,
        ))
    for b in posts:
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

    products_n = await db.products.count_documents({"deleted_at": None, "status": {"$ne": "draft"}})
    makers_n = await db.makers.count_documents({})
    posts_n = await db.blog_posts.count_documents({})

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
