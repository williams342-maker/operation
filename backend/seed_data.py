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

# ---------------------------------------------------------------------------
# iter390 — Category fillers (user request). Starter makers + listings so the
# new craft categories (Pottery & Ceramics, Woodworking, Leather Goods,
# Fiber & Textiles) aren't empty on the storefront/rails. Seeded with
# UPSERT-BY-SLUG in `seed_if_empty`, so they roll out automatically on the
# next production deploy and never duplicate. Edit or retire them from the
# admin once real sellers fill these categories in.
# ---------------------------------------------------------------------------
# Pottery/leather: hand-verified Unsplash photos. Wood/fiber: AI-generated
# product photography (Emergent static CDN) matching each listing exactly.
F_POTTERY_WHEEL = "https://images.unsplash.com/photo-1468322638156-074863f9362e?crop=entropy&cs=srgb&fm=jpg&w=900&q=85"
F_POTTERY_MUGS = "https://images.unsplash.com/photo-1604095616439-216735abec0c?crop=entropy&cs=srgb&fm=jpg&w=900&q=85"
F_POTTERY_BOWLS = "https://images.unsplash.com/photo-1610701596007-11502861dcfa?crop=entropy&cs=srgb&fm=jpg&w=900&q=85"
F_POTTERY_VASE = "https://images.unsplash.com/photo-1525974160448-038dacadcc71?crop=entropy&cs=srgb&fm=jpg&w=900&q=85"
F_VASE_DECOR = "https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?crop=entropy&cs=srgb&fm=jpg&w=900&q=85"
F_WOOD_TOOLS = "https://static.prod-images.emergentagent.com/jobs/ad0439ad-da94-4caf-a818-28a88417ad46/images/8c3be549be7647ebd6b2474075dd4073f0f7f7c19899716b0f8e22afd46d0d01.png"
F_WOOD_BENCH = "https://static.prod-images.emergentagent.com/jobs/ad0439ad-da94-4caf-a818-28a88417ad46/images/f4f59686150c480dd0c3737a57b2e0c12ee63506e7c4d56f189bb97ef3cbb3f4.png"
F_WOOD_BOWL = "https://static.prod-images.emergentagent.com/jobs/ad0439ad-da94-4caf-a818-28a88417ad46/images/6ad6ba41aba7ad691fc8d84b56346674335a977771b20e6e89e9647bc087e682.png"
F_WOOD_BOARD = "https://static.prod-images.emergentagent.com/jobs/ad0439ad-da94-4caf-a818-28a88417ad46/images/94f8492b879e1c818ce47acfc4bbf99b51258f23d5d251258ee739565cc4f037.png"
F_LEATHER_SHOP = "https://images.unsplash.com/photo-1473188588951-666fce8e7c68?crop=entropy&cs=srgb&fm=jpg&w=900&q=85"
F_LEATHER_GOODS = "https://images.unsplash.com/photo-1517254797898-04edd251bfb3?crop=entropy&cs=srgb&fm=jpg&w=900&q=85"
F_FIBER_WEAVE = "https://static.prod-images.emergentagent.com/jobs/ad0439ad-da94-4caf-a818-28a88417ad46/images/73c7fbda93becf28739e8c924e2338017c00ec0f61d310052007a909e5da60d6.png"
F_FIBER_HANG = "https://static.prod-images.emergentagent.com/jobs/ad0439ad-da94-4caf-a818-28a88417ad46/images/726f314711119649e49e73f1d347dcdc5ae477dac02a3edcf47526939defc817.png"
F_FIBER_KNIT = "https://static.prod-images.emergentagent.com/jobs/ad0439ad-da94-4caf-a818-28a88417ad46/images/bae7e2c47f04e7e4333e29d80bc05919535b58bb65c0b8c240ccc571f4f4fbb5.png"

SEED_FILLER_MAKERS = [
    {"slug": "kiln-and-clay", "name": "Kiln & Clay Studio", "initials": "KC", "location": "Asheville, NC",
     "email": "kiln-and-clay@craftersmarket.org",
     "bio": "Small-batch stoneware studio. Every mug, bowl, and vase is wheel-thrown, trimmed, and glazed by hand in our mountain workshop.",
     "techniques": ["CUSTOM"],
     "portrait": F_POTTERY_WHEEL, "cover": F_POTTERY_BOWLS,
     "listings_count": 3, "rating": 4.92},
    {"slug": "loom-and-thread", "name": "Loom & Thread Co.", "initials": "LT", "location": "Santa Fe, NM",
     "email": "loom-and-thread@craftersmarket.org",
     "bio": "Hand-woven wall hangings, macramé, and natural-fiber textiles dyed with desert botanicals and woven on a 1940s floor loom.",
     "techniques": ["CUSTOM"],
     "portrait": F_FIBER_WEAVE, "cover": F_FIBER_HANG,
     "listings_count": 3, "rating": 4.89},
]

SEED_FILLER_PRODUCTS = [
    # ---- Pottery & Ceramics (kiln-and-clay) ----
    {"slug": "hand-thrown-stoneware-mug-set", "title": "Hand-Thrown Stoneware Mug Set", "category": "Pottery & Ceramics",
     "technique": "CUSTOM", "price": 68.0, "maker_slug": "kiln-and-clay",
     "description": "Set of two 12oz wheel-thrown mugs in speckled stoneware with a satin glaze. Dishwasher and microwave safe. Each pair varies slightly — that's the point.",
     "materials": ["Speckled stoneware", "Food-safe satin glaze"], "dimensions": '4" tall · 12oz · set of 2',
     "shipping_est_delivery": "5-7 business days",
     "images": [F_POTTERY_MUGS, F_POTTERY_WHEEL]},
    {"slug": "glazed-serving-bowl-earthen", "title": "Glazed Serving Bowl — Earthen", "category": "Pottery & Ceramics",
     "technique": "CUSTOM", "price": 89.0, "maker_slug": "kiln-and-clay",
     "description": '10" serving bowl thrown from local clay and finished in a layered earthen glaze. Sturdy enough for daily salads, pretty enough for the open shelf.',
     "materials": ["Local stoneware clay", "Layered glaze"], "dimensions": '10" diameter',
     "shipping_est_delivery": "5-7 business days",
     "images": [F_POTTERY_BOWLS, F_POTTERY_WHEEL]},
    {"slug": "wheel-thrown-bud-vase-trio", "title": "Wheel-Thrown Bud Vase Trio", "category": "Pottery & Ceramics",
     "technique": "CUSTOM", "price": 54.0, "maker_slug": "kiln-and-clay",
     "description": "Three petite bud vases in graduated heights, glazed in complementary neutrals. Styled together or scattered around the house.",
     "materials": ["Stoneware", "Matte glaze"], "dimensions": '3–6" tall · set of 3',
     "shipping_est_delivery": "5-7 business days",
     "images": [F_POTTERY_VASE, F_VASE_DECOR]},
    # ---- Woodworking (oakridge-woodcraft) ----
    {"slug": "turned-walnut-catchall-bowl", "title": "Turned Walnut Catch-All Bowl", "category": "Woodworking",
     "technique": "CUSTOM", "price": 95.0, "maker_slug": "oakridge-woodcraft",
     "description": 'Lathe-turned from a single block of American black walnut and finished with food-safe oil. Keys, rings, coins — or salt at the stove.',
     "materials": ["American black walnut", "Food-safe oil finish"], "dimensions": '7" diameter',
     "shipping_est_delivery": "4-6 business days",
     "images": [F_WOOD_BOWL, F_WOOD_TOOLS]},
    {"slug": "end-grain-chopping-block", "title": "End-Grain Chopping Block", "category": "Woodworking",
     "technique": "CUSTOM", "price": 145.0, "maker_slug": "oakridge-woodcraft",
     "description": 'Checkerboard end-grain block in maple and walnut. Self-healing surface that keeps knives sharp. Conditioned with board butter before shipping.',
     "materials": ["Hard maple", "Black walnut", "Board butter"], "dimensions": '16" × 12" × 2"',
     "shipping_est_delivery": "4-6 business days",
     "images": [F_WOOD_BOARD, F_WOOD_BENCH]},
    {"slug": "dovetail-keepsake-box", "title": "Dovetail Keepsake Box", "category": "Woodworking",
     "technique": "ROUTER", "price": 120.0, "maker_slug": "oakridge-woodcraft",
     "description": "Hand-cut dovetail joinery in quartersawn white oak with a felt-lined interior. A small box meant to outlast everything you keep in it.",
     "materials": ["Quartersawn white oak", "Felt lining"], "dimensions": '9" × 6" × 4"',
     "shipping_est_delivery": "4-6 business days",
     "images": [F_WOOD_TOOLS, F_WOOD_BENCH]},
    # ---- Leather Goods (hidehouse-craft) ----
    {"slug": "saddle-stitched-bifold-wallet", "title": "Saddle-Stitched Bifold Wallet", "category": "Leather Goods",
     "technique": "CUSTOM", "price": 78.0, "maker_slug": "hidehouse-craft",
     "description": "Full-grain vegetable-tanned bifold, saddle-stitched by hand with waxed linen thread. Develops a deep patina with every year of carry.",
     "materials": ["Full-grain veg-tan leather", "Waxed linen thread"], "dimensions": '4.5" × 3.5"',
     "shipping_est_delivery": "3-5 business days",
     "images": [F_LEATHER_GOODS, F_LEATHER_SHOP]},
    {"slug": "leather-journal-cover-a5", "title": "Leather Journal Cover — A5", "category": "Leather Goods",
     "technique": "CUSTOM", "price": 92.0, "maker_slug": "hidehouse-craft",
     "description": "Wrap-around A5 cover in oiled buffalo leather with an adjustable cord closure. Fits standard A5 notebooks; refit it for decades.",
     "materials": ["Oiled buffalo leather", "Leather cord"], "dimensions": 'Fits A5 notebooks',
     "shipping_est_delivery": "3-5 business days",
     "images": [F_LEATHER_SHOP, F_LEATHER_GOODS]},
    {"slug": "hand-tooled-leather-belt", "title": "Hand-Tooled Leather Belt", "category": "Leather Goods",
     "technique": "CUSTOM", "price": 110.0, "maker_slug": "hidehouse-craft",
     "description": "Single-piece 10oz harness leather belt, edges burnished by hand, solid brass buckle. Cut to your exact waist measurement.",
     "materials": ["10oz harness leather", "Solid brass buckle"], "dimensions": 'Cut to size · 1.5" wide',
     "shipping_est_delivery": "3-5 business days",
     "images": [F_LEATHER_GOODS, F_LEATHER_SHOP]},
    # ---- Fiber & Textiles (loom-and-thread) ----
    {"slug": "handwoven-wall-hanging-mesa", "title": "Handwoven Wall Hanging — Mesa", "category": "Fiber & Textiles",
     "technique": "CUSTOM", "price": 135.0, "maker_slug": "loom-and-thread",
     "description": "Woven on a vintage floor loom in undyed wool and desert-botanical-dyed accents, hung from a foraged driftwood rod.",
     "materials": ["Wool", "Cotton warp", "Driftwood rod"], "dimensions": '24" × 36"',
     "shipping_est_delivery": "5-8 business days",
     "images": [F_FIBER_WEAVE, F_FIBER_HANG]},
    {"slug": "macrame-plant-hanger-duo", "title": "Macramé Plant Hanger Duo", "category": "Fiber & Textiles",
     "technique": "CUSTOM", "price": 58.0, "maker_slug": "loom-and-thread",
     "description": "Two hand-knotted hangers in 3-ply natural cotton rope — one long, one short. Fits 4–8\" pots. Brass ring hardware.",
     "materials": ["Natural cotton rope", "Brass rings"], "dimensions": '28" and 38" drops · set of 2',
     "shipping_est_delivery": "5-8 business days",
     "images": [F_FIBER_HANG, F_FIBER_WEAVE]},
    {"slug": "chunky-knit-lap-throw", "title": "Chunky Knit Lap Throw", "category": "Fiber & Textiles",
     "technique": "CUSTOM", "price": 160.0, "maker_slug": "loom-and-thread",
     "description": "Arm-knit from jumbo merino-blend yarn in a natural oat colorway. Generous lap size — the couch blanket guests always steal.",
     "materials": ["Merino-blend jumbo yarn"], "dimensions": '40" × 60"',
     "shipping_est_delivery": "5-8 business days",
     "images": [F_FIBER_KNIT, F_FIBER_WEAVE]},
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
    # iter390 — category fillers: upsert-by-slug so new entries roll out on
    # the next deploy without duplicating or touching real maker data.
    # Image fields are always re-synced so corrected photo URLs propagate
    # to already-seeded rows on the next deploy (iter391 image fix).
    for m in SEED_FILLER_MAKERS:
        if not await db.makers.find_one({"slug": m["slug"]}, {"_id": 1}):
            await db.makers.insert_one({**Maker(**m).model_dump()})
        else:
            await db.makers.update_one(
                {"slug": m["slug"]},
                {"$set": {"portrait": m["portrait"], "cover": m["cover"]}},
            )
    for p in SEED_FILLER_PRODUCTS:
        if not await db.products.find_one({"slug": p["slug"]}, {"_id": 1}):
            await db.products.insert_one({**Product(**p).model_dump()})
        else:
            await db.products.update_one(
                {"slug": p["slug"]}, {"$set": {"images": p["images"]}},
            )
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
