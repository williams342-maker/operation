"""iter320b — Public detail page prerender for showcase posts.

A showcase post is a maker's real-shop photo on `/community`. The
post-detail SPA route is `/community/showcase/{id}` which the
CommunityPage opens as a focused modal — but crawlers can't trigger
the modal, so we serve a fully-rendered HTML version here.

Mirrors the `/api/og/community/file/{id}` pattern from iter317: full
JSON-LD (`ImageObject` + breadcrumbs), OG + Twitter Card tags,
keyword-rich meta description seeded from `seo_description` /
`seo_tags` (populated by `auto_seo_tags.bulk_tag_showcase_posts`).
"""
from __future__ import annotations

import json
import logging
import re

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from core import db
from routers.og_prerender import (
    _esc, _site, _placeholder_image, _render_og_html, _truncate,
)

router = APIRouter()
log = logging.getLogger("crafters.og.showcase")

_UUID_RE = re.compile(
    r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
    re.IGNORECASE,
)


@router.get("/og/showcase/{post_id}", include_in_schema=False)
async def og_showcase_post(post_id: str, http_request: Request):
    """Crawler-rendered showcase post detail.

    Real browsers hit the meta-refresh and land on
    `/community?showcase={id}` which the SPA opens as a focused
    showcase modal.
    """
    site = _site()
    if not _UUID_RE.match(post_id or ""):
        return RedirectResponse(f"{site}/community", status_code=302)
    doc = await db.showcase_posts.find_one(
        {"id": post_id, "admin_hidden": {"$ne": True}},
        {"_id": 0, "id": 1, "title": 1, "description": 1, "caption": 1,
         "image_url": 1, "image_urls": 1, "maker_slug": 1, "user_name": 1,
         "product_slug": 1, "created_at": 1, "likes": 1, "views": 1,
         "seo_title": 1, "seo_description": 1, "seo_tags": 1,
         "alt_text": 1},
    )
    if not doc:
        return RedirectResponse(f"{site}/community", status_code=302)

    title_raw = (doc.get("title") or "").strip()
    maker = (doc.get("user_name") or "").strip()
    maker_slug = (doc.get("maker_slug") or "").strip()
    canonical = f"{site}/community/showcase/{post_id}"
    # Real browsers land on the modal-aware path so the SPA can deep-
    # link straight into the right post.
    redirect_url = f"{site}/community?showcase={post_id}"

    # Title preference: seo_title (curated) > "Title by Maker — Crafters Market"
    # > generic fallback. Always ≤60 chars so OG cards don't truncate.
    if doc.get("seo_title"):
        page_title = doc["seo_title"]
    elif title_raw:
        suffix = f" by {maker}" if maker else ""
        page_title = _truncate(f"{title_raw}{suffix} — Crafters Market", 60)
    else:
        page_title = "Maker Showcase — Crafters Market"

    full_desc = (doc.get("description") or doc.get("caption") or "").strip()
    desc = (
        (doc.get("seo_description") or "").strip()
        or _truncate(full_desc, 200)
        or "A real shop photo from a vetted maker on Crafters Market — see how the piece was built."
    )
    seo_tags = doc.get("seo_tags") or []
    img = (
        (doc.get("image_url") or "").strip()
        or ((doc.get("image_urls") or [None])[0] or "").strip()
        or _placeholder_image()
    )
    alt_text = (doc.get("alt_text") or "").strip() or title_raw or "Maker showcase photo"

    extras: list[tuple[str, str]] = [("og:type", "article")]
    for t in seo_tags[:10]:
        extras.append(("article:tag", t))
    if maker:
        extras.append(("article:author", maker))

    body_parts = [
        '<nav class="breadcrumb" aria-label="Breadcrumb">'
        f'<a href="{site}/">Home</a> · <a href="{site}/community">Community</a>'
        f' · <span>{_esc(title_raw or "Showcase")}</span></nav>',
    ]
    body_parts.append(
        f'<section class="sect"><h2>{_esc(title_raw or "Maker showcase")}</h2>'
        f'<p><img src="{_esc(img)}" alt="{_esc(alt_text)}" /></p>'
        + (f'<p>{_esc(full_desc[:1500])}</p>' if full_desc else "")
        + '</section>'
    )
    detail_lines: list[str] = []
    if maker:
        if maker_slug:
            detail_lines.append(
                f'<li><strong>Built by:</strong> '
                f'<a href="{site}/makers/{_esc(maker_slug)}">{_esc(maker)}</a></li>'
            )
        else:
            detail_lines.append(f"<li><strong>Built by:</strong> {_esc(maker)}</li>")
    if doc.get("product_slug"):
        detail_lines.append(
            f'<li><strong>Listing:</strong> '
            f'<a href="{site}/shop/{_esc(doc["product_slug"])}">View product</a></li>'
        )
    if seo_tags:
        detail_lines.append(f"<li><strong>Tags:</strong> {_esc(', '.join(seo_tags[:10]))}</li>")
    if detail_lines:
        body_parts.append(
            '<section class="sect"><h2>About this piece</h2>'
            f'<ul>{"".join(detail_lines)}</ul></section>'
        )
    body_parts.append(
        '<section class="sect"><h2>Browse more</h2><ul>'
        f'<li><a href="{site}/community">More maker showcase posts</a></li>'
        f'<li><a href="{site}/shop">Shop hand-built originals</a></li>'
        f'<li><a href="{site}/makers">Meet the makers</a></li>'
        '</ul></section>'
    )
    body_html = "".join(body_parts)

    json_ld = json.dumps({
        "@context": "https://schema.org/",
        "@graph": [
            {
                "@type": "ImageObject",
                "@id": canonical,
                "name": title_raw or "Maker showcase",
                "description": _truncate(full_desc, 500) or desc,
                "contentUrl": img,
                "url": canonical,
                "creator": {
                    "@type": "Person",
                    "name": maker or "Crafters Market community",
                    **(
                        {"url": f"{site}/makers/{maker_slug}"}
                        if maker_slug else {}
                    ),
                },
                "keywords": ", ".join(seo_tags[:12]),
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{site}/"},
                    {"@type": "ListItem", "position": 2, "name": "Community", "item": f"{site}/community"},
                    {"@type": "ListItem", "position": 3,
                     "name": title_raw or "Showcase", "item": canonical},
                ],
            },
        ],
    }, separators=(",", ":"))

    html = _render_og_html(
        title=page_title, description=desc, image=img,
        canonical_url=canonical, redirect_url=redirect_url,
        body_html=body_html, json_ld=json_ld,
        extra_props=extras,
    )
    return HTMLResponse(content=html)
