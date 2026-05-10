"""Idempotent seed data for makers, products, reviews, blog posts, activity."""
from core import db
from models import Maker, Product, Review, BlogPost, ActivityEvent

SEED_MAKERS = [
    {"slug": "iron-and-oak", "name": "Iron & Oak Studio", "initials": "IR", "location": "Nashville, TN",
     "email": "iron-and-oak@craftersmarket.org",
     "bio": "Father-and-son shop forging wall art and custom signs from raw oak and 14ga steel.",
     "techniques": ["PLASMA", "ROUTER"],
     "portrait": "https://images.unsplash.com/photo-1764115424737-25aca6f47835?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwxfHxjbmMlMjBwbGFzbWElMjBjdXR0aW5nJTIwbWV0YWwlMjB3b3JrZXJ8ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85",
     "cover": "https://images.pexels.com/photos/17180807/pexels-photo-17180807.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
     "listings_count": 14, "rating": 4.97},
    {"slug": "metalart-pro", "name": "MetalArt Pro Shop", "initials": "ME", "location": "Austin, TX",
     "email": "metalart-pro@craftersmarket.org",
     "bio": "Industrial design studio specializing in laser-cut steel signage and bespoke business pieces.",
     "techniques": ["LASER", "CUSTOM"],
     "portrait": "https://images.unsplash.com/photo-1689960253768-72a12bc8320f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHw0fHxjbmMlMjBwbGFzbWElMjBjdXR0aW5nJTIwbWV0YWwlMjB3b3JrZXJ8ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85",
     "cover": "https://images.unsplash.com/photo-1745448797900-35d08e85e9db?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1NzZ8MHwxfHNlYXJjaHwxfHx3ZWxkaW5nJTIwc3BhcmtzJTIwZGFyayUyMGluZHVzdHJpYWx8ZW58MHx8fHwxNzc3MTU0OTg0fDA&ixlib=rb-4.1.0&q=85",
     "listings_count": 22, "rating": 4.96},
]

P_MOUNTAIN = "https://images.unsplash.com/photo-1705661902771-28a65b16ea98?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwzfHxtb2Rlcm4lMjBtZXRhbCUyMHdhbGwlMjBhcnQlMjBzaWdufGVufDB8fHx8MTc3NzE1NDk4NHww&ixlib=rb-4.1.0&q=85"
P_WOOD = "https://images.unsplash.com/photo-1776142519609-a4858781a01a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1MDV8MHwxfHNlYXJjaHw0fHxjdXN0b20lMjB3b29kJTIwY2FydmVkJTIwd2FsbCUyMHNpZ258ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85"
P_CNC = "https://images.pexels.com/photos/17180807/pexels-photo-17180807.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
P_LASER = "https://images.unsplash.com/photo-1689960253768-72a12bc8320f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHw0fHxjbmMlMjBwbGFzbWElMjBjdXR0aW5nJTIwbWV0YWwlMjB3b3JrZXJ8ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85"

SEED_PRODUCTS = [
    {"slug": "mountain-range-silhouette", "title": "Mountain Range Silhouette", "category": "Wall Art",
     "technique": "PLASMA", "price": 149.0, "maker_slug": "iron-and-oak", "featured": True,
     "description": '36" wide mountain scene cut from 14ga mild steel. Raw steel finish with clear coat.',
     "materials": ["14ga mild steel", "Clear coat"], "dimensions": '36" × 14"',
     "images": [P_MOUNTAIN, P_LASER, P_CNC]},
    {"slug": "rustic-family-name-sign", "title": "Rustic Family Name Sign", "category": "Custom Signs",
     "technique": "ROUTER", "price": 79.0, "maker_slug": "iron-and-oak", "featured": True,
     "description": 'Custom family name sign in 3/4" oak. Up to 12 characters. Stained walnut finish.',
     "materials": ["3/4\" oak hardwood", "Walnut stain"], "dimensions": '24" × 8"',
     "images": [P_WOOD, P_MOUNTAIN]},
    {"slug": "custom-business-sign", "title": "Custom Business Sign", "category": "Custom Signs",
     "technique": "CUSTOM", "price": 325.0, "maker_slug": "metalart-pro", "featured": True,
     "description": 'Your business name and logo cut from 1/4" steel. Up to 36" wide. Multiple finishes.',
     "materials": ["1/4\" steel", "Powder coat"], "dimensions": 'Up to 36" wide',
     "images": [P_CNC, P_LASER]},
    {"slug": "industrial-address-numbers", "title": "Industrial Address Numbers", "category": "Wall Art",
     "technique": "LASER", "price": 59.0, "maker_slug": "metalart-pro", "featured": True,
     "description": "Laser-cut steel address numbers, 6\" tall. Powder coated matte black. Set of 4.",
     "materials": ["Steel", "Matte black powder coat"], "dimensions": '6" tall · set of 4',
     "images": [P_LASER, P_MOUNTAIN]},
    {"slug": "outdoor-compass-medallion", "title": "Outdoor Compass Medallion", "category": "Outdoor Art",
     "technique": "PLASMA", "price": 219.0, "maker_slug": "metalart-pro",
     "description": '24" diameter compass rose, weather-resistant powder coat. Rust-proof for life outdoors.',
     "materials": ["Cor-Ten steel", "Outdoor powder coat"], "dimensions": '24" diameter',
     "images": [P_CNC, P_MOUNTAIN]},
    {"slug": "carved-oak-wedding-monogram", "title": "Carved Oak Wedding Monogram", "category": "Custom Signs",
     "technique": "ROUTER", "price": 189.0, "maker_slug": "iron-and-oak",
     "description": "Hand-finished oak monogram with gold leaf inlay. Build to your initials.",
     "materials": ["Oak hardwood", "Gold leaf"], "dimensions": '20" × 20"',
     "images": [P_WOOD, P_LASER]},
]

SEED_REVIEWS = [
    {"name": "Sarah M.", "location": "Austin, TX", "rating": 5,
     "text": "The custom sign I ordered for our business exceeded every expectation. The metal work is absolutely stunning."},
    {"name": "James & Lia R.", "location": "Denver, CO", "rating": 5,
     "text": "Ordered a wedding monogram and it's the most beautiful piece in our home. Incredible craftsmanship."},
    {"name": "David K.", "location": "Nashville, TN", "rating": 5,
     "text": "Fast shipping, perfect quality. The CNC precision really shows — every cut is clean and intentional."},
    {"name": "Maria O.", "location": "Phoenix, AZ", "rating": 5,
     "text": "The compass medallion has held up two desert summers without a scratch. Quality is unreal."},
]

SEED_POSTS = [
    {"slug": "anatomy-of-a-cut", "title": "Anatomy Of A Cut", "author": "Iron & Oak Studio",
     "excerpt": "How a CAD vector becomes a kerf-corrected toolpath, step-by-step inside the workshop.",
     "body": "Every piece in the marketplace begins as a vector. We walk through how our makers translate a design into a kerf-corrected toolpath, then into a finished product — all without sacrificing the hand of the artisan.",
     "cover": P_CNC, "read_min": 6},
    {"slug": "plasma-vs-laser", "title": "Plasma vs. Laser: Picking The Right Tool", "author": "MetalArt Pro Shop",
     "excerpt": "The honest case for each technique — when to choose plasma, when to switch to laser.",
     "body": "Plasma cuts thicker steel faster but with a wider kerf. Laser is precise on thin sheet but slow on heavy stock. Here's how our makers choose between them — and what it means for the look of the finished piece.",
     "cover": P_LASER, "read_min": 5},
    {"slug": "the-finish-line", "title": "The Finish Line: Powder, Patina, Stain", "author": "Crafters Market",
     "excerpt": "A finish isn't just protection — it's identity. Three approaches, one philosophy.",
     "body": "Powder coats are tough and uniform. Patinas are alive and evolving. Stains pull grain forward. Knowing which to apply is half the artistry.",
     "cover": P_WOOD, "read_min": 4},
    # ---- New entries (iter137) — broader voice, more buyer-curious topics ----
    {"slug": "buying-handmade-101",
     "title": "Buying Handmade 101: What To Ask Before You Order",
     "author": "Crafters Market",
     "excerpt": "A buyer's checklist for ordering custom work that lasts — proportions, finishes, lead time, and the questions most people forget to ask.",
     "body": "Most buyers come to handmade work the first time excited but unsure. Should you go bigger or smaller? Will the finish hold up outside? How much lead time is reasonable? In this guide we walk through the conversation we wish every buyer started with their maker — including the proportions trick that solves 80% of \"it's too big / too small\" returns, and a checklist for outdoor pieces.",
     "cover": P_WOOD, "read_min": 5},
    {"slug": "what-craftsmanship-actually-means",
     "title": "What Craftsmanship Actually Means In 2026",
     "author": "Crafters Market",
     "excerpt": "When CNC is faster than hand tools, where does \"handmade\" live? A working definition that respects both the machinist and the carver.",
     "body": "There's a tired argument that running a CNC \"isn't real craftsmanship\" — only hand tools count. We disagree, and we think the more honest framing is this: craftsmanship lives in the choices, not the technique. The CAD designer choosing a kerf width, the welder choosing a bead, the finisher choosing a stain — every machine still needs a human who's accountable for what comes off it. This is the philosophy that runs through every maker on this marketplace.",
     "cover": P_CNC, "read_min": 6},
    {"slug": "from-shop-to-shipped",
     "title": "From Shop To Shipped: Inside A Custom Sign Order",
     "author": "Iron & Oak Studio",
     "excerpt": "A 14-day timeline for a custom family-name sign — design, plasma cut, weld, finish, photo, ship. The honest version, no marketing gloss.",
     "body": "We get asked all the time what a custom order actually looks like behind the scenes. So we documented one start to finish — a 36\" wide steel-and-oak family name sign, walking the buyer through every stage of the 14-day build. The proofing back-and-forth, the moment we caught a kerf-correction error in the file, the patina test, the shipping photo. If you've ever wondered what your order is doing on day 6 of the wait — this is it.",
     "cover": P_MOUNTAIN, "read_min": 8},
    {"slug": "founding-seller-beta",
     "title": "Why We Built A Founding Seller Beta",
     "author": "Crafters Market",
     "excerpt": "We're picking the first 100 makers ourselves — and giving them lower commission for life. Here's how we picked, and what we learned.",
     "body": "Most marketplaces grow by opening the floodgates. We're going the other way: invite-only for the first 100 makers, hand-picked, with reduced commission as a thank-you for showing up early. We're three months in. Here's the framework we use to evaluate applications, the most common reason we say no, and the unexpected lesson about photography that's reshaped how we coach new sellers.",
     "cover": P_LASER, "read_min": 5},
    {"slug": "outdoor-finish-survival-guide",
     "title": "Outdoor Finish Survival Guide: 4 Seasons Tested",
     "author": "MetalArt Pro Shop",
     "excerpt": "Powder, clear coat, raw patina, gun blue — we put 8 finishes outside for a year. Photos and verdicts on which actually held up.",
     "body": "Customer #1 question on outdoor pieces: will this survive my climate? We pinned eight finished steel test pieces to a south-facing fence in Austin, TX last spring and photographed them every month. After a year of triple-digit summers, two hailstorms, and a humid winter, here's what survived intact, what surprised us with how well it aged, and the one finish we'd never recommend for outdoor again.",
     "cover": P_LASER, "read_min": 7},
    {"slug": "wood-grain-direction-matters",
     "title": "Why Wood Grain Direction Matters More Than You Think",
     "author": "Iron & Oak Studio",
     "excerpt": "The same oak board cut two different ways looks like two different woods. A 90-second visual primer on quartersawn vs. flat-sawn.",
     "body": "If you've ever ordered a custom wood sign and thought the grain looked completely different from the reference photo — you're not crazy, and your maker isn't lying. Quartersawn vs. flat-sawn boards reveal radically different grain patterns from the same tree. We break down the difference with side-by-side photos, explain when each is the better pick for your piece, and show why we sometimes turn down a job rather than promise a look we can't reliably hit.",
     "cover": P_WOOD, "read_min": 4},
]

SEED_ACTIVITY = [
    {"kind": "sold", "text": "Mountain Range Silhouette sold to a buyer", "location": "Denver, CO"},
    {"kind": "shipped", "text": "Iron & Oak shipped a Family Name Sign", "location": "Austin, TX"},
    {"kind": "listed", "text": "MetalArt Pro Shop listed a new Compass Medallion", "location": "Austin, TX"},
    {"kind": "applied", "text": "A new maker applied to the program", "location": "Portland, OR"},
    {"kind": "sold", "text": "Industrial Address Numbers sold to a buyer", "location": "Nashville, TN"},
    {"kind": "shipped", "text": "MetalArt Pro shipped a Custom Business Sign", "location": "Houston, TX"},
]


async def seed_if_empty():
    if await db.makers.count_documents({}) == 0:
        for m in SEED_MAKERS:
            await db.makers.insert_one({**Maker(**m).model_dump()})
    if await db.products.count_documents({}) == 0:
        for p in SEED_PRODUCTS:
            await db.products.insert_one({**Product(**p).model_dump()})
    if await db.reviews.count_documents({}) == 0:
        for r in SEED_REVIEWS:
            await db.reviews.insert_one({**Review(**r).model_dump()})
    # Blog posts use upsert-by-slug so adding new entries to SEED_POSTS
    # rolls out automatically on the next deploy without disturbing
    # any existing posts (e.g. maker-authored ones). Only inserts a
    # seed entry if its slug doesn't already exist.
    for b in SEED_POSTS:
        existing = await db.blog_posts.find_one({"slug": b["slug"]}, {"_id": 1})
        if not existing:
            await db.blog_posts.insert_one({**BlogPost(**b).model_dump()})
    if await db.activity_events.count_documents({}) == 0:
        for a in SEED_ACTIVITY:
            await db.activity_events.insert_one({**ActivityEvent(**a).model_dump()})
    await _seed_admin_password()


async def _seed_admin_password():
    """Seed the super-admin password from env so production (and any fresh
    deploy) has a working email+password admin login out of the box.

    Set `ADMIN_INIT_PASSWORD_HASH` in the deploy env to a bcrypt($2b$) hash
    of the chosen password (generate locally with `hash_password(...)`).
    Optionally set `ADMIN_INIT_EMAIL` to override which admin to seed;
    defaults to `OPS_EMAIL`. The seeder is **idempotent**:
      - if the admin row already has any `password_hash`, it's left alone
        (so users who rotate their password via /auth/password/set are
        never clobbered by the env hash on redeploy);
      - it only writes when the admin row is missing a hash.
    """
    import os as _os
    h = (_os.environ.get("ADMIN_INIT_PASSWORD_HASH") or "").strip()
    if not h.startswith("$2"):
        return  # not configured (or not a bcrypt hash) — do nothing
    email = (_os.environ.get("ADMIN_INIT_EMAIL")
             or _os.environ.get("OPS_EMAIL") or "").lower().strip()
    if not email:
        return
    from core import now_iso
    existing = await db.admin_users.find_one(
        {"email": email}, {"_id": 0, "password_hash": 1},
    )
    if existing and existing.get("password_hash"):
        return  # user has already set/rotated a password — hands off
    await db.admin_users.update_one(
        {"email": email},
        {
            "$set": {
                "email": email,
                "password_hash": h,
                "password_set_at": now_iso(),
                "last_password_change_at": now_iso(),
                "password_reset_nonce": "",
                "is_active": True,
                "capabilities": ["super_admin"],
            },
            "$setOnInsert": {
                "created_at": now_iso(),
                "invited_by": "env-seed",
            },
        },
        upsert=True,
    )
