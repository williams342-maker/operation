"""iter413bc — Orphan Pages Detector.

Audit internal-link health across every canonical URL the site exposes.
Surfaces three classes of problem page:

  • orphan      — 0 internal links pointing to the URL
  • low_linked  — 1-2 internal links pointing to it (thin discoverability)
  • deep        — > 3 clicks from the homepage in our link graph

Approach: build an in-process directed graph from DETERMINISTIC sources
(no HTML scraping — that's brittle and slow):

  • Static-route table (homepage, /shop, /makers, /journal, SEO landings,
    guides, footer links) hardcoded below to mirror the actual templates
  • DB-derived edges:
      - /shop          → /shop/{p.slug}    for every published product
      - /makers        → /makers/{m.slug}  for every maker
      - /journal       → /journal/{b.slug} for every blog post
      - /shop/{slug}   → /makers/{m.slug}  product-back-to-maker
      - /makers/{slug} → /shop/{p.slug}    every maker's listings
      - /journal/{s}   → /journal          post-back-to-index
      - SEO landings   → /shop, /apply, /custom-order
      - State pages    → /makers + each maker in that state
  • Admin overrides from `featured_internal_links` collection — when
    an operator promotes an orphan URL it gets injected as a link from
    its suggested-parent surface (homepage/shop/journal/etc.)

The graph is bounded — products + makers + posts cap at 2000 each in
the sitemap query, so worst-case ~6k nodes. Trivial to compute on demand.
"""
from __future__ import annotations

import os
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_admin as _current_admin


router = APIRouter()


# Static link-source map — mirrors what the actual SPA templates render.
# Adding/removing routes here keeps the orphan detector honest.
_STATIC_LINKS: dict[str, set[str]] = {
    "/": {
        "/shop", "/makers", "/journal", "/apply", "/custom-order", "/pricing",
        "/free-svg-pack", "/community", "/contact", "/policy", "/updates",
    },
    # `/shop` and `/makers` index pages — these get DB-derived edges added below.
    "/shop":    {"/", "/makers", "/custom-order"},
    "/makers":  {"/", "/shop", "/apply"},
    "/journal": {"/", "/shop", "/apply"},
    "/apply":   {"/", "/pricing", "/free-svg-pack"},
    "/custom-order": {"/", "/shop"},
    "/pricing":      {"/", "/apply"},
    "/free-svg-pack": {"/", "/apply"},
    "/community":    {"/", "/journal"},
    "/contact":      {"/policy"},
    "/policy":       {"/contact"},
    "/updates":      {"/"},
    # SEO landings — each links into the catalog + apply funnel.
    "/cnc-metal-art":         {"/shop", "/apply", "/custom-order"},
    "/cnc-laser-art":         {"/shop", "/apply", "/custom-order"},
    "/cnc-manufacturing":     {"/shop", "/apply"},
    "/cnc-usa":               {"/shop", "/makers"},
    "/artisan-marketplace":   {"/shop", "/apply"},
    "/custom-handmade-goods": {"/shop", "/custom-order"},
    "/custom-metal-signs":    {"/shop", "/custom-order"},
    "/personalized-gifts":    {"/shop", "/custom-order"},
    "/farmhouse-decor":       {"/shop"},
    "/garage-decor":          {"/shop"},
    "/rustic-cabin-decor":    {"/shop"},
    "/wedding-gifts":         {"/shop", "/custom-order"},
    "/memorial-pieces":       {"/shop", "/custom-order"},
    "/outdoor-metal-decor":   {"/shop"},
    "/business-signs":        {"/shop", "/custom-order"},
    "/patriotic-decor":       {"/shop"},
    "/custom-ranch-signs":    {"/shop", "/custom-order"},
    "/cnc-metal-wall-art":    {"/shop"},
    "/handmade-gifts-for-dad": {"/shop"},
    "/plasma-cut-wall-art":     {"/shop"},
    "/cnc-wood-signs":          {"/shop"},
    "/laser-engraved-gifts":    {"/shop"},
    "/custom-address-signs":    {"/shop", "/custom-order"},
    "/engraved-cutting-boards": {"/shop"},
    "/handmade-woodworking": {"/shop", "/makers"},
    "/handmade-pottery":     {"/shop", "/makers"},
    "/handmade-jewelry":     {"/shop", "/makers"},
    "/leather-goods":        {"/shop", "/makers"},
    "/handmade-textiles":    {"/shop", "/makers"},
    "/handmade-mugs":        {"/shop"},
    "/handmade-quilts":      {"/shop"},
    "/handmade-rings":       {"/shop"},
    "/leather-wallets":      {"/shop"},
    "/wood-cutting-boards":  {"/shop"},
    "/how-custom-orders-work": {"/custom-order", "/shop"},
    "/guides/plasma-vs-laser-vs-router": {"/shop", "/cnc-metal-art"},
    "/guides/outdoor-mounting-guide":    {"/shop", "/outdoor-metal-decor"},
    "/guides/metal-gauge-finish-guide":  {"/shop", "/cnc-metal-art"},
}


def _classify_url(url: str) -> str:
    if url.startswith("/shop/"):
        return "product"
    if url.startswith("/makers/state/"):
        return "state"
    if url.startswith("/makers/"):
        return "maker"
    if url.startswith("/journal/"):
        return "journal"
    if url.startswith("/guides/"):
        return "guide"
    return "static"


def _suggested_parent(url: str, slug_to_maker: dict[str, str]) -> Optional[str]:
    """The most-natural surface that SHOULD already link to this URL.
    Used in the suggestion column so the operator knows where to add
    the missing link."""
    kind = _classify_url(url)
    if kind == "product":
        slug = url.rsplit("/", 1)[-1]
        maker = slug_to_maker.get(slug)
        return f"/makers/{maker}" if maker else "/shop"
    if kind == "maker":
        return "/makers"
    if kind == "journal":
        return "/journal"
    if kind == "state":
        return "/makers"
    if kind == "guide":
        return "/journal"
    return "/"


class PromoteRequest(BaseModel):
    url: str = Field(min_length=1, max_length=512)
    parent: str = Field(default="/", max_length=128)
    note: Optional[str] = Field(default=None, max_length=300)


class DismissRequest(BaseModel):
    url: str = Field(min_length=1, max_length=512)


async def _build_graph() -> tuple[set[str], dict[str, set[str]], dict[str, set[str]], dict[str, str]]:
    """Build (nodes, outgoing, incoming, product_slug_to_maker_slug)."""
    nodes: set[str] = set()
    outgoing: dict[str, set[str]] = defaultdict(set)

    # Seed from static link map.
    for src, dests in _STATIC_LINKS.items():
        nodes.add(src)
        for d in dests:
            outgoing[src].add(d)
            nodes.add(d)

    # DB sources.
    products = await db.products.find(
        {"deleted_at": None, "status": {"$ne": "draft"}},
        {"_id": 0, "slug": 1, "maker": 1},
    ).to_list(2000)
    makers = await db.makers.find({}, {"_id": 0, "slug": 1, "location": 1}).to_list(2000)
    posts = await db.blog_posts.find({}, {"_id": 0, "slug": 1}).to_list(2000)

    slug_to_maker: dict[str, str] = {}
    for p in products:
        slug = p.get("slug")
        if not slug:
            continue
        url = f"/shop/{slug}"
        nodes.add(url)
        # /shop indexes all products.
        outgoing["/shop"].add(url)
        # Product page links back to /shop + its maker page.
        outgoing[url].add("/shop")
        mk = p.get("maker")
        if mk:
            outgoing[url].add(f"/makers/{mk}")
            outgoing[f"/makers/{mk}"].add(url)
            slug_to_maker[slug] = mk

    for m in makers:
        slug = m.get("slug")
        if not slug:
            continue
        url = f"/makers/{slug}"
        nodes.add(url)
        outgoing["/makers"].add(url)
        outgoing[url].add("/makers")
        outgoing[url].add("/shop")

    for b in posts:
        slug = b.get("slug")
        if not slug:
            continue
        url = f"/journal/{slug}"
        nodes.add(url)
        outgoing["/journal"].add(url)
        outgoing[url].add("/journal")

    # State pages — only if we render them (sitemap criterion: ≥1 maker).
    try:
        from routers.state_pages import state_for_location
        state_counts: dict[str, int] = {}
        for m in makers:
            code = state_for_location(m.get("location"))
            if code:
                state_counts[code] = state_counts.get(code, 0) + 1
        for code in state_counts:
            url = f"/makers/state/{code.lower()}"
            nodes.add(url)
            outgoing["/makers"].add(url)
            outgoing[url].add("/makers")
    except Exception:
        pass

    # Admin promotions — manually-injected links from `featured_internal_links`.
    async for row in db.featured_internal_links.find({"active": True}, {"_id": 0}):
        target = (row.get("url") or "").strip()
        parent = (row.get("parent") or "/").strip()
        if target and parent:
            outgoing[parent].add(target)
            nodes.add(target)

    # Compute incoming = reverse of outgoing.
    incoming: dict[str, set[str]] = defaultdict(set)
    for src, dests in outgoing.items():
        for d in dests:
            incoming[d].add(src)

    return nodes, outgoing, incoming, slug_to_maker


def _bfs_depths(nodes: set[str], outgoing: dict[str, set[str]], root: str = "/") -> dict[str, int]:
    """Click-depth from root via BFS. Unreachable nodes → -1."""
    depths: dict[str, int] = {n: -1 for n in nodes}
    if root not in nodes:
        return depths
    depths[root] = 0
    q: deque[str] = deque([root])
    while q:
        cur = q.popleft()
        for n in outgoing.get(cur, ()):
            if n in depths and depths[n] == -1:
                depths[n] = depths[cur] + 1
                q.append(n)
    return depths


@router.get("/admin/orphan-pages")
async def orphan_pages_scan(_admin: dict = Depends(_current_admin)):
    """Run the internal-link audit. Cheap enough to run on demand —
    typical site is <2k nodes which BFS handles in single-digit ms."""
    nodes, outgoing, incoming, slug_to_maker = await _build_graph()
    depths = _bfs_depths(nodes, outgoing)

    # Operator dismissals — URLs they reviewed + acknowledged.
    dismissed = set(await db.orphan_dismissals.distinct("url"))

    orphans: list[dict] = []
    low_linked: list[dict] = []
    deep: list[dict] = []

    for url in sorted(nodes):
        if url in dismissed:
            continue
        in_count = len(incoming.get(url, set()))
        depth = depths.get(url, -1)
        kind = _classify_url(url)
        suggested_parent = _suggested_parent(url, slug_to_maker)

        # 3 candidate sibling links (other pages of same type w/ shared parent).
        siblings: list[str] = []
        if suggested_parent and suggested_parent in outgoing:
            siblings = [
                u for u in sorted(outgoing[suggested_parent])
                if u != url and _classify_url(u) == kind
            ][:3]

        row = {
            "url": url,
            "type": kind,
            "incoming_count": in_count,
            "incoming_from": sorted(list(incoming.get(url, set())))[:5],
            "depth": depth,
            "suggested_parent": suggested_parent,
            "suggested_links": siblings,
        }
        if in_count == 0:
            orphans.append(row)
        elif in_count <= 2:
            low_linked.append(row)
        if depth > 3:
            deep.append(row)

    # Sort each bucket — orphans first by type, low_linked by ascending links, deep by descending depth.
    orphans.sort(key=lambda r: (r["type"], r["url"]))
    low_linked.sort(key=lambda r: (r["incoming_count"], r["type"], r["url"]))
    deep.sort(key=lambda r: (-r["depth"], r["type"], r["url"]))

    return {
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "total_pages": len(nodes),
        "orphan_count": len(orphans),
        "low_linked_count": len(low_linked),
        "deep_count": len(deep),
        "dismissed_count": len(dismissed),
        "orphans": orphans[:200],
        "low_linked": low_linked[:200],
        "deep": deep[:50],
    }


@router.post("/admin/orphan-pages/promote")
async def orphan_promote(payload: PromoteRequest, claims: dict = Depends(_current_admin)):
    """Promote an orphan URL by adding a link to it from `parent`.
    Persists in `featured_internal_links` so the next scan recognises
    the new edge AND the relevant index page can surface the link.

    NOTE: actual surfacing in the SPA template is a follow-up — for now
    the promotion exists in the graph so the orphan stops showing up."""
    url = payload.url.strip()
    parent = payload.parent.strip() or "/"
    await db.featured_internal_links.update_one(
        {"url": url, "parent": parent},
        {
            "$set": {
                "url": url, "parent": parent,
                "note": (payload.note or "").strip()[:300] or None,
                "active": True,
                "promoted_by": (claims.get("email") or "").lower(),
                "promoted_at": now_iso(),
            },
        },
        upsert=True,
    )
    return {"ok": True, "url": url, "parent": parent}


@router.post("/admin/orphan-pages/dismiss")
async def orphan_dismiss(payload: DismissRequest, claims: dict = Depends(_current_admin)):
    """Mark an orphan URL as reviewed + acknowledged. Won't appear in
    future scans (useful for intentionally-orphan URLs like one-off
    landing pages, archive content, etc.)."""
    url = payload.url.strip()
    if not url:
        raise HTTPException(400, "url required")
    await db.orphan_dismissals.update_one(
        {"url": url},
        {"$set": {
            "url": url,
            "dismissed_by": (claims.get("email") or "").lower(),
            "dismissed_at": now_iso(),
        }},
        upsert=True,
    )
    return {"ok": True, "url": url}


@router.delete("/admin/orphan-pages/dismiss")
async def orphan_undismiss(url: str, _admin: dict = Depends(_current_admin)):
    """Undo a dismissal — URL re-enters the audit on next scan."""
    if not url:
        raise HTTPException(400, "url required")
    res = await db.orphan_dismissals.delete_one({"url": url})
    return {"ok": True, "url": url, "removed": res.deleted_count}
