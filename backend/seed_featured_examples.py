from config import env_get
"""
Seed "Featured Example" content — Phase 1 of populating the marketplace so
visitors never land on an empty category. Every doc inserted by this
script is tagged `featured_example: true` so the UI renders a transparent
"✦ FEATURED EXAMPLE" / "✦ FOUNDING MAKER" badge — visitors are never
misled into thinking it's a real listing for sale or an actively
transacting maker.

Idempotent: re-running this script is safe. Products are upserted by slug;
images are skipped if the file already exists in
/app/frontend/public/seed-images/featured/. Maker docs are upserted by
slug too.

Run with:
    cd /app/backend && python3 seed_featured_examples.py

The companion purge endpoint at POST /api/admin/seed/featured-content/purge
clears every doc with featured_example=True, leaving organic listings
untouched. Use that once real makers fill the catalog.
"""
import asyncio
import base64
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
from core import db, now_iso  # noqa: E402

# Where the seeded images land. Files are committed to the frontend public/
# directory so they're served via React's static asset pipeline — no R2 or
# CDN round-trips needed for the seed catalogue.
SEED_DIR = Path("/app/frontend/public/seed-images/featured")
SEED_DIR.mkdir(parents=True, exist_ok=True)


# ----------------------------------------------------------------------------
# 3 new "Founding Maker · Platform Showcase" profiles to round out the
# directory (leatherwork, epoxy, blacksmith). Combined with the 5 existing
# seed makers (Iron & Oak, MetalArt Pro, Williams CNC, Oakridge, Blackforge)
# we end at 8 — enough that the /makers page never feels empty.
# ----------------------------------------------------------------------------
SEED_MAKERS = [
    {
        "slug": "hidehouse-craft",
        "name": "Hidehouse Craft",
        "initials": "HC",
        "location": "Bozeman, MT",
        "bio": "Hand-stitched leather goods cut on a fiber laser, beveled by hand. Vegetable-tanned hides from a Wisconsin tannery only — no chrome, no shortcuts. We make pieces that get better with the second decade.",
        "techniques": ["LASER", "CUSTOM"],
        "years_crafting": 9,
        "machinery": ["100W Fiber Laser", "Stitching Pony", "Skiving Knife"],
        "rating": 4.97,
        "image_prompt_portrait": "Studio portrait of a friendly leatherworker in their late 30s wearing a leather apron, holding a partially-stitched dark brown leather wallet, soft warm window light, workshop background slightly blurred, looking at camera, documentary photography style, shallow depth of field",
        "image_prompt_cover": "Wide overhead workbench shot of leather working tools: stitching pony, edge bevelers, dark brown vegetable tanned leather, brass rivets, waxed thread spools, warm tungsten lighting, photographed top-down, magazine quality",
    },
    {
        "slug": "river-and-resin",
        "name": "River & Resin",
        "initials": "RR",
        "location": "Bend, OR",
        "bio": "Live-edge slab tables and epoxy art with translucent river pours tinted to match the actual creeks they're named for. Walnut, maple, black locust — all sourced from blowdowns within 60 miles of the workshop.",
        "techniques": ["ROUTER", "CUSTOM"],
        "years_crafting": 6,
        "machinery": ["CNC Router (4x8)", "Planer", "Vacuum Chamber", "UV Cure Tent"],
        "rating": 4.93,
        "image_prompt_portrait": "Portrait of a female woodworker in her 30s wearing safety glasses pushed up on her forehead, sawdust on her flannel shirt, smiling, holding a small piece of walnut with translucent blue epoxy edge, natural workshop lighting, candid documentary style",
        "image_prompt_cover": "Stunning live-edge walnut river table with deep translucent blue-green epoxy pour, photographed in a sunlit workshop, wide angle, golden hour light streaming through windows, hero shot, magazine quality",
    },
    {
        "slug": "anvil-row-forge",
        "name": "Anvil Row Forge",
        "initials": "AR",
        "location": "Tomah, WI",
        "bio": "Hand-forged steel home goods — fire pokers, pot racks, hooks, candle sconces. Coal fire, 200-pound anvil, no welds where a forge weld will do. Made in a converted dairy barn since 2014.",
        "techniques": ["FORGE", "CUSTOM"],
        "years_crafting": 12,
        "machinery": ["Coal Forge", "200lb Anvil", "Power Hammer", "Belt Grinder"],
        "rating": 4.98,
        "image_prompt_portrait": "Portrait of a bearded blacksmith in his 40s wearing a heavy leather apron, soot on his forearms, holding a glowing red-hot iron rod with tongs, dramatic light from coal forge in background, deep shadows, cinematic style",
        "image_prompt_cover": "Interior of a traditional blacksmith forge with coal fire glowing orange, anvil in foreground, hammers hanging on the wall, hand-forged hooks and pokers arranged on a workbench, moody atmospheric lighting, documentary photography",
    },
]


# ----------------------------------------------------------------------------
# ~26 featured-example products across the 12 light/empty categories.
# Distributed across the 8 makers (5 existing + 3 new) so every maker's
# shop feels populated. Realistic prices, materials, dimensions.
# ----------------------------------------------------------------------------
SEED_PRODUCTS = [
    # ---- Home Decor (3) ----
    {
        "slug": "fe-walnut-floating-shelf-trio",
        "title": "Walnut Floating Shelf Trio",
        "category": "Home Decor",
        "technique": "ROUTER",
        "price": 218.0,
        "maker_slug": "oakridge-woodcraft",
        "description": "Three CNC-cut floating shelves in solid black walnut with hidden steel brackets. Edges are hand-burnished and finished with hardwax oil — no polyurethane, no plastic feel. Mounts flush to drywall with included anchors.",
        "materials": ["Solid Black Walnut", "Powder-Coated Steel Brackets"],
        "length_in": 24, "width_in": 6, "height_in": 1.25,
        "weight_lbs": 9,
        "colors": ["walnut", "black"],
        "in_stock": 8,
        "seo_tags": ["walnut shelf", "floating shelves", "live edge", "cnc shelf", "wall shelf"],
        "image_prompt": "Three walnut wood floating shelves mounted on a white plaster wall, styled with a small brass lamp, a stack of books, and a green ceramic vase, soft daylight, interior magazine photography, clean composition, 4:5 aspect",
    },
    {
        "slug": "fe-laser-engraved-houseplant-tags",
        "title": "Laser-Engraved Bamboo Plant Tags · Set of 20",
        "category": "Home Decor",
        "technique": "LASER",
        "price": 24.0,
        "maker_slug": "williams-cnc",
        "description": "Twenty bamboo stake tags with botanical names laser-engraved one side, your custom note on the other. Weather-treated with food-safe linseed oil. Pre-engraved with common kitchen herbs by default — message us for custom species lists.",
        "materials": ["Sustainably Harvested Bamboo", "Food-Safe Linseed Oil"],
        "length_in": 6, "width_in": 1, "height_in": 0.1,
        "weight_lbs": 0.4,
        "colors": ["natural"],
        "personalization_enabled": True,
        "personalization_instructions": "List up to 20 plant names — botanical name on front, your note on the back (e.g., 'planted 4/2026').",
        "in_stock": 22,
        "seo_tags": ["plant tags", "garden markers", "herb tags", "bamboo", "personalized"],
        "image_prompt": "Twenty bamboo plant stake tags arranged in a neat row on a rustic wooden table, laser-engraved with herb names like Basil, Thyme, Rosemary, natural daylight, top-down photography, shallow depth of field",
    },
    {
        "slug": "fe-resin-river-coaster-set",
        "title": "River-Pour Resin Coaster Set",
        "category": "Home Decor",
        "technique": "ROUTER",
        "price": 78.0,
        "maker_slug": "river-and-resin",
        "description": "Set of four 4-inch coasters with live-edge maple book-matched around a translucent teal epoxy river. Each set is cut from a single slab so the wood grain mirrors across all four. Cork backing protects surfaces.",
        "materials": ["Live-Edge Maple", "UV-Stable Epoxy", "Cork"],
        "length_in": 4, "width_in": 4, "height_in": 0.5,
        "weight_lbs": 1.2,
        "colors": ["natural", "teal"],
        "in_stock": 6,
        "seo_tags": ["resin coasters", "epoxy art", "river table", "maple coasters", "set of 4"],
        "image_prompt": "Four square wooden coasters with live-edge maple wood and translucent teal blue epoxy river running through the center, arranged in a 2x2 grid on a dark slate surface, dramatic side lighting, hero product shot",
    },
    # ---- Wedding Gifts (3) ----
    {
        "slug": "fe-personalized-walnut-cutting-board",
        "title": "Personalized Walnut Wedding Cutting Board",
        "category": "Wedding Gifts",
        "technique": "LASER",
        "price": 89.0,
        "maker_slug": "oakridge-woodcraft",
        "description": "End-grain walnut cutting board with laser-engraved monogram, last name, and wedding date. Reversible — engraving is on one side, full prep surface on the other. Finished with food-safe walnut oil and beeswax.",
        "materials": ["End-Grain Black Walnut", "Beeswax + Walnut Oil"],
        "length_in": 16, "width_in": 12, "height_in": 1.25,
        "weight_lbs": 5,
        "personalization_enabled": True,
        "personalization_instructions": "Provide: monogram letter, last name, and wedding date (e.g., 'M · The Martins · 06.14.2026').",
        "in_stock": 12,
        "seo_tags": ["wedding gift", "cutting board", "personalized", "walnut", "monogram"],
        "image_prompt": "End grain walnut cutting board with elegant laser engraved monogram 'M' and wedding date, photographed on a marble countertop with fresh sourdough bread and a knife, warm window light, lifestyle photography",
    },
    {
        "slug": "fe-steel-couple-silhouette",
        "title": "Custom Couple Silhouette · Steel",
        "category": "Wedding Gifts",
        "technique": "PLASMA",
        "price": 135.0,
        "maker_slug": "metalart-pro",
        "description": "Plasma-cut 14ga steel silhouette of the couple's first names, intertwined, with their wedding date below. Powder-coated matte black. Drilled for floating wall mount or freestanding on a small wood base (included).",
        "materials": ["14ga Cold-Rolled Steel", "Powder Coat", "Solid Oak Base"],
        "length_in": 22, "width_in": 10, "height_in": 0.5,
        "weight_lbs": 3.5,
        "personalization_enabled": True,
        "personalization_instructions": "First names (both partners) + wedding date in MM.DD.YYYY format.",
        "in_stock": 4,
        "seo_tags": ["wedding gift", "couple silhouette", "metal art", "personalized", "plasma cut"],
        "image_prompt": "Plasma-cut matte black steel art piece featuring intertwined couple names 'Sarah and James' with wedding date below, mounted on a solid oak base, photographed against a soft cream background, studio lighting, product shot",
    },
    {
        "slug": "fe-leather-anniversary-album",
        "title": "Hand-Stitched Leather Photo Album",
        "category": "Wedding Gifts",
        "technique": "LASER",
        "price": 168.0,
        "maker_slug": "hidehouse-craft",
        "description": "8x10 photo album in vegetable-tanned saddle leather, hand-stitched with waxed Tiger Thread. 30 archival cardstock pages bound with brass screw posts so the album can be expanded over time. Front cover laser-debossed with names + anniversary.",
        "materials": ["Vegetable-Tanned Leather", "Brass Screw Posts", "Archival Cardstock"],
        "length_in": 11, "width_in": 9, "height_in": 1.5,
        "weight_lbs": 2.2,
        "personalization_enabled": True,
        "personalization_instructions": "Names + wedding date for the front cover. Optional: a short quote (max 60 chars) for the inside flap.",
        "in_stock": 5,
        "seo_tags": ["wedding album", "leather album", "anniversary gift", "photo album", "personalized"],
        "image_prompt": "Hand-stitched vegetable tanned leather photo album with debossed names on cover, photographed on a wooden table with a dried flower bouquet and a vintage Polaroid camera, warm natural light, lifestyle shot",
    },
    # ---- Address Numbers (2) ----
    {
        "slug": "fe-vertical-address-plaque-steel",
        "title": "Vertical Address Plaque · 24 inch",
        "category": "Address Numbers",
        "technique": "PLASMA",
        "price": 95.0,
        "maker_slug": "blackforge-signs",
        "description": "Vertical-stack address plaque in 14ga steel, 4 inches wide × 24 inches tall. Numbers are 4-inch tall, deep-recessed in a slim industrial frame. Powder-coated semi-gloss black. Mounts with two stainless screws (included).",
        "materials": ["14ga Steel", "Powder Coat", "Stainless Steel Screws"],
        "length_in": 24, "width_in": 4, "height_in": 0.4,
        "weight_lbs": 4,
        "personalization_enabled": True,
        "personalization_instructions": "Provide your house number (3-5 digits supported).",
        "in_stock": 14,
        "seo_tags": ["address plaque", "house numbers", "vertical sign", "steel", "modern"],
        "image_prompt": "Vertical matte black steel address plaque with the number '4287' stacked vertically, mounted next to a modern wood-paneled front door, soft afternoon sunlight, architectural photography",
    },
    {
        "slug": "fe-rustic-board-and-batten-house-numbers",
        "title": "Board-and-Batten House Numbers · Cedar",
        "category": "Address Numbers",
        "technique": "ROUTER",
        "price": 82.0,
        "maker_slug": "oakridge-woodcraft",
        "description": "Western red cedar board with raised CNC-routed numbers, sealed with three coats of marine spar varnish for full weather resistance. Numbers stand proud of the board surface — readable from the curb at dusk. Pre-drilled for wall mount.",
        "materials": ["Western Red Cedar", "Marine Spar Varnish"],
        "length_in": 18, "width_in": 7, "height_in": 1.5,
        "weight_lbs": 3,
        "personalization_enabled": True,
        "personalization_instructions": "Your house number (up to 5 digits).",
        "in_stock": 7,
        "seo_tags": ["house numbers", "cedar", "rustic", "address sign", "board and batten"],
        "image_prompt": "Rustic cedar wood plaque with raised carved house numbers '1842' in a clean serif font, mounted on weathered wood siding next to a farmhouse-style front door, golden hour lighting",
    },
    # ---- Lighting & Lamps (2) ----
    {
        "slug": "fe-edison-bulb-pipe-lamp",
        "title": "Steel Pipe Edison Lamp",
        "category": "Lighting & Lamps",
        "technique": "FORGE",
        "price": 165.0,
        "maker_slug": "anvil-row-forge",
        "description": "Industrial table lamp built from hand-forged 3/4-inch black iron pipe and a single Edison-style 40W bulb. UL-listed cloth-wrapped cord with vintage rocker switch. Heavy cast iron flange base — won't tip from a cord tug.",
        "materials": ["Black Iron Pipe", "Cast Iron Base", "Cloth-Wrapped Cord"],
        "length_in": 6, "width_in": 6, "height_in": 18,
        "weight_lbs": 5.5,
        "colors": ["black"],
        "in_stock": 6,
        "seo_tags": ["edison lamp", "industrial lamp", "pipe lamp", "table lamp", "steampunk"],
        "image_prompt": "Industrial style table lamp made from black iron pipe fittings with a glowing vintage Edison bulb, sitting on a reclaimed wood desk next to an open notebook, moody warm tungsten lighting, dark background",
    },
    {
        "slug": "fe-walnut-pendant-shade",
        "title": "Geometric Walnut Pendant Shade",
        "category": "Lighting & Lamps",
        "technique": "ROUTER",
        "price": 142.0,
        "maker_slug": "oakridge-woodcraft",
        "description": "12-sided CNC-cut walnut pendant shade, finished inside with white interior paint to reflect light warmly. Hardwired 6-foot black cord with ceiling canopy. UL-listed E26 socket included. Bulb sold separately (we recommend a 6W LED filament).",
        "materials": ["Solid Black Walnut", "Steel Cord Grip", "UL-Listed Socket"],
        "length_in": 12, "width_in": 12, "height_in": 10,
        "weight_lbs": 3,
        "colors": ["walnut"],
        "in_stock": 5,
        "seo_tags": ["pendant light", "walnut shade", "geometric", "modern lighting", "wood lamp"],
        "image_prompt": "Geometric 12-sided walnut wood pendant lamp shade hanging over a kitchen island, glowing warmly with an Edison filament bulb, modern interior, evening lighting, architectural photography",
    },
    # ---- Garden & Yard Art (3) ----
    {
        "slug": "fe-rusted-steel-prairie-grass",
        "title": "Prairie Grass Garden Stakes · Set of 3",
        "category": "Garden & Yard Art",
        "technique": "PLASMA",
        "price": 88.0,
        "maker_slug": "metalart-pro",
        "description": "Three plasma-cut prairie grass silhouettes in raw 11-gauge steel, designed to develop a deep amber patina outdoors over the first season. Each stake stands 36 inches tall — drives directly into garden soil, no concrete needed.",
        "materials": ["11ga Cold-Rolled Steel", "Raw Finish (Patinas Naturally)"],
        "length_in": 18, "width_in": 0.5, "height_in": 36,
        "weight_lbs": 8,
        "colors": ["rust"],
        "in_stock": 4,
        "seo_tags": ["garden art", "metal stakes", "prairie", "outdoor sculpture", "rust patina"],
        "image_prompt": "Three rusted steel prairie grass silhouette garden stakes standing in a wildflower meadow, golden hour backlight creating glowing edges, deep amber patina on the steel, fine art photography",
    },
    {
        "slug": "fe-cor-ten-fire-pit",
        "title": "Cor-Ten Steel Fire Pit",
        "category": "Garden & Yard Art",
        "technique": "PLASMA",
        "price": 485.0,
        "maker_slug": "blackforge-signs",
        "description": "30-inch diameter Cor-Ten steel fire pit with laser-cut tree silhouette air vents around the sides. Cor-Ten weathers to a rich rust patina over 6-12 months while staying structurally sound. Heavy 3/16-inch wall thickness — built to outlive most patios.",
        "materials": ["3/16in Cor-Ten Steel"],
        "length_in": 30, "width_in": 30, "height_in": 16,
        "weight_lbs": 58,
        "colors": ["rust"],
        "in_stock": 3,
        "seo_tags": ["fire pit", "corten steel", "outdoor", "patio", "rust"],
        "image_prompt": "Round Cor-Ten weathered steel fire pit with cut-out tree silhouettes around the rim, fire glowing inside at dusk, set on a stone patio with two Adirondack chairs nearby, atmospheric evening photography",
    },
    {
        "slug": "fe-forged-garden-trowel",
        "title": "Hand-Forged Garden Trowel",
        "category": "Garden & Yard Art",
        "technique": "FORGE",
        "price": 72.0,
        "maker_slug": "anvil-row-forge",
        "description": "Forged from a single piece of 1095 high-carbon steel, then heat-treated and hammered to a bright finish. Walnut handle is shaped to fit a working hand — not a display piece. Will last three generations if you rub it with linseed oil once a year.",
        "materials": ["1095 High-Carbon Steel", "Solid Walnut Handle"],
        "length_in": 13, "width_in": 3, "height_in": 1,
        "weight_lbs": 0.8,
        "in_stock": 9,
        "seo_tags": ["hand forged", "garden tool", "blacksmith", "carbon steel", "trowel"],
        "image_prompt": "Hand forged carbon steel garden trowel with a polished walnut handle, lying on a wooden potting bench next to terra cotta pots and a coil of jute twine, warm window light, lifestyle photography",
    },
    # ---- Memorial & Tribute (2) ----
    {
        "slug": "fe-memorial-tree-plaque",
        "title": "Memorial Tree Plaque · Custom Inscription",
        "category": "Memorial & Tribute",
        "technique": "LASER",
        "price": 68.0,
        "maker_slug": "williams-cnc",
        "description": "5×7 weather-treated cedar plaque with laser-engraved tree-of-life motif and your custom inscription. Hidden steel stake on the back stays invisible when planted at the base of a memorial tree. Hand-rubbed with linseed oil — no plastic finish.",
        "materials": ["Western Red Cedar", "Stainless Steel Stake"],
        "length_in": 7, "width_in": 5, "height_in": 12,
        "weight_lbs": 1.5,
        "personalization_enabled": True,
        "personalization_instructions": "Up to 4 lines of inscription (name, dates, short verse).",
        "in_stock": 8,
        "seo_tags": ["memorial plaque", "tree of life", "tribute", "personalized", "cedar"],
        "image_prompt": "Cedar wood memorial plaque with engraved tree of life design and inscription, photographed beside a young sapling in a quiet garden setting, soft morning light, contemplative mood",
    },
    {
        "slug": "fe-steel-veterans-shadow-box",
        "title": "Veteran's Shadow Box · Steel + Walnut",
        "category": "Memorial & Tribute",
        "technique": "PLASMA",
        "price": 245.0,
        "maker_slug": "iron-and-oak",
        "description": "Shadow box display for a folded flag, plus space for a service photo and three medals. Walnut frame with a plasma-cut steel back panel laser-engraved with service branch insignia, name, and dates of service.",
        "materials": ["Solid Walnut", "14ga Steel", "Museum-Grade Acrylic"],
        "length_in": 14, "width_in": 14, "height_in": 4,
        "weight_lbs": 7,
        "personalization_enabled": True,
        "personalization_instructions": "Branch (Army/Navy/Marines/Air Force/Coast Guard/Space Force), full name, rank, dates of service.",
        "in_stock": 4,
        "seo_tags": ["veterans gift", "shadow box", "memorial", "flag display", "personalized"],
        "image_prompt": "Walnut wood shadow box with a folded American flag inside, military service photo, three medals, and a steel back panel engraved with military insignia, photographed on a wood-paneled wall, dignified lighting",
    },
    # ---- Furniture (2) ----
    {
        "slug": "fe-walnut-epoxy-river-table",
        "title": "Walnut Live-Edge River Coffee Table",
        "category": "Furniture",
        "technique": "ROUTER",
        "price": 1850.0,
        "maker_slug": "river-and-resin",
        "description": "48-inch live-edge walnut river coffee table with a deep translucent emerald epoxy pour. Hairpin steel legs (powder-coated black) included. Each slab is unique — message us for current available pours before ordering. Built to last 100 years.",
        "materials": ["Live-Edge Black Walnut", "UV-Stable Epoxy", "Powder-Coated Steel Legs"],
        "length_in": 48, "width_in": 22, "height_in": 18,
        "weight_lbs": 75,
        "colors": ["walnut", "emerald"],
        "in_stock": 1,
        "seo_tags": ["river table", "live edge", "walnut", "coffee table", "epoxy"],
        "image_prompt": "Stunning live-edge walnut river coffee table with deep translucent emerald green epoxy pour, hairpin steel legs, photographed in a sunlit modern living room, magazine quality hero shot",
    },
    {
        "slug": "fe-industrial-pipe-bookshelf",
        "title": "Industrial Pipe + Oak Bookshelf",
        "category": "Furniture",
        "technique": "ROUTER",
        "price": 595.0,
        "maker_slug": "blackforge-signs",
        "description": "5-shelf industrial bookcase: 3/4-inch black iron pipe frame with reclaimed white oak shelves. Each shelf is 36×11 inches and rated for 50lbs of books. Hardware-grade flanges, no decorative knockoffs.",
        "materials": ["Reclaimed White Oak", "3/4in Black Iron Pipe", "Cast Iron Flanges"],
        "length_in": 36, "width_in": 11, "height_in": 72,
        "weight_lbs": 78,
        "colors": ["oak", "black"],
        "in_stock": 2,
        "seo_tags": ["industrial bookshelf", "pipe shelf", "reclaimed oak", "bookcase", "loft style"],
        "image_prompt": "Industrial style 5-shelf bookcase made from black iron pipe and reclaimed white oak boards, filled with books, plants, and pottery, photographed in a loft apartment with exposed brick wall, natural light",
    },
    # ---- Kitchen & Bar (3) ----
    {
        "slug": "fe-end-grain-butcher-block",
        "title": "Heirloom End-Grain Butcher Block",
        "category": "Kitchen & Bar",
        "technique": "ROUTER",
        "price": 285.0,
        "maker_slug": "oakridge-woodcraft",
        "description": "20×14×2 inch end-grain butcher block in checkerboard maple + walnut. Knife marks self-heal because the cut is into the wood end grain, not across the grain. Finished with food-safe walnut oil + beeswax. Re-oil annually.",
        "materials": ["End-Grain Hard Maple", "End-Grain Black Walnut", "Beeswax + Walnut Oil"],
        "length_in": 20, "width_in": 14, "height_in": 2,
        "weight_lbs": 12,
        "in_stock": 5,
        "seo_tags": ["butcher block", "end grain", "cutting board", "maple walnut", "kitchen"],
        "image_prompt": "End grain checkerboard pattern butcher block cutting board in maple and walnut, photographed on a kitchen counter with a chef's knife, fresh herbs, and a heirloom tomato, warm morning light, food photography style",
    },
    {
        "slug": "fe-steel-wine-rack-12-bottle",
        "title": "Twelve-Bottle Steel Wine Rack",
        "category": "Kitchen & Bar",
        "technique": "PLASMA",
        "price": 195.0,
        "maker_slug": "metalart-pro",
        "description": "Wall-mounted wine rack: 14ga steel, plasma-cut with a vine pattern across the back panel, holds 12 bottles in two staggered rows. Powder-coated matte black. Mounts to studs with included lag bolts.",
        "materials": ["14ga Steel", "Powder Coat", "Lag Bolts"],
        "length_in": 32, "width_in": 6, "height_in": 24,
        "weight_lbs": 9,
        "colors": ["black"],
        "in_stock": 6,
        "seo_tags": ["wine rack", "wall mounted", "steel", "12 bottle", "matte black"],
        "image_prompt": "Wall-mounted matte black steel wine rack holding twelve wine bottles in two staggered rows, mounted on a kitchen wall with subway tile backsplash, soft kitchen lighting, lifestyle photography",
    },
    {
        "slug": "fe-leather-bar-coasters-set",
        "title": "Leather Bar Coasters · Set of 6",
        "category": "Kitchen & Bar",
        "technique": "LASER",
        "price": 58.0,
        "maker_slug": "hidehouse-craft",
        "description": "Six 4-inch round coasters cut from full-grain bridle leather, laser-debossed with a subtle compass-rose motif. Edges burnished by hand. Comes in a stitched leather strap for compact storage when entertaining.",
        "materials": ["Full-Grain Bridle Leather"],
        "length_in": 4, "width_in": 4, "height_in": 0.15,
        "weight_lbs": 0.4,
        "in_stock": 8,
        "seo_tags": ["leather coasters", "bar accessories", "barware", "gift set", "full grain"],
        "image_prompt": "Six round leather coasters with debossed compass design, stacked in a small leather strap, photographed on a wooden bar top with a tumbler of whiskey and ice, warm amber lighting, lifestyle product shot",
    },
    # ---- Sculpture (2) ----
    {
        "slug": "fe-steel-buffalo-silhouette",
        "title": "Bison Silhouette Sculpture · 36 inch",
        "category": "Sculpture",
        "technique": "PLASMA",
        "price": 325.0,
        "maker_slug": "metalart-pro",
        "description": "Freestanding plasma-cut bison silhouette in 14ga steel, 36 inches long, raw finish allowed to develop a natural rust patina. Welded steel stand keeps it upright on any flat surface. Hand-finished — every piece has its own grain.",
        "materials": ["14ga Cold-Rolled Steel"],
        "length_in": 36, "width_in": 8, "height_in": 24,
        "weight_lbs": 14,
        "colors": ["rust"],
        "in_stock": 3,
        "seo_tags": ["bison sculpture", "buffalo art", "metal sculpture", "western", "freestanding"],
        "image_prompt": "Large freestanding rusted steel silhouette sculpture of a bison, 36 inches long, placed on a stone fireplace mantel in a craftsman style living room, dramatic side lighting, fine art photography",
    },
    {
        "slug": "fe-hand-forged-iron-spire",
        "title": "Forged Iron Garden Spire",
        "category": "Sculpture",
        "technique": "FORGE",
        "price": 195.0,
        "maker_slug": "anvil-row-forge",
        "description": "Hand-forged tapered iron spire, 48 inches tall, with a single twisted finial at the peak. Driven into garden soil — adds vertical presence to a flower bed without overwhelming it. Develops a deep brown patina over the first year outdoors.",
        "materials": ["Hand-Forged Iron", "Linseed Oil Seal"],
        "length_in": 3, "width_in": 3, "height_in": 48,
        "weight_lbs": 6,
        "colors": ["iron"],
        "in_stock": 4,
        "seo_tags": ["forged sculpture", "garden spire", "wrought iron", "blacksmith", "outdoor art"],
        "image_prompt": "Hand forged tapered iron garden spire with a twisted finial at the top, photographed in a wildflower garden in summer, golden hour lighting, fine art photography",
    },
    # ---- Jewelry (1) ----
    {
        "slug": "fe-copper-mountain-pendant",
        "title": "Copper Mountain Range Pendant",
        "category": "Jewelry",
        "technique": "LASER",
        "price": 48.0,
        "maker_slug": "williams-cnc",
        "description": "Hand-finished copper pendant cut on a fiber laser — a stylized mountain range silhouette with a tiny pierced sun above the peaks. Antiqued and sealed with a non-tarnish coat. 18-inch sterling chain included.",
        "materials": ["Solid Copper", "Sterling Silver Chain"],
        "length_in": 1.25, "width_in": 0.75, "height_in": 0.05,
        "weight_lbs": 0.05,
        "colors": ["copper"],
        "in_stock": 16,
        "seo_tags": ["copper pendant", "mountain jewelry", "necklace", "handmade", "outdoor lover"],
        "image_prompt": "Close-up macro photo of a copper mountain range pendant necklace with a small pierced sun above the peaks, antiqued patina, on a sterling silver chain, draped on dark slate, dramatic lighting, jewelry photography",
    },
    # ---- Holiday & Seasonal (2) ----
    {
        "slug": "fe-laser-cut-holiday-ornaments",
        "title": "Laser-Cut Holiday Ornament Set · 6 pieces",
        "category": "Holiday & Seasonal",
        "technique": "LASER",
        "price": 38.0,
        "maker_slug": "williams-cnc",
        "description": "Six laser-cut maple ornaments — pine cones, stars, snowflakes — each personalized with a family name. Comes pre-strung with natural twine. Lightly oiled finish.",
        "materials": ["Hard Maple", "Natural Twine"],
        "length_in": 3.5, "width_in": 3.5, "height_in": 0.15,
        "weight_lbs": 0.4,
        "personalization_enabled": True,
        "personalization_instructions": "Family name (engraved on each ornament).",
        "in_stock": 18,
        "seo_tags": ["holiday ornaments", "christmas", "personalized", "wood ornaments", "tree decorations"],
        "image_prompt": "Six wooden laser-cut Christmas ornaments hanging on a frosted pine branch, each with a family name engraved, soft snow falling, warm twinkle light, holiday lifestyle photography",
    },
    {
        "slug": "fe-steel-pumpkin-trio",
        "title": "Welded Steel Pumpkin Trio",
        "category": "Holiday & Seasonal",
        "technique": "FORGE",
        "price": 128.0,
        "maker_slug": "anvil-row-forge",
        "description": "Three forged-steel pumpkins in graduated sizes (6, 8, 10 inches), each with a hand-curled iron stem. Raw finish patinas to a rich brown — display indoors or out. Heavy enough that they don't blow off a porch step.",
        "materials": ["Mild Steel", "Wrought Iron Stems"],
        "length_in": 10, "width_in": 10, "height_in": 10,
        "weight_lbs": 10,
        "colors": ["rust", "iron"],
        "in_stock": 5,
        "seo_tags": ["steel pumpkin", "fall decor", "autumn", "metal pumpkin", "rustic"],
        "image_prompt": "Three welded steel pumpkins in graduated sizes with hand curled iron stems, photographed on a rustic porch step with autumn leaves, warm golden hour light, cozy fall lifestyle",
    },
    # ---- Outdoor Art (1 boost) ----
    {
        "slug": "fe-copper-weather-vane",
        "title": "Hand-Cut Copper Weather Vane · Running Horse",
        "category": "Outdoor Art",
        "technique": "PLASMA",
        "price": 268.0,
        "maker_slug": "blackforge-signs",
        "description": "Plasma-cut copper running-horse weather vane on a polished brass spindle with cardinal direction arrows. Lifetime piece — copper patinas through bright penny, to brown, to verdigris green over 10-15 years. Roof mount included.",
        "materials": ["Solid Copper", "Brass Spindle", "Stainless Mount"],
        "length_in": 18, "width_in": 4, "height_in": 22,
        "weight_lbs": 4,
        "colors": ["copper"],
        "in_stock": 3,
        "seo_tags": ["weather vane", "copper", "horse", "rooftop", "patina"],
        "image_prompt": "Copper running horse weather vane atop a red barn roof, silhouetted against a deep blue sky at sunset, with cardinal direction arrows visible, atmospheric photography",
    },
]


# ----------------------------------------------------------------------------
# Image generation via Nano Banana. Saves JPEG to the seed-images/featured/
# directory. Returns the public path (e.g. "/seed-images/featured/foo.jpg")
# usable as a Product.images[] entry. Skips generation if the file already
# exists — makes the seed script fully idempotent and rerunnable.
# ----------------------------------------------------------------------------
async def _generate_image(slug: str, prompt: str) -> str:
    out_path = SEED_DIR / f"{slug}.jpg"
    public_path = f"/seed-images/featured/{slug}.jpg"
    if out_path.exists():
        return public_path

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        print(f"  [WARN] emergentintegrations missing ({e}) — leaving placeholder")
        return public_path

    api_key = env_get("EMERGENT_LLM_KEY")
    if not api_key:
        print("  [WARN] EMERGENT_LLM_KEY not set — leaving placeholder")
        return public_path

    chat = (
        LlmChat(api_key=api_key, session_id=f"seed-{slug}-{uuid.uuid4().hex[:8]}",
                system_message="You generate cohesive, well-composed product photography for an artisan marketplace. Photos should look authentic, not AI-rendered. Avoid text, watermarks, or logos in the image.")
        .with_model("gemini", "gemini-3.1-flash-image-preview")
        .with_params(modalities=["image", "text"])
    )

    try:
        msg = UserMessage(text=prompt)
        _text, images = await chat.send_message_multimodal_response(msg)
        if not images:
            print(f"  [WARN] no image returned for {slug}")
            return public_path
        img_bytes = base64.b64decode(images[0]["data"])
        out_path.write_bytes(img_bytes)
        print(f"  ✓ {slug}.jpg ({len(img_bytes)//1024}KB)")
    except Exception as e:
        print(f"  [WARN] image gen failed for {slug}: {e}")

    return public_path


# ----------------------------------------------------------------------------
# Upsert helpers — preserve existing _id / created_at on rerun so we never
# duplicate listings even if the seed runs ten times.
# ----------------------------------------------------------------------------
async def _upsert_maker(m: dict):
    portrait_path = await _generate_image(f"maker-{m['slug']}-portrait", m["image_prompt_portrait"])
    cover_path = await _generate_image(f"maker-{m['slug']}-cover", m["image_prompt_cover"])
    doc = {
        "id": str(uuid.uuid4()),
        "slug": m["slug"],
        "name": m["name"],
        "initials": m["initials"],
        "location": m["location"],
        "bio": m["bio"],
        "techniques": m["techniques"],
        "years_crafting": m.get("years_crafting"),
        "machinery": m.get("machinery", []),
        "workshop_videos": [],
        "portrait": portrait_path,
        "cover": cover_path,
        "listings_count": 0,
        "rating": m.get("rating", 4.95),
        "subscription_status": "free",
        "listings_by_month": {},
        "listings_used_lifetime": 0,
        "pending_charges_cents": 0,
        "listing_credits": 0,
        "charge_history": [],
        "featured_example": True,
        "created_at": now_iso(),
    }
    existing = await db.makers.find_one({"slug": m["slug"]}, {"_id": 0, "id": 1, "created_at": 1})
    if existing:
        doc["id"] = existing.get("id", doc["id"])
        doc["created_at"] = existing.get("created_at", doc["created_at"])
    await db.makers.update_one({"slug": m["slug"]}, {"$set": doc}, upsert=True)


async def _upsert_product(p: dict):
    image_path = await _generate_image(p["slug"], p["image_prompt"])
    expires_at = (datetime.now(timezone.utc) + timedelta(days=120)).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "slug": p["slug"],
        "title": p["title"],
        "category": p["category"],
        "technique": p["technique"],
        "price": p["price"],
        "description": p["description"],
        "materials": p.get("materials", []),
        "dimensions": " × ".join(str(p[k]) for k in ("length_in", "width_in", "height_in") if p.get(k) is not None),
        "length_in": p.get("length_in"),
        "width_in": p.get("width_in"),
        "height_in": p.get("height_in"),
        "dim_unit": "in",
        "weight_lbs": p.get("weight_lbs"),
        "colors": p.get("colors", []),
        "in_stock": p.get("in_stock", 5),
        "images": [image_path],
        "maker_slug": p["maker_slug"],
        "status": "published",
        "expires_at": expires_at,
        "renewal_option": "automatic",
        "personalization_enabled": p.get("personalization_enabled", False),
        "personalization_instructions": p.get("personalization_instructions"),
        "seo_tags": p.get("seo_tags", []),
        "variants": [],
        "featured_example": True,
        "created_at": now_iso(),
    }
    existing = await db.products.find_one({"slug": p["slug"]}, {"_id": 0, "id": 1, "created_at": 1})
    if existing:
        doc["id"] = existing.get("id", doc["id"])
        doc["created_at"] = existing.get("created_at", doc["created_at"])
    await db.products.update_one({"slug": p["slug"]}, {"$set": doc}, upsert=True)


async def seed_all():
    print(f"=== Seeding {len(SEED_MAKERS)} makers + {len(SEED_PRODUCTS)} products ===")
    print(f"Image output: {SEED_DIR}")

    print("\n[1/3] Backfilling featured_example flag on existing seed data…")
    r1 = await db.makers.update_many({"featured_example": {"$exists": False}}, {"$set": {"featured_example": True}})
    r2 = await db.products.update_many({"featured_example": {"$exists": False}}, {"$set": {"featured_example": True}})
    print(f"  makers backfilled: {r1.modified_count}, products backfilled: {r2.modified_count}")

    print("\n[2/3] Upserting new founding makers…")
    for m in SEED_MAKERS:
        print(f"  → {m['slug']}")
        await _upsert_maker(m)

    print("\n[3/3] Upserting featured-example products…")
    for p in SEED_PRODUCTS:
        print(f"  → {p['slug']} ({p['category']})")
        await _upsert_product(p)

    # Refresh listings_count on every seed maker so the shop tiles render
    # the right number without a stale cache.
    print("\nRecomputing listings_count for all seed makers…")
    for slug in set([m["slug"] for m in SEED_MAKERS] + [p["maker_slug"] for p in SEED_PRODUCTS]):
        n = await db.products.count_documents({"maker_slug": slug, "status": "published", "deleted_at": None})
        await db.makers.update_one({"slug": slug}, {"$set": {"listings_count": n}})
        print(f"  {slug}: {n} published listings")

    print("\n=== Seed complete ===")


if __name__ == "__main__":
    asyncio.run(seed_all())
