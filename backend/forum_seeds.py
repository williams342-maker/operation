"""Seed starter forum threads.

The community forum ships empty. New visitors who hit /community/forum
see "no threads yet" and bounce. This module idempotently seeds 20
high-quality starter threads across all 6 categories so the forum has
real conversation prompts on day one.

Each thread:
  - Posts as the "Crafters Market Team" community user (auto-created if missing)
  - Is a legitimate question or discussion prompt — never marketing fluff
  - Is idempotent: re-running this function does NOT create duplicates
    (matched on `seed_key` field, never on `title` since admins may rename)

Trigger:
  - At runtime via `await seed_forum_threads()` (e.g. one-off admin endpoint)
"""
from __future__ import annotations

import uuid
from typing import List, Dict
from datetime import datetime, timezone, timedelta

from core import db, logger, now_iso

SEED_USER_EMAIL = "team@craftersmarket.org"
SEED_USER_NAME = "Crafters Market Team"

# Each entry: (seed_key, category, title, body)
# `seed_key` is a stable slug used for de-dup — never reuse one.
# Bodies are 2-4 sentences max; the goal is to invite responses, not
# answer the question. Where appropriate they share what we've already
# seen from the maker community so the discussion has a starting point.
STARTER_THREADS: List[Dict[str, str]] = [
    # ─────────────── machine-help (issues / troubleshooting) ───────────────
    {
        "seed_key": "starter-mh-stepper-skipping",
        "category": "machine-help",
        "title": "Stepper motor skipping mid-cut on long Y-axis runs — what's actually causing it?",
        "body": "A maker in our community kept losing steps on jobs longer than ~18 inches on the Y axis. They tried slower feed rates and stiffer belts, but the issue came back. What's the actual root-cause checklist you'd run? Driver current, microstepping, belt tension, dust on the linear rails, or somewhere else entirely?",
    },
    {
        "seed_key": "starter-mh-spindle-runout",
        "category": "machine-help",
        "title": "How do you measure spindle runout without a Haimer or fancy gauge?",
        "body": "We've got several makers running budget routers (Makita, Dewalt, Chinese 800W spindles) who suspect runout is wrecking their finish quality but don't own a $400 indicator. What cheap or DIY techniques actually work? Sharpie test, paper feeler gauges, or just live with it?",
    },
    {
        "seed_key": "starter-mh-plasma-pierce-blowout",
        "category": "machine-help",
        "title": "Plasma table — pierce blowing the consumable on thicker plate. Pierce delay or air pressure?",
        "body": "Cutting 1/2\" mild steel and the consumable nozzle blows out within 3-4 pierces. Air dryer is plumbed and CFM is rated above the unit's spec. Is this almost always a pierce-delay timing issue or are people seeing it from contaminated air, bad ground clamps, or something else?",
    },
    {
        "seed_key": "starter-mh-z-zero-repeatability",
        "category": "machine-help",
        "title": "Z-zero repeatability is killing me on multi-tool jobs — what's your workflow?",
        "body": "Tool changes on a hobby CNC = guesswork. I've tried touchplates, paper feeler, and the dial-indicator-on-a-spoilboard trick. Curious what the experienced folks here use and how repeatable you actually get. Also: anyone using a fixed tool sensor + tool length offset macro on Mach3 or grblHAL?",
    },
    {
        "seed_key": "starter-mh-router-bit-snap",
        "category": "machine-help",
        "title": "1/8\" upcut bits keep snapping on hardwood — feed rate or pull-down?",
        "body": "Walnut and white oak. Standard 1/8\" 2-flute upcut, 18,000 RPM, ~30 IPM, 0.05\" DOC. Snapping every 2-3 jobs. I'm not pushing it hard — am I missing something fundamental about chipload, or is it the bit quality?",
    },
    # ─────────────── techniques (how-to) ───────────────
    {
        "seed_key": "starter-tech-deep-vcarve-letters",
        "category": "techniques",
        "title": "What's your go-to technique for crisp deep V-carve letters in figured wood?",
        "body": "Figured maple and curly walnut keep tearing out at the cusps of a V-carve, even with a fresh 60° bit and climb-cut. Anyone scoring perimeter passes first, freezing the blank, or using a different bit angle for figured stock? Share what's worked.",
    },
    {
        "seed_key": "starter-tech-toolpath-strategy",
        "category": "techniques",
        "title": "Adaptive clearing vs. parallel raster for 2.5D signs — when do you switch?",
        "body": "I default to adaptive for everything and finish with a raster, but I'm probably leaving time on the table. Where does the calculus actually break — small areas, soft material, fine detail? What does your decision tree look like?",
    },
    {
        "seed_key": "starter-tech-engraving-photos-on-wood",
        "category": "techniques",
        "title": "Diode laser engraving photos on wood — the dithering settings nobody talks about",
        "body": "Most tutorials parrot the same Jarvis dither + 80% power line, but the results are mediocre. Anyone tested Stucki vs Atkinson on basswood at different DPIs? Drop your before/afters and exact LightBurn settings.",
    },
    {
        "seed_key": "starter-tech-3d-relief-grain-direction",
        "category": "techniques",
        "title": "Does grain direction actually matter for 3D relief carving, or is it superstition?",
        "body": "Half the tutorials say 'always carve across the grain.' Half say it doesn't matter at small step-overs. What's been your real-world experience with relief carving in cherry, walnut, and pine? Photos help.",
    },
    {
        "seed_key": "starter-tech-dxf-cleanup-workflow",
        "category": "techniques",
        "title": "Cleaning up customer-supplied DXFs without losing your mind",
        "body": "Buyers send DXFs with overlapping vectors, micro-gaps, hairlines, and 47 layers. What's your fastest cleanup workflow? Inkscape, LibreCAD, F360, or a paid tool? Bonus points if you can share a checklist you actually run on every file.",
    },
    # ─────────────── finishing ───────────────
    {
        "seed_key": "starter-fin-sealing-end-grain",
        "category": "finishing",
        "title": "Sealing end-grain on cutting boards — mineral oil vs. cutting board wax vs. shellac",
        "body": "Buyer just sent a board back after 6 months because the end grain checked. I'm using mineral oil only. Is cutting-board wax (beeswax + mineral oil) enough or do you go to a cured finish like shellac under the food-safe layer? What's your stack?",
    },
    {
        "seed_key": "starter-fin-powder-coat-vs-rustoleum",
        "category": "finishing",
        "title": "Plasma-cut steel signs — powder coat vs. quality rattle-can. Margin economics?",
        "body": "Powder coat is rock-solid but $25/job in fees + drive time for a small maker. Quality 2k epoxy primer + Rust-Oleum holds up indoors. What's your line for upgrading, and how do you price the difference for buyers?",
    },
    {
        "seed_key": "starter-fin-cnc-blackening",
        "category": "finishing",
        "title": "Blackening engraved steel without staining the surrounding face",
        "body": "Cold blue or gun blue gets into surface scratches and hazes the un-engraved metal. I've tried wax-rub-then-blacken-then-wipe. What's your cleanest method that doesn't require masking every job?",
    },
    {
        "seed_key": "starter-fin-uv-light-aging",
        "category": "finishing",
        "title": "How is your finish actually aging in real customer hands at 12 months?",
        "body": "We hear about finish quality on day one. I want to hear what's surviving 12+ months on the buyer's wall, kitchen, garage. Post a photo of an old piece you've gotten back or seen — what worked, what cracked, what yellowed.",
    },
    # ─────────────── resources (links, files, tooling) ───────────────
    {
        "seed_key": "starter-res-feed-speed-calculator",
        "category": "resources",
        "title": "Best feeds-and-speeds calculator that actually accounts for your specific machine",
        "body": "G-Wizard, FSWizard, Provencut, Carbide3D's calculator — they're all in different ballparks for the same job. Which do you trust and why? Bonus: post your machine + tool + material + the number it gave you.",
    },
    {
        "seed_key": "starter-res-bit-suppliers",
        "category": "resources",
        "title": "US bit suppliers that aren't Amazon junk or $50/bit name-brand",
        "body": "Looking for the middle ground — actual Tungsten carbide, decent QC, ships fast, won't break the bank for production work. Drop your favorites + what you specifically buy from them. (Mods feel free to pin good answers.)",
    },
    {
        "seed_key": "starter-res-svg-libraries",
        "category": "resources",
        "title": "Free + paid SVG/DXF libraries that don't violate licenses when you sell the cut piece",
        "body": "A lot of 'free' SVG sites have terms that quietly prohibit selling the final physical piece. Where do you actually source files for commercial work? Open-source projects, paid bundles, marketplaces like Crafters Market itself?",
    },
    {
        "seed_key": "starter-res-cam-software-tier-list",
        "category": "resources",
        "title": "CAM software tier list 2026 — what's worth paying for if you're going pro?",
        "body": "Carbide Create / Vectric V-Carve / Aspire / Fusion 360 / Carveco — and a half dozen more. If you're doing this as a real business now, what's actually worth the money and what's just inertia? Be honest.",
    },
    # ─────────────── show-tell ───────────────
    {
        "seed_key": "starter-st-monthly-build",
        "category": "show-tell",
        "title": "Drop your favorite build from the last 30 days — bonus points for the screw-up story",
        "body": "Monthly community thread. Post one piece you finished recently. Required: how long it took, what you'd do differently, and one mistake you made along the way. Honesty over hype.",
    },
    {
        "seed_key": "starter-st-shop-tour",
        "category": "show-tell",
        "title": "Workshop layout tour — how do you fit a CNC, a plasma, and a finish booth in 400 sq ft?",
        "body": "Garage and basement makers, drop a photo of your shop layout. What's working? What would you change? Curious if anyone's solved dust + plasma slag co-existence without going to two separate buildings.",
    },
    # ─────────────── general ───────────────
    {
        "seed_key": "starter-gen-introduce-yourself",
        "category": "general",
        "title": "New here? Introduce yourself — workshop, machine, what you make, where you're from",
        "body": "Welcome to the Crafters Market forum. Drop a quick intro: your shop, your main machine, what you build, and what you're trying to learn from this community. We'll pin the best ones.",
    },
    {
        "seed_key": "starter-gen-pricing-handcrafted",
        "category": "general",
        "title": "Honest pricing thread — how do you actually price a 6-hour custom CNC sign?",
        "body": "Material + machine time + finish + shop overhead + design time + your hourly rate. What's the formula you actually use, and how do you defend it when a buyer says 'it's just a piece of wood'? No judgment — open conversation.",
    },
]


async def _ensure_seed_user() -> dict:
    """Get-or-create the 'Crafters Market Team' poster user."""
    existing = await db.community_users.find_one(
        {"email": SEED_USER_EMAIL}, {"_id": 0},
    )
    if existing:
        return existing
    user = {
        "user_id": str(uuid.uuid4()),
        "email": SEED_USER_EMAIL,
        "name": SEED_USER_NAME,
        "auth_provider": "system_seed",
        "created_at": now_iso(),
        "is_admin_team": True,  # cosmetic flag for UI badging if we ever want it
    }
    await db.community_users.insert_one(user)
    user.pop("_id", None)
    logger.info("[forum_seed] created seed user %s", SEED_USER_EMAIL)
    return user


async def seed_forum_threads(force: bool = False) -> dict:
    """Idempotent insert. Returns counts.

    Args:
      force: if True, re-insert any threads whose seed_key was previously
             inserted but is now missing from the DB (does NOT delete
             existing rows). Default False just inserts what's missing.
    """
    user = await _ensure_seed_user()

    # Backdate threads slightly so they don't all stack at the same second
    # — gives the forum a more "lived-in" feel on first render.
    base_time = datetime.now(timezone.utc) - timedelta(hours=len(STARTER_THREADS))

    inserted = 0
    skipped = 0
    for idx, t in enumerate(STARTER_THREADS):
        existing = await db.forum_threads.find_one(
            {"seed_key": t["seed_key"]}, {"_id": 0, "id": 1},
        )
        if existing and not force:
            skipped += 1
            continue
        if existing and force:
            # Even with force, don't duplicate — only fill gaps.
            skipped += 1
            continue
        created = (base_time + timedelta(hours=idx)).isoformat()
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "user_email": user["email"],
            "user_name": user["name"],
            "title": t["title"],
            "body": t["body"],
            "category": t["category"],
            "attachments": [],
            "tag": t["category"],
            "reply_count": 0,
            "created_at": created,
            "seed_key": t["seed_key"],
            "is_seed": True,
            "ai_mod_action": "allow",
            "ai_mod_reason": "seeded_by_system",
        }
        await db.forum_threads.insert_one(doc)
        inserted += 1

    summary = {
        "inserted": inserted,
        "skipped": skipped,
        "total_starters_defined": len(STARTER_THREADS),
        "seed_user_email": user["email"],
    }
    logger.info("[forum_seed] %s", summary)
    return summary
