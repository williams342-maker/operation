"""SEO endpoints: sitemap.xml + robots.txt."""
from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse, Response

from core import db, site_root

router = APIRouter()


@router.get("/sitemap.xml")
async def sitemap_xml(http_request: Request):
    root = site_root(http_request)
    static_paths = ["/", "/shop", "/makers", "/custom-order", "/apply", "/journal"]
    products = await db.products.find({}, {"_id": 0, "slug": 1, "created_at": 1}).to_list(2000)
    makers = await db.makers.find({}, {"_id": 0, "slug": 1, "created_at": 1}).to_list(2000)
    posts = await db.blog_posts.find({}, {"_id": 0, "slug": 1, "created_at": 1}).to_list(2000)

    def _u(path: str, lastmod: str | None = None) -> str:
        lm = f"<lastmod>{lastmod[:10]}</lastmod>" if lastmod else ""
        return f"<url><loc>{root}{path}</loc>{lm}</url>"

    urls = [_u(p) for p in static_paths]
    urls += [_u(f"/shop/{p['slug']}", p.get("created_at")) for p in products]
    urls += [_u(f"/makers/{m['slug']}", m.get("created_at")) for m in makers]
    urls += [_u(f"/journal/{b['slug']}", b.get("created_at")) for b in posts]
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(urls) + "</urlset>"
    )
    return Response(content=xml, media_type="application/xml")


@router.get("/robots.txt")
async def robots_txt(http_request: Request):
    root = site_root(http_request)
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /maker/\n"
        "Disallow: /admin/\n"
        "Disallow: /checkout/\n"
        f"Sitemap: {root}/api/sitemap.xml\n"
    )
    return PlainTextResponse(body)
