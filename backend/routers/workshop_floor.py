"""iter457 — The Workshop Floor: category-driven community knowledge hub.

  • WORKSHOP_CATEGORIES — 10 top-level discussion categories, each with
    followable tags (subcategories stay tags until organic volume justifies
    promotion to full categories).
  • Deterministic keyword classifier + conservative confidence-based
    migration of legacy forum threads (fallback: community › general-discussion).
    Admin migration report persisted to `forum_migration_reports`.
  • Public Overview aggregate (trending discussions, featured projects,
    latest videos/journal, popular files, trending tags, stats, roadmap).
  • Followable tags (buyer auth) + personalized followed-tags feed.
"""
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from core import db, logger, now_iso
from maker_auth import current_buyer, current_admin

router = APIRouter()

# ── Taxonomy ─────────────────────────────────────────────────────────────────

WORKSHOP_CATEGORIES = [
    {"id": "marketplace", "label": "Marketplace",
     "blurb": "Orders • Shipping • Feature requests",
     "tags": ["orders", "shipping", "payments", "policies", "feature-requests", "bug-reports"]},
    {"id": "getting-started", "label": "Getting Started",
     "blurb": "Introductions • First projects • Store setup",
     "tags": ["introductions", "new-maker", "first-listing", "store-setup", "beginner-questions"]},
    {"id": "woodworking", "label": "Woodworking",
     "blurb": "CNC routing • Carving • Finishing",
     "tags": ["furniture", "signs", "cnc-router", "carving", "finishing", "joinery", "wood-selection"]},
    {"id": "laser", "label": "Laser",
     "blurb": "CO₂ • Fiber • Diode • LightBurn",
     "tags": ["glowforge", "lightburn", "co2", "fiber-laser", "diode", "material-settings", "troubleshooting", "engraving"]},
    {"id": "plasma-metal", "label": "Plasma & Metal",
     "blurb": "Plasma CNC • Welding • Powder coating",
     "tags": ["plasma-cnc", "welding", "powder-coating", "steel", "aluminum", "metal-art", "patina"]},
    {"id": "3d-printing", "label": "3D Printing",
     "blurb": "Printers • STL files • Materials",
     "tags": ["bambu", "prusa", "creality", "resin-printing", "filament", "slicers", "stl-files"]},
    {"id": "handmade-crafts", "label": "Handmade Crafts",
     "blurb": "Jewelry • Leather • Pottery • Fiber arts",
     "tags": ["jewelry", "leather", "pottery", "resin", "sewing", "crochet", "quilting", "fiber-arts", "painting"]},
    {"id": "design-software", "label": "Design Software",
     "blurb": "LightBurn • Fusion 360 • Inkscape • CAD",
     "tags": ["lightburn", "fusion-360", "illustrator", "inkscape", "coreldraw", "vectric", "autocad", "svg-dxf"]},
    {"id": "selling", "label": "Selling Your Work",
     "blurb": "Pricing • Photography • Marketing • Taxes",
     "tags": ["pricing", "photography", "seo", "marketing", "shipping", "packaging", "taxes", "business"]},
    {"id": "community", "label": "Community",
     "blurb": "General discussion • Show your shop • Off topic",
     "tags": ["general-discussion", "introductions", "show-your-shop", "off-topic", "collaboration", "contests"]},
]
WORKSHOP_CATEGORY_IDS = {c["id"] for c in WORKSHOP_CATEGORIES}
CATEGORY_TAGS = {c["id"]: set(c["tags"]) for c in WORKSHOP_CATEGORIES}
ALL_TAGS = set().union(*CATEGORY_TAGS.values())

# Legacy category ids (pre-iter457 flat forum) → new home. Used both for the
# migration fallback and to keep old API clients posting without a redeploy.
LEGACY_CATEGORY_MAP = {
    "general": "community", "machine-help": "community",
    "techniques": "community", "finishing": "woodworking",
    "resources": "community", "show-tell": "community",
}
FALLBACK_CATEGORY, FALLBACK_TAG = "community", "general-discussion"

# ── Classifier (deterministic keyword scoring — no LLM) ──────────────────────
# (substring, category, tag|None, weight). Title hits count double.
_KW = [
    ("lightburn", "laser", "lightburn", 3), ("glowforge", "laser", "glowforge", 3),
    ("laser", "laser", None, 2), ("engrav", "laser", "engraving", 2),
    ("diode", "laser", "diode", 2), ("co2", "laser", "co2", 2),
    ("air assist", "laser", "material-settings", 2), ("kerf", "laser", None, 1),
    ("cutting board", "woodworking", None, 3), ("v-carve", "woodworking", "carving", 3),
    ("cnc router", "woodworking", "cnc-router", 3), ("end-grain", "woodworking", None, 2),
    ("stepper", "woodworking", "cnc-router", 1), ("spindle", "woodworking", "cnc-router", 1),
    ("z-zero", "woodworking", "cnc-router", 1), ("gantry", "woodworking", "cnc-router", 1),
    ("runout", "woodworking", "cnc-router", 1), ("end mill", "woodworking", "cnc-router", 1),
    ("upcut", "woodworking", "cnc-router", 1), ("feeds-and-speeds", "woodworking", "cnc-router", 1),
    ("feed rate", "woodworking", "cnc-router", 1), ("stepover", "woodworking", "cnc-router", 1),
    ("bit suppliers", "woodworking", "cnc-router", 1), ("sign", "woodworking", "signs", 1),
    ("walnut", "woodworking", "wood-selection", 2), ("hardwood", "woodworking", "wood-selection", 2),
    ("carv", "woodworking", "carving", 2), ("epoxy", "woodworking", "finishing", 2),
    ("mineral oil", "woodworking", "finishing", 2), ("wood", "woodworking", None, 1),
    ("grain", "woodworking", "wood-selection", 1), ("relief", "woodworking", "carving", 1),
    ("plywood", "woodworking", "wood-selection", 1),
    ("plasma", "plasma-metal", "plasma-cnc", 3), ("weld", "plasma-metal", "welding", 3),
    ("powder coat", "plasma-metal", "powder-coating", 3), ("cor-ten", "plasma-metal", "patina", 3),
    ("steel", "plasma-metal", "steel", 2), ("patina", "plasma-metal", "patina", 2),
    ("aluminum", "plasma-metal", "aluminum", 2), ("metal", "plasma-metal", "metal-art", 1),
    ("brass", "plasma-metal", "metal-art", 1),
    ("3d print", "3d-printing", None, 3), ("filament", "3d-printing", "filament", 3),
    ("slicer", "3d-printing", "slicers", 3), ("bambu", "3d-printing", "bambu", 3),
    ("prusa", "3d-printing", "prusa", 3), ("stl", "3d-printing", "stl-files", 2),
    ("resin print", "3d-printing", "resin-printing", 3),
    ("fusion 360", "design-software", "fusion-360", 3), ("fusion360", "design-software", "fusion-360", 3),
    ("inkscape", "design-software", "inkscape", 3), ("illustrator", "design-software", "illustrator", 3),
    ("vectric", "design-software", "vectric", 3), ("autocad", "design-software", "autocad", 3),
    ("coreldraw", "design-software", "coreldraw", 3), ("cam software", "design-software", None, 2),
    ("dxf", "design-software", "svg-dxf", 2), ("svg", "design-software", "svg-dxf", 2),
    ("toolpath", "design-software", None, 1), ("cad", "design-software", None, 1),
    ("pricing", "selling", "pricing", 3), ("price", "selling", "pricing", 2),
    ("etsy", "selling", "marketing", 2), ("packaging", "selling", "packaging", 2),
    ("marketing", "selling", "marketing", 2), ("photograph", "selling", "photography", 2),
    ("tax", "selling", "taxes", 2), ("seo", "selling", "seo", 2),
    ("customer", "selling", "business", 1), ("business", "selling", "business", 1),
    ("introduce yourself", "getting-started", "introductions", 3),
    ("new here", "getting-started", "introductions", 3),
    ("beginner", "getting-started", "beginner-questions", 2),
    ("first project", "getting-started", "beginner-questions", 2),
    ("getting started", "getting-started", None, 2),
    ("feature request", "marketplace", "feature-requests", 3),
    ("crafters market", "marketplace", None, 2), ("payout", "marketplace", "payments", 2),
    ("jewelry", "handmade-crafts", "jewelry", 3), ("leather", "handmade-crafts", "leather", 3),
    ("pottery", "handmade-crafts", "pottery", 3), ("ceramic", "handmade-crafts", "pottery", 2),
    ("crochet", "handmade-crafts", "crochet", 3), ("quilt", "handmade-crafts", "quilting", 3),
    ("sewing", "handmade-crafts", "sewing", 3), ("fiber art", "handmade-crafts", "fiber-arts", 3),
    ("workshop layout", "community", "show-your-shop", 3),
    ("workshop tour", "community", "show-your-shop", 3),
    ("show off", "community", "show-your-shop", 2),
    ("favorite build", "community", "show-your-shop", 2),
    ("off topic", "community", "off-topic", 3), ("collab", "community", "collaboration", 2),
]
_LEGACY_HINTS = {"show-tell": ("community", 2), "general": ("community", 1),
                 "finishing": ("woodworking", 1)}


def classify_thread(title: str, body: str, legacy_category: str = "") -> dict:
    """Score categories from keywords. Returns {category, tags, confidence,
    score, runner_up}. Confidence: high / medium / review / low."""
    title_l, body_l = (title or "").lower(), (body or "").lower()
    scores, tag_hits = {}, {}
    for kw, cat, tag, w in _KW:
        hits = (2 * w if kw in title_l else 0) + (w if kw in body_l else 0)
        if hits:
            scores[cat] = scores.get(cat, 0) + hits
            if tag:
                tag_hits.setdefault(cat, []).append((tag, hits))
    hint = _LEGACY_HINTS.get(legacy_category)
    if hint:
        scores[hint[0]] = scores.get(hint[0], 0) + hint[1]
        if legacy_category == "show-tell":
            tag_hits.setdefault("community", []).append(("show-your-shop", 2))
        if legacy_category == "finishing":
            tag_hits.setdefault("woodworking", []).append(("finishing", 2))

    ranked = sorted(scores.items(), key=lambda x: -x[1])
    top, top_score = (ranked[0] if ranked else (FALLBACK_CATEGORY, 0))
    second_score = ranked[1][1] if len(ranked) > 1 else 0

    if top_score < 2:
        return {"category": FALLBACK_CATEGORY, "tags": [FALLBACK_TAG],
                "confidence": "low", "score": top_score, "runner_up": None}
    tags = []
    for tag, _ in sorted(tag_hits.get(top, []), key=lambda x: -x[1]):
        if tag not in tags and tag in CATEGORY_TAGS[top]:
            tags.append(tag)
    if legacy_category == "machine-help" and "troubleshooting" in CATEGORY_TAGS[top] \
            and "troubleshooting" not in tags:
        tags.append("troubleshooting")
    conf = ("high" if top_score >= 6
            else "review" if top_score - second_score == 0
            else "medium")
    return {"category": top, "tags": tags[:5], "confidence": conf,
            "score": top_score,
            "runner_up": ranked[1][0] if len(ranked) > 1 else None}


# ── Migration (admin) ─────────────────────────────────────────────────────────

@router.post("/admin/forum/migrate")
async def migrate_forum(force: bool = False, _: dict = Depends(current_admin)):
    """Conservative confidence-based migration into the Workshop Floor
    taxonomy. Preserves authors/timestamps/replies/attachments untouched —
    only `category` + `tags` change; original stored as `legacy_category`.
    Idempotent: already-migrated threads are skipped unless force=true."""
    q = {} if force else {"legacy_category": {"$exists": False}}
    counts = {"total": 0, "high": 0, "medium": 0, "low_fallback": 0,
              "review": 0, "skipped_already_migrated": 0}
    by_category, needs_review = {}, []

    if not force:
        counts["skipped_already_migrated"] = await db.forum_threads.count_documents(
            {"legacy_category": {"$exists": True}})

    async for t in db.forum_threads.find(q, {"_id": 0, "id": 1, "title": 1,
                                             "body": 1, "category": 1,
                                             "legacy_category": 1}):
        counts["total"] += 1
        legacy = t.get("legacy_category") or t.get("category") or ""
        # Threads already carrying a new-taxonomy category (created post-refactor,
        # never migrated) keep it as-is.
        if legacy in WORKSHOP_CATEGORY_IDS and not t.get("legacy_category"):
            res = {"category": legacy, "tags": [], "confidence": "high",
                   "score": 99, "runner_up": None}
        else:
            res = classify_thread(t.get("title"), t.get("body"), legacy)
        bucket = ("low_fallback" if res["confidence"] == "low"
                  else "review" if res["confidence"] == "review"
                  else res["confidence"])
        counts[bucket] += 1
        by_category[res["category"]] = by_category.get(res["category"], 0) + 1
        if res["confidence"] == "review":
            needs_review.append({"id": t["id"], "title": (t.get("title") or "")[:120],
                                 "assigned": res["category"],
                                 "runner_up": res["runner_up"], "score": res["score"]})
        await db.forum_threads.update_one({"id": t["id"]}, {"$set": {
            "category": res["category"], "tags": res["tags"],
            "legacy_category": legacy or "none",
            "migration_confidence": res["confidence"], "migrated_at": now_iso()}})

    report = {"id": str(uuid.uuid4()), "at": now_iso(), "force": force,
              "counts": counts, "by_category": by_category,
              "needs_review": needs_review[:100]}
    await db.forum_migration_reports.insert_one({**report})
    logger.info("[workshop-floor] migration: %s", counts)
    return report


@router.get("/admin/forum/migration-report")
async def latest_migration_report(_: dict = Depends(current_admin)):
    report = await db.forum_migration_reports.find_one(
        {}, {"_id": 0}, sort=[("at", -1)])
    return {"report": report}


# ── Followable tags (buyer auth) ─────────────────────────────────────────────

_TAG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")


@router.get("/community/tags/following")
async def tags_following(claims: dict = Depends(current_buyer)):
    rows = await db.tag_follows.find(
        {"user_id": claims["sub"]}, {"_id": 0, "tag": 1}).to_list(200)
    return {"tags": sorted(r["tag"] for r in rows)}


@router.post("/community/tags/{tag}/follow")
async def follow_tag(tag: str, claims: dict = Depends(current_buyer)):
    tag = tag.lower().strip()
    if not _TAG_RE.match(tag) or tag not in ALL_TAGS:
        raise HTTPException(400, "Unknown tag.")
    await db.tag_follows.update_one(
        {"user_id": claims["sub"], "tag": tag},
        {"$setOnInsert": {"user_id": claims["sub"], "tag": tag,
                          "created_at": now_iso()}}, upsert=True)
    return {"ok": True, "following": True}


@router.delete("/community/tags/{tag}/follow")
async def unfollow_tag(tag: str, claims: dict = Depends(current_buyer)):
    await db.tag_follows.delete_one({"user_id": claims["sub"], "tag": tag.lower().strip()})
    return {"ok": True, "following": False}


@router.get("/community/forum-feed/followed")
async def followed_feed(limit: int = 50, claims: dict = Depends(current_buyer)):
    rows = await db.tag_follows.find(
        {"user_id": claims["sub"]}, {"_id": 0, "tag": 1}).to_list(200)
    tags = [r["tag"] for r in rows]
    if not tags:
        return {"tags": [], "threads": []}
    threads = await db.forum_threads.find(
        {"tags": {"$in": tags}, "removed_by_mod": {"$ne": True}},
        {"_id": 0}).sort("created_at", -1).to_list(max(1, min(limit, 100)))
    return {"tags": tags, "threads": threads}


@router.get("/community/tags/trending")
async def trending_tags(days: int = 60, limit: int = 12):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))).isoformat()
    rows = []
    async for g in db.forum_threads.aggregate([
            {"$match": {"created_at": {"$gte": cutoff}, "tags": {"$ne": None},
                        "removed_by_mod": {"$ne": True}}},
            {"$unwind": "$tags"},
            {"$group": {"_id": "$tags", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}}, {"$limit": max(1, min(limit, 30))}]):
        rows.append({"tag": g["_id"], "count": g["n"]})
    return {"tags": rows}


# ── Overview (public) ─────────────────────────────────────────────────────────

COMING_SOON = [
    {"label": "Monthly Maker Challenges"},
    {"label": "Community Events"},
    {"label": "Regional Maker Groups"},
    {"label": "Giveaways & Contests"},
]


@router.get("/community/overview")
async def community_overview():
    cutoff30 = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    thread_proj = {"_id": 0, "id": 1, "title": 1, "category": 1, "tags": 1,
                   "reply_count": 1, "user_name": 1, "created_at": 1}
    base_q = {"removed_by_mod": {"$ne": True}}

    trending = await db.forum_threads.find(
        {**base_q, "created_at": {"$gte": cutoff30}}, thread_proj
    ).sort([("reply_count", -1), ("created_at", -1)]).to_list(5)
    if len(trending) < 5:
        seen = {t["id"] for t in trending}
        extra = await db.forum_threads.find(base_q, thread_proj).sort(
            [("reply_count", -1), ("created_at", -1)]).to_list(10)
        trending += [t for t in extra if t["id"] not in seen][:5 - len(trending)]

    projects = await db.showcase_posts.find(
        {"admin_hidden": {"$ne": True}},
        {"_id": 0, "id": 1, "title": 1, "image_url": 1, "likes": 1,
         "user_name": 1, "created_at": 1}
    ).sort([("likes", -1), ("created_at", -1)]).to_list(4)

    videos = await db.clips.find(
        {"quarantined_at": None},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "poster_url": 1,
         "maker_name": 1, "likes": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(4)

    journal = await db.blog_posts.find(
        {}, {"_id": 0, "id": 1, "slug": 1, "title": 1, "excerpt": 1,
             "cover": 1, "read_min": 1, "author": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(3)

    files = await db.design_files.find(
        {"quarantined_at": None},
        {"_id": 0, "id": 1, "title": 1, "thumbnail_url": 1, "file_type": 1,
         "downloads": 1, "maker_name": 1}
    ).sort([("downloads", -1), ("created_at", -1)]).to_list(4)

    tags = (await trending_tags(days=60, limit=10))["tags"]

    stats = {
        "members": await db.community_users.count_documents({}),
        "threads": await db.forum_threads.count_documents(base_q),
        "replies": await db.forum_replies.count_documents({}),
        "projects": await db.showcase_posts.count_documents({"admin_hidden": {"$ne": True}}),
        "design_files": await db.design_files.count_documents({"quarantined_at": None}),
        "new_members_30d": await db.community_users.count_documents(
            {"created_at": {"$gte": cutoff30}}),
    }
    return {"trending_discussions": trending, "featured_projects": projects,
            "latest_videos": videos, "latest_journal": journal,
            "popular_files": files, "trending_tags": tags, "stats": stats,
            "coming_soon": COMING_SOON}
