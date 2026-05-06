"""Seed expert-style replies on starter forum threads.

Without replies, a visitor sees 22 questions and zero answers — feels like
walking into an empty room. This module seeds 4 replies per starter
thread (88 total) from 5 synthetic veteran-maker personas. Personas:

  - Marcus Reed       — plasma + heavy metal, Texas, blunt
  - Karen Holtz       — wood signs, V-carving, Pacific NW, methodical
  - Tony Rivera       — multi-machine garage shop, FL, troubleshooting nerd
  - Sam Whitcombe     — hobbyist turned semi-pro, MI, budget-conscious
  - Jess Abernathy    — laser engraving + photography, NJ, polished

These are clearly synthetic seed accounts (flagged `is_seed_persona`)
created in `community_users` — they do NOT impersonate real Crafters
Market makers and have no `maker_slug`. Replies offer real,
within-consensus technical advice. Personas occasionally disagree with
each other to mirror healthy forum dynamics.

Idempotent: replies are matched on `(thread_seed_key, persona_email,
order)` so re-running inserts only what's missing.

Trigger via the admin endpoint `POST /api/admin/forum/seed-replies`.
"""
from __future__ import annotations

import uuid
from typing import List, Dict, Tuple
from datetime import datetime, timezone, timedelta

from core import db, logger, now_iso

PERSONAS: List[Dict[str, str]] = [
    {
        "email": "marcus.reed.seed@craftersmarket.org",
        "name": "Marcus Reed",
        "bio": "Plasma + heavy metal, TX",
    },
    {
        "email": "karen.holtz.seed@craftersmarket.org",
        "name": "Karen Holtz",
        "bio": "Wood signs · V-carve · PNW",
    },
    {
        "email": "tony.rivera.seed@craftersmarket.org",
        "name": "Tony Rivera",
        "bio": "Multi-machine garage shop · FL",
    },
    {
        "email": "sam.whitcombe.seed@craftersmarket.org",
        "name": "Sam Whitcombe",
        "bio": "Semi-pro · budget builds · MI",
    },
    {
        "email": "jess.abernathy.seed@craftersmarket.org",
        "name": "Jess Abernathy",
        "bio": "Laser + engraving photos · NJ",
    },
]
# Convenient indices
M, K, T, S, J = 0, 1, 2, 3, 4

# Replies indexed by thread seed_key. Each tuple is (persona_idx, body).
# Bodies are 1-4 sentences, reference real tools/numbers, and sometimes
# disagree with prior replies so the thread reads like a real conversation.
REPLIES: Dict[str, List[Tuple[int, str]]] = {

    # ─────────────── machine-help ───────────────
    "starter-mh-stepper-skipping": [
        (T, "First thing I'd check is the driver current — most hobby boards ship with stepsticks set conservatively. Bump the Vref up by 10% and listen for the motor getting hot to the touch after a 20-minute job. If it does, back off and look elsewhere; if it stays cool you had headroom."),
        (M, "I've seen this almost always trace back to a long unsupported Y-axis — the moment of inertia at 18\" is way different than at 6\". Tighten the belts, but also check that your acceleration setting in the firmware isn't lying to your steppers. Real-world skip happens at the accel curve, not at constant feed."),
        (K, "Don't sleep on dust on the linear rails. I had a maple job skip the same way for two months before I lifted my Y-rail covers and found compacted sawdust acting like a brake. 30 seconds with a brush fixed it permanently."),
        (S, "Microstepping. If you're at 1/32 you're trading torque for smoothness, and on a long Y move that's exactly when you run out of torque. Drop to 1/16 and re-test before changing anything else."),
    ],
    "starter-mh-spindle-runout": [
        (T, "Sharpie test is honestly fine for catching gross runout. Mark the workpiece, plunge a fresh bit, examine the cut shape under a loupe. If the kerf is wider on one side than the other you've got runout. Numbers don't matter at hobby scale — pass/fail is what you need."),
        (M, "$30 dial indicator on Amazon + a magnetic base will get you within 0.001\". You don't need a Haimer for the diagnostic. The Haimer is for when you're chasing tenths."),
        (J, "I rotate the bit slowly by hand against a piece of paper taped to the spoilboard. If the bit drags more on one side as it rotates, runout. Crude but it caught a bent collet on my K40 that the dial indicator missed because the bend was at the bit, not the spindle."),
        (S, "Honest answer for a Makita router: just live with it. The collet is the problem and the fix is buying a precision ER collet adapter ($60). I tried for a year to make the stock collet acceptable. Adapter solved it overnight."),
    ],
    "starter-mh-plasma-pierce-blowout": [
        (M, "9 times out of 10 it's pierce delay. On 1/2\" mild you want closer to 1.5-2 seconds with a quality Hypertherm-style consumable, not the 0.5s your CAM defaults to. Watch the first few pierces and listen — when the arc transfers cleanly through the bottom you've got your number."),
        (T, "Air contamination too. Dryer rated for the unit doesn't matter if you've got oil bypassing it. I added a coalescing filter downstream from my dryer and consumable life doubled overnight. Costs $40."),
        (S, "Are you punching through dross from the previous pierce? If you're within an inch of an old kerf the molten material can blow back into the nozzle. Move pierces 0.25\" further from edges and see."),
        (M, "Also worth saying: ground clamps. If yours is on painted steel or rust, you're piercing at half the amperage you think. Clean steel-to-steel ground every single job."),
    ],
    "starter-mh-z-zero-repeatability": [
        (J, "Fixed tool sensor + tool length probe macro is the only thing that gave me sub-0.001\" repeatability. Cheap optical Z-probe ($20), bolt it to the side of your spoilboard, write the macro once, never think about it again. Mach3 and grblHAL both support it natively."),
        (S, "Touchplate works fine if you cleaning it religiously and never trust the same plate after dropping it. I clamp mine the same way every time using a printed jig — the plate doesn't move, only the bit does."),
        (T, "Paper is honestly the most repeatable for hobby budgets. The reason it works is the paper itself is your accept window — same paper every time = same tolerance. Don't switch from 20lb copy paper to a Post-it and expect agreement."),
        (K, "I went the other direction — I batch all jobs that share a tool. Tool change once at the start of the session, zero once, run all six jobs back to back. Eliminates the problem instead of solving it."),
    ],
    "starter-mh-router-bit-snap": [
        (S, "30 IPM at 18k RPM with a 1/8\" 2-flute is way too low chipload. You're not cutting, you're rubbing. Push to 60 IPM and you'll snap fewer bits, not more. Counter-intuitive but real."),
        (T, "Bit quality matters most. Cheap China-direct bits will snap at the same numbers a real Whiteside or Onsrud handles all day. Spend $15 instead of $5 per bit and the math works out."),
        (M, "Are you climb cutting or conventional? On hardwood with a thin upcut, conventional cut grabs less and I see fewer breaks. Try flipping the direction in CAM."),
        (K, "Also check your collet runout. If the bit is wobbling 0.003\" you're effectively cutting harder on one side and the bit fatigues fast. Fixed my breakage rate by replacing my router collet."),
    ],

    # ─────────────── techniques ───────────────
    "starter-tech-deep-vcarve-letters": [
        (K, "Score the perimeter at half depth first as a separate toolpath — it pre-shears the wood fibers so the V-bit doesn't tear them out at the cusps. Adds 30 seconds per letter and saves the entire job."),
        (J, "Climb cut on figured stock. Conventional cut lifts the figure into the bit and that's where tearout starts. Counter to most general advice but it's specifically true for curl/bird's eye/quilted faces."),
        (T, "Sharper bit. Most tear-out at cusps comes from a bit that's lost its edge somewhere between job 5 and job 50. Mark each new bit with a Sharpie dot and replace it on a schedule, not when it 'looks dull'."),
        (M, "Spray the surface with shellac (50/50 cut) before carving. Stiffens the fibers, V-carves clean, sands off in seconds. Old sign-makers' trick that nobody talks about anymore."),
    ],
    "starter-tech-toolpath-strategy": [
        (T, "Adaptive for anything where stock removal is >50% of the area, raster for everything else. Adaptive's overhead in motion only pays off when you've got real material to clear."),
        (S, "I use parallel raster for soft materials (pine, MDF) at higher feeds because adaptive's constant engagement angle isn't doing anything you couldn't do with a higher feed rate and a 2D pocket."),
        (J, "For 2.5D signs specifically I almost always go 2D pocket + finishing pass. Adaptive is overkill for shallow flat-bottom features and the extra Z plunges add wear without benefit."),
        (M, "If the part is an enclosed pocket, adaptive every time — entry strategies matter and adaptive handles ramping correctly. Open boundaries, raster is faster."),
    ],
    "starter-tech-engraving-photos-on-wood": [
        (J, "Stucki at 254 DPI on basswood gets me 90% there. Atkinson dither + lower DPI looks 'punchier' but loses skin tones. Always test with a face photo, not a landscape — landscapes are forgiving."),
        (M, "Power and speed first, dither second. If you're scorching at 80% power then no dither algorithm saves you. Drop to 30%, double the speed, and let the dither carry the contrast."),
        (S, "Pre-treat with isopropyl alcohol on basswood — wipe surface, let dry 60 seconds, engrave. The alcohol pulls some of the natural oils so the burn is more uniform. Not a magic trick but it's a 5% improvement."),
        (J, "Also: image prep matters more than the dither. Boost mid-tones in Photoshop curves before importing to LightBurn. If your photo's histogram is bunched in the shadows, no dither algorithm fixes that."),
    ],
    "starter-tech-3d-relief-grain-direction": [
        (K, "Yes, real. Do a side-by-side test with the same model in cherry — once across grain, once with grain. The cross-grain version will hold detail at 0.5mm step-over that the with-grain version turns into fuzz."),
        (M, "Matters more in pine and other softwoods. In dense hardwoods (walnut, hard maple) the difference is academic. Choose grain direction for visual aesthetics first, machinability second."),
        (T, "Step-over and bit choice swamp grain direction in importance. 0.05mm step-over with a 1mm tapered ball gets you a clean finish in any wood, any direction. Time-budget vs. detail trade-off."),
        (S, "I orient pieces so the grain runs through the longest dimension of the relief. End-grain in a relief carving is the source of 90% of the fuzz I've ever cut."),
    ],
    "starter-tech-dxf-cleanup-workflow": [
        (J, "Inkscape's 'Path → Simplify' followed by 'Path → Break Apart' then 'Path → Union' on the relevant subset cleans 80% of buyer DXFs in under a minute. Free, scriptable, and the result imports clean into Vectric."),
        (T, "I run every customer DXF through F360's sketch tool with 'Project → Include' and Constraint Auto-fix on. It catches micro-gaps that Inkscape misses and outputs a single clean closed contour."),
        (M, "Keep a checklist on a sticky note on your monitor: (1) all closed? (2) all on one layer? (3) any zero-length lines? (4) text converted to paths? Five seconds per file, catches everything I've ever needed to catch."),
        (K, "Charge for it. Cleanup is real labor; if you don't bill for it you'll resent every job. I added a 'file prep' line to my pricing — $25 minimum on customer-supplied vectors. Buyers respect the work."),
    ],

    # ─────────────── finishing ───────────────
    "starter-fin-sealing-end-grain": [
        (K, "Mineral oil only is not enough for end-grain — you're correct. My stack: pure mineral oil to saturate (24h soak), then Howard's Butcher Block Conditioner (mineral oil + beeswax + carnauba), buffed in. Re-coat at 1 month, 6 months, then yearly. Zero checking in 4 years."),
        (T, "Wood selection matters as much as finish. Hard maple end-grain is forgiving; cherry end-grain is going to check no matter what you do unless you control the kiln-drying yourself. Source pre-stabilized stock if you can."),
        (M, "Shellac under the food-safe layer is fine — shellac IS food-safe once cured (it's the stuff on apples). I do a 1lb cut of dewaxed shellac, wipe-on, then mineral oil + wax over it. Buyers love it."),
        (S, "Climate of the buyer matters. The board you ship to Phoenix in summer is in a different humidity environment than the same board in Seattle. Include a 1-page care card with your finishes and re-oil schedule. Cuts your callbacks 80%."),
    ],
    "starter-fin-powder-coat-vs-rustoleum": [
        (M, "I draw the line at outdoor exposure. Anything going outside = powder coat, no exceptions. Anything indoor only = quality rattle-can with proper prep. Buyer pays the difference — line it out on the invoice."),
        (S, "Quality 2K epoxy primer + Rust-Oleum Professional has held up 3 years on indoor signs in Michigan winters. The trick is the prep: phosphoric acid wash, primer within 4 hours, top coat within 24. If you're skipping prep then yes, powder coat."),
        (J, "Mid-tier option nobody talks about: Cerakote oven-bake. Same kit as a powder coater but you do it in your shop with a $200 oven. ~$8/sign in materials, looks like factory. Worth it if you're doing >5/week."),
        (T, "Margin question: at $25/job for powder coat, you need to be selling at $80+ for the math to work. If your average sign is $40, rattle-can is the answer until you scale up. No shame in that."),
    ],
    "starter-fin-cnc-blackening": [
        (T, "Mask with Frisket film — it cuts cleanly with a hobby knife along the engraved edge and the cold blue won't migrate under it. Adds 10 minutes per piece but the result is surgical."),
        (M, "Cold blue reacts with whatever's in the surface scratches because the steel there is freshly exposed. The fix is to polish the un-engraved face with 600-grit before blackening. Closed-grain steel = no haze."),
        (J, "I switched to gun-blue paste (Birchwood Casey) instead of liquid. Apply only into the engraved channels with a fine brush, then wipe the surface with denatured alcohol on a Q-tip before it cures. Zero migration."),
        (S, "Heat-bluing works too — propane torch + a piece of 1/4 plate as a heat sink, wipe in oil. Less control but no chemicals and the color is gorgeous on engraved steel. Practice on scrap first, the temperature window is narrow."),
    ],
    "starter-fin-uv-light-aging": [
        (K, "12 months in: outdoor poly + 2 coats of marine spar over a sealed substrate is the only finish I trust outside. Cracked, peeled, yellowed every 'lifetime' single-coat finish I tested. The two-stage approach with proper UV inhibitors is non-negotiable for outdoor."),
        (T, "Indoor walnut with a hand-rubbed tung oil finish — 18 months in a customer's living room, looks better than the day I shipped it. Tung oil patinas the right direction. Lacquers and poly only get worse with age."),
        (M, "Powder-coated steel signs outdoor: zero degradation at 24 months on the desert pieces. Black powder absorbs more UV and shows less, but I haven't seen color shift on properly cured powder in any color yet."),
        (J, "Lasered photos on basswood with a clear matte spar varnish: the wood darkens around the engraving and the contrast actually improves over the first 6 months. Then it stabilizes. I tell buyers their piece will get better before it gets worse."),
    ],

    # ─────────────── resources ───────────────
    "starter-res-feed-speed-calculator": [
        (T, "G-Wizard is the closest to right out of the box. Provencut is excellent but only useful for the specific tool brands they cover. FSWizard is conservative — multiply its feed by 1.3 as a starting point on hobby machines."),
        (M, "I trust no calculator and trust 30 minutes of test cuts on scrap. Calculators give you a starting point; the chip you produce tells you whether to push or back off. Listen to the cut."),
        (S, "Carbide3D's calculator for Carbide3D's bits on Carbide3D's machines is bulletproof. Outside that ecosystem it's useless. Don't try to extend it."),
        (J, "FSWizard mobile app is free and it's the one I keep on my phone for when I'm not at my main computer. Within 10% of G-Wizard's numbers for everything I've tested."),
    ],
    "starter-res-bit-suppliers": [
        (M, "IDC Woodcraft for V-bits and ball noses, Whiteside for everything else. Both ship from the US in 2 days, both replace bad bits without drama. Stop chasing $4 China bits — math doesn't work."),
        (K, "Toolstoday.com (Amana) is the middle ground. ~$15-25 per bit for production-grade carbide, broad selection, and they actually answer the phone if you have a question."),
        (T, "Onsrud direct if you're doing >$500/year in bits. They're industrial pricing but the quality is in another league. Most hobbyists don't need them but if you're production it's the move."),
        (S, "Honest hobbyist tier: Spetool from Amazon. Half the price of Whiteside, lasts 60% as long. Math works at hobby volumes; doesn't work if you're cutting daily."),
    ],
    "starter-res-svg-libraries": [
        (J, "The Noun Project for icons (paid plan, $40/yr, full commercial license including physical reproduction). Crystal clear license language."),
        (K, "Etsy buyout bundles are a trap — most have terms that prohibit selling the cut piece. Read every license. If it says 'small commercial' it almost always caps you at 100 units sold which is useless for a real shop."),
        (M, "Make your own. I learned Inkscape and Illustrator in two weekends and now everything I sell is original work. Eliminates the license question and your prices go up because the design is yours."),
        (T, "Crafters Market's design files area is honestly the cleanest license model I've found — buy once, the maker gets paid, terms are spelled out per file. /community/files."),
    ],
    "starter-res-cam-software-tier-list": [
        (T, "Fusion 360 Personal (free) does 95% of what hobby and small-shop work needs. The post-processor library covers every machine I've owned. Pay only when you outgrow it."),
        (K, "Vectric V-Carve Pro is worth every penny if you do signs. The toolpath quality on V-carves is straight-up better than Fusion. Different tool for a different job."),
        (M, "Carveco Maker subscription model is the right call if you do mixed work — 2D + 3D relief — and don't want to learn Fusion. $15/mo, no perpetual hostage situation."),
        (J, "Aspire is overkill for almost everyone but if you're doing 3D relief commercially it pays for itself in 2-3 jobs. Trial it before paying $2k upfront."),
    ],

    # ─────────────── show-tell ───────────────
    "starter-st-monthly-build": [
        (K, "Cherry serving board with a V-carved family monogram for a wedding gift. 4 hours design + carve, 2 hours finish. Mistake: I forgot to climb-cut the figured grain on one side and tore out the 'M' — had to re-cut after a re-glue. Photo to follow once I'm at the shop."),
        (T, "Plasma-cut steel mailbox flag in the shape of a fishhook for a cabin owner. 1 hour cut, 3 hours powder-coat (rookie mistake: forgot to drill the mounting hole before coating, had to scuff and touch up). Buyer loved it. Lessons: drill all holes pre-finish, every time."),
        (M, "1/4\" steel bigfoot silhouette, 18 inches tall, plasma-cut and weathered. Shop screw-up: I forgot to flip the mirror on the second cut so I have a left-handed bigfoot now. Sold it as 'left-paw edition' for $20 over list. Always sell the mistake."),
        (J, "Engraved walnut wedding clipboard with the couple's vows on the back face. The dither came out muddy at first because I underestimated how dark walnut absorbs the laser. Re-ran at 60% speed, doubled the contrast in pre-prep. Looks great. Always test on the actual species."),
    ],
    "starter-st-shop-tour": [
        (T, "400 sq ft garage in FL: CNC against the long wall, plasma table folds vertically against the short wall when not in use, finish booth is a $50 PVC frame with painter's plastic that tents up over the workpiece. Dust collection is a single 2HP HF unit ducted to both machines through a Y-blast gate."),
        (S, "I gave up trying to put plasma + CNC in the same room. Plasma slag finds its way into router rails no matter what. My CNC is in the basement, plasma is in the detached shed. Two extension cords, no regrets."),
        (M, "Mine: 200 sq ft in a basement. CNC on a roll-around cart, finish work happens in a separate corner with a portable spray booth. Trick is everything is on wheels except the dust collector. Whole shop reconfigures in 15 minutes per project."),
        (K, "Vertical storage. Bit organizers on the wall, plywood scrap in a French cleat system, finishes in a hanging cabinet with a fume vent. Floor space is precious; walls are free."),
    ],

    # ─────────────── general ───────────────
    "starter-gen-introduce-yourself": [
        (M, "Marcus, central Texas. Plasma cabinet + a Powermax 65, mostly oil-and-gas industrial signs and ranch brands for working ranches. Started in 2019, gone full-time 2023. Here to learn finishing — paint is my weak spot."),
        (K, "Karen, outside Portland OR. Shopbot Buddy + a small laser, doing wedding & nursery signs, sometimes V-carved cutting boards. 7 years in, still hobbying but the income covers the shop. Looking for honest pricing conversations."),
        (T, "Tony from Tampa — 5x10 plasma, 4x4 CNC, fiber laser. Multi-material commission shop, half the work is troubleshooting other people's CAM files. If you've got a weird machine problem, post it here, I probably had it last year."),
        (S, "Sam, suburban Detroit. X-Carve Pro and a diode laser, mostly garage/man-cave signs and personalized gifts. Day job + this on the side. Always interested in 'is this worth it?' threads — keeping me honest about not buying every new tool."),
    ],
    "starter-gen-pricing-handcrafted": [
        (S, "My formula: (material × 2) + (machine time × $25/hr) + (shop hourly × design time) + 30% margin. The 2× on material covers waste, sandpaper, sharpie, etc. that you stop tracking by job 3."),
        (M, "Anyone selling at materials + 2x is broke in 18 months. You're not selling material — you're selling a finished product that the buyer can't make themselves. Charge what it's worth and buyers who balk aren't your customers."),
        (T, "I quit answering 'it's just a piece of wood' from buyers. Wasted breath. My pricing page says: 'Each piece takes 4-12 hours of skilled labor across design, machining, and hand-finishing. If that doesn't fit your budget, mass-produced is a great option.' Killed the price-haggle emails entirely."),
        (K, "Build a pricing calculator on a spreadsheet, check it before quoting. The mental math when you're tired at 9pm gives away $20 of margin every time. The spreadsheet is impartial."),
    ],
}


async def _ensure_personas() -> List[dict]:
    """Get-or-create the 5 synthetic veteran-maker community users.
    Returns the user docs in the same order as PERSONAS so callers can
    index into them with the M/K/T/S/J constants."""
    out = []
    for p in PERSONAS:
        existing = await db.community_users.find_one(
            {"email": p["email"]}, {"_id": 0},
        )
        if existing:
            out.append(existing)
            continue
        user = {
            "user_id": str(uuid.uuid4()),
            "email": p["email"],
            "name": p["name"],
            "auth_provider": "system_seed",
            "created_at": now_iso(),
            "is_seed_persona": True,
            "bio": p["bio"],
        }
        await db.community_users.insert_one(user)
        user.pop("_id", None)
        out.append(user)
        logger.info("[forum_seed] created persona %s", p["email"])
    return out


async def seed_forum_replies() -> dict:
    """Idempotent: insert any missing replies. Bumps thread reply_count
    accordingly. Replies are de-duped on (thread_id, persona_email,
    seed_order) so a re-run never doubles up."""
    personas = await _ensure_personas()
    persona_by_idx = {i: personas[i] for i in range(len(PERSONAS))}

    inserted = 0
    skipped = 0
    threads_touched: Dict[str, int] = {}

    for seed_key, items in REPLIES.items():
        thread = await db.forum_threads.find_one(
            {"seed_key": seed_key}, {"_id": 0, "id": 1, "created_at": 1},
        )
        if not thread:
            # Caller forgot to seed threads first; skip silently.
            continue

        # Stagger reply timestamps after the thread by 30 min - 24 hr so
        # they don't all land at the same second.
        try:
            thread_ts = datetime.fromisoformat(thread["created_at"].replace("Z", "+00:00"))
        except Exception:
            thread_ts = datetime.now(timezone.utc) - timedelta(hours=12)

        for order, (persona_idx, body) in enumerate(items):
            persona = persona_by_idx[persona_idx]
            existing = await db.forum_replies.find_one(
                {
                    "thread_id": thread["id"],
                    "user_email": persona["email"],
                    "seed_order": order,
                },
                {"_id": 0, "id": 1},
            )
            if existing:
                skipped += 1
                continue
            reply_ts = thread_ts + timedelta(minutes=30 + order * 47)
            doc = {
                "id": str(uuid.uuid4()),
                "thread_id": thread["id"],
                "user_id": persona["user_id"],
                "user_email": persona["email"],
                "user_name": persona["name"],
                "body": body,
                "attachments": [],
                "created_at": reply_ts.isoformat(),
                "is_seed": True,
                "seed_order": order,
                "ai_mod_action": "allow",
                "ai_mod_reason": "seeded_by_system",
            }
            await db.forum_replies.insert_one(doc)
            inserted += 1
            threads_touched[thread["id"]] = threads_touched.get(thread["id"], 0) + 1

    # Bump reply_count on each touched thread (additive — handles partial re-runs).
    for tid, delta in threads_touched.items():
        await db.forum_threads.update_one(
            {"id": tid}, {"$inc": {"reply_count": delta}},
        )

    summary = {
        "inserted": inserted,
        "skipped": skipped,
        "threads_touched": len(threads_touched),
        "personas": len(personas),
    }
    logger.info("[forum_seed] replies: %s", summary)
    return summary
