"""Seed pack expansion — 6 new founding makers × 5 products = 30 listings.

iter229 — Builds out the founding ecosystem to 10 makers total (4 from
iter227 + 6 new ones from the user's connected-profiles brief). Each
new maker has a distinct specialty + region + visual style that doesn't
overlap with the iter227 four:

  • BlackRiver Laserworks (CA)  — fiber laser engraving, precision minimal
  • Emberline Metalworks (CO)   — layered wildlife steel art
  • NorthForge Customs (MT)     — commercial signage / business work
  • Redwood CNC Collective (N.CA) — artistic CNC carving
  • CopperEdge Makers (AZ)      — premium modern luxury metal décor
  • Forge & Grain Workshop (ID) — wood + steel hybrid furniture

5 products per maker = 30 new listings. Each product gets hero + process
image (60 calls) plus 12 maker portrait/cover images = 72 Gemini Nano
Banana calls total.

Idempotent: re-runs upsert by slug, skip image files already on disk.
Same `featured_example: True` + `is_seed: True` flags as iter227 so the
existing purge endpoint catches everything in one sweep.

Run with:
    cd /app/backend && python3 seed_starter_pack_v2.py
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

SEED_DIR = Path("/app/frontend/public/seed-images/starter-pack")
SEED_DIR.mkdir(parents=True, exist_ok=True)


# ════════════════════════════════════════════════════════════════════════
# 6 NEW MAKERS — non-overlapping with iter227.
# ════════════════════════════════════════════════════════════════════════
SEED_MAKERS = [
    {
        "slug": "blackriver-laserworks",
        "name": "BlackRiver Laserworks",
        "initials": "BL",
        "location": "Truckee, CA",
        "bio": (
            "Fiber laser studio at the edge of the Sierra Nevada. We make our living "
            "on the things plasma can't touch — sub-millimeter detail engraving, "
            "personalized boards, coordinates plaques, intricate map work. Quiet "
            "shop, sharp output."
        ),
        "techniques": ["LASER", "CUSTOM"],
        "years_crafting": 6,
        "machinery": ["100W CO2 Laser", "Fiber Marking Laser", "Edge-Lit LED Bench"],
        "rating": 4.98,
        "image_prompt_portrait": (
            "Documentary portrait of a focused craftswoman in her 30s wearing laser "
            "safety glasses pushed up on her forehead, holding a freshly engraved "
            "walnut plaque with intricate coordinates engraving, behind her a CO2 "
            "laser cutter visible with its honeycomb bed, clean modern workshop "
            "interior, soft natural light from a side window, documentary "
            "photography, shallow depth of field"
        ),
        "image_prompt_cover": (
            "Wide angle of a clean precision laser engraving workshop: CO2 laser "
            "machine in the foreground mid-job glowing with its blue cutting "
            "light, finished engraved wooden plaques and signs neatly arranged "
            "on a side bench, exposed beam ceiling, warm tungsten work lights, "
            "documentary atmosphere"
        ),
    },
    {
        "slug": "emberline-metalworks",
        "name": "Emberline Metalworks",
        "initials": "EM",
        "location": "Salida, CO",
        "bio": (
            "Small-batch artistic metal shop tucked into a converted feed barn in the "
            "upper Arkansas valley. We build layered steel wildlife scenes — aspen "
            "groves, wolf packs, alpine vistas — that catch the same light the "
            "actual landscape does outside our shop door."
        ),
        "techniques": ["PLASMA", "LASER"],
        "years_crafting": 9,
        "machinery": ["4x8 Plasma CNC", "3kW Fiber Laser", "TIG Welder"],
        "rating": 4.97,
        "image_prompt_portrait": (
            "Documentary portrait of a Colorado metal artist in his 40s with a "
            "weathered face and a flannel shirt, holding a layered three-dimensional "
            "steel aspen grove wall panel, standing inside a converted barn-style "
            "metal art studio with finished wildlife pieces hanging behind him, "
            "warm late-afternoon mountain light, looking at camera"
        ),
        "image_prompt_cover": (
            "Atmospheric workshop scene of a metal art studio: multiple layered "
            "steel wildlife panels in progress hanging from rope from the rafters, "
            "a plasma table on the left mid-cut, sparks falling, the Colorado "
            "mountains visible through the open barn door, golden hour light "
            "streaming through, documentary photography"
        ),
    },
    {
        "slug": "northforge-customs",
        "name": "NorthForge Customs",
        "initials": "NF",
        "location": "Bozeman, MT",
        "bio": (
            "Commercial fabrication shop building branded signage for storefronts, "
            "breweries, ranches, and outdoor outfitters across the northern "
            "Rockies. We deliver in person to clients within 300 miles — that's "
            "the radius we can drive and be back by dinner."
        ),
        "techniques": ["LASER", "PLASMA", "CUSTOM"],
        "years_crafting": 12,
        "machinery": ["6x12 Fiber Laser", "Heavy-Duty Plasma CNC", "Mobile Install Rig"],
        "rating": 4.96,
        "image_prompt_portrait": (
            "Documentary portrait of a Montana craftsman in his 50s in a Carhartt "
            "jacket, work gloves tucked into his back pocket, standing in front "
            "of a finished oversized brewery sign in his commercial fabrication "
            "shop, mountain landscape visible through bay doors behind him, "
            "overcast morning light, no smile, authentic"
        ),
        "image_prompt_cover": (
            "Wide commercial fabrication shop with multiple large-format steel "
            "business signs in various finishing stages, a 6 by 12 fiber laser "
            "mid-cut on a brewery logo, mounting brackets and powder coat "
            "samples on a side bench, professional industrial lighting"
        ),
    },
    {
        "slug": "redwood-cnc-collective",
        "name": "Redwood CNC Collective",
        "initials": "RC",
        "location": "Eureka, CA",
        "bio": (
            "Three-person CNC carving studio focused on landscape-inspired wall "
            "reliefs. We work almost entirely in figured western maple and reclaimed "
            "redwood — slow species, careful tool paths, a stepover small enough "
            "that the carved surface feels milled to glass by hand."
        ),
        "techniques": ["ROUTER", "CUSTOM"],
        "years_crafting": 11,
        "machinery": ["5x10 CNC Router", "4-axis Indexer", "Belt Sander Wall"],
        "rating": 4.99,
        "image_prompt_portrait": (
            "Documentary portrait of three CNC woodcarvers — two men and a woman "
            "in their 30s — standing together in a redwood-paneled woodshop, "
            "one holding a carved topographic mountain relief panel, behind them "
            "a large 5x10 CNC router visible, warm natural light through a "
            "skylight, candid composition, looking at camera"
        ),
        "image_prompt_cover": (
            "Wide shot of a small-batch CNC woodcarving studio: a 5x10 CNC "
            "router mid-cut on a redwood landscape relief, fine sawdust in "
            "the air, finished carved panels leaning against the back wall, "
            "skylights bathing the shop in soft daylight, magazine quality"
        ),
    },
    {
        "slug": "copperedge-makers",
        "name": "CopperEdge Makers",
        "initials": "CE",
        "location": "Sedona, AZ",
        "bio": (
            "Modern architectural metal studio in the high desert. We build "
            "decorative wall pieces for interior designers, hospitality clients, "
            "and luxury residential builds — brushed brass, copper, anodized "
            "aluminum. Geometric, refined, photo-ready under any lighting."
        ),
        "techniques": ["LASER", "CUSTOM"],
        "years_crafting": 8,
        "machinery": ["6kW Fiber Laser", "CNC Press Brake", "Vibratory Polishing Tank"],
        "rating": 4.98,
        "image_prompt_portrait": (
            "Documentary portrait of an architect-trained metal artist in her late "
            "30s wearing a black work apron over a clean linen shirt, standing in "
            "front of a hexagonal brushed brass wall installation in her modern "
            "Arizona studio, terracotta floors and white walls visible, soft natural "
            "light, magazine quality"
        ),
        "image_prompt_cover": (
            "Modern architectural metal studio interior: a wall installation of "
            "geometric hexagonal brushed brass and copper tiles, large window "
            "showing red rock landscape outside, polished concrete floor, "
            "a press brake visible on the far side, warm desert daylight, "
            "high-end editorial photography"
        ),
    },
    {
        "slug": "forge-and-grain",
        "name": "Forge & Grain Workshop",
        "initials": "FG",
        "location": "Sandpoint, ID",
        "bio": (
            "Hybrid hardwood and steel workshop on the northern Idaho panhandle. "
            "We build functional furniture — floating shelves, console tables, "
            "wall cubbies — at the intersection of two materials. Joinery "
            "matters. Welds matter. The seam between the two matters most."
        ),
        "techniques": ["ROUTER", "PLASMA", "CUSTOM"],
        "years_crafting": 13,
        "machinery": ["4x8 CNC Router", "Plasma CNC", "MIG / TIG Stations", "Drum Sander"],
        "rating": 4.97,
        "image_prompt_portrait": (
            "Documentary portrait of a craftsman in his 40s in a heavy canvas "
            "work jacket, holding a small wood + steel hybrid bookshelf bracket, "
            "standing in a clean wood-and-metal workshop with hardwood lumber "
            "racks on the left and a TIG welding station on the right, Idaho "
            "pine forest visible through a window, warm natural light"
        ),
        "image_prompt_cover": (
            "Wide hybrid workshop with hardwood slabs on sawhorses and steel "
            "framing sections on a welding table side-by-side, in-progress "
            "wood + steel console table on a center workbench, organized tool "
            "wall behind it, warm shop lighting, documentary craft photography"
        ),
    },
]


# ════════════════════════════════════════════════════════════════════════
# 30 NEW PRODUCTS — 5 per maker, distinct from iter227's 20.
# Each carries hero + process image prompts.
# ════════════════════════════════════════════════════════════════════════
SEED_PRODUCTS = [
    # ── BlackRiver Laserworks (CA · laser engraving) ───────────────────
    {
        "slug": "engraved-wedding-date-sign",
        "title": "Engraved Wedding Date Sign",
        "maker_slug": "blackriver-laserworks",
        "category": "Custom Signs",
        "technique": "LASER",
        "price": 95.0,
        "length_in": 14, "width_in": 10, "weight_lbs": 1.5,
        "materials": ["Solid walnut", "Hand-rubbed oil seal"],
        "colors": ["walnut natural"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Two names + wedding date + venue name (optional). Up to 60 characters "
            "total. We send a digital proof within 24 hours before we cut wood."
        ),
        "description": (
            "Compact walnut plaque engraved with your names, wedding date, and a "
            "small ornament. Engraving depth is tuned per material — we test on "
            "scrap from the same board first so the depth is consistent. Hand-rubbed "
            "oil seal. Slight variation in grain pattern between boards is part of "
            "the piece."
        ),
        "image_prompt_hero": (
            "Hero shot of a 14 by 10 inch walnut wedding plaque with engraved names "
            "'Sarah & James' and 'June 14, 2024' in elegant serif typeface, mounted "
            "on a white shiplap wall above a console table with fresh greenery and "
            "candles, warm natural window light, magazine quality home decor "
            "photography"
        ),
        "image_prompt_process": (
            "Close-up of a CO2 laser engraving fine serif text into a walnut plaque, "
            "the bright cutting light illuminating the wood surface, wisps of smoke "
            "rising, shavings just below the engraving line, sharp focus, "
            "documentary fabrication photography"
        ),
    },
    {
        "slug": "personalized-coordinates-plaque",
        "title": "Personalized Coordinates Plaque",
        "maker_slug": "blackriver-laserworks",
        "category": "Custom Signs",
        "technique": "LASER",
        "price": 78.0,
        "length_in": 12, "width_in": 8, "weight_lbs": 1.2,
        "materials": ["Cherry hardwood", "Oil + wax finish"],
        "colors": ["cherry natural"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Coordinates (lat/long), place name, and an optional date. We'll mark "
            "the exact decimal degrees — use the format from Google Maps."
        ),
        "description": (
            "Cherry plaque engraved with the coordinates of a place that matters — "
            "where you met, where you grew up, where the proposal happened. The "
            "decimal-degrees format is precise enough to drop a pin within 6 feet. "
            "Each board hand-picked; slight grain variation expected."
        ),
        "image_prompt_hero": (
            "Hero shot of a 12 by 8 inch cherry hardwood plaque with engraved "
            "coordinates '47.6062° N · 122.3321° W' and the text 'Where We Met · "
            "Seattle' below, mounted on a soft grey wall in a modern entryway, "
            "warm natural light"
        ),
        "image_prompt_process": (
            "Top-down macro shot of a CO2 laser engraving precise decimal "
            "coordinates and a small compass rose into a cherry hardwood plaque, "
            "thin curl of smoke rising, the bright cutting line clearly visible, "
            "shallow depth of field"
        ),
    },
    {
        "slug": "laser-cut-acrylic-constellation-map",
        "title": "Laser-Cut Acrylic Constellation Map",
        "maker_slug": "blackriver-laserworks",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 125.0,
        "length_in": 18, "width_in": 18, "weight_lbs": 2.5,
        "materials": ["1/4 inch frosted acrylic", "Edge-lit LED option"],
        "colors": ["frosted clear"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Give us a date + city — we'll engrave the night sky as seen from "
            "that location at midnight. Add LED edge-lighting at checkout for "
            "the full effect at night."
        ),
        "description": (
            "Custom star map engraved into 1/4 inch frosted acrylic — when "
            "edge-lit, the engraved stars glow against the diffused panel like a "
            "real night sky. We pull the actual astronomical data for your date "
            "and location, so the constellations are correct, not decorative."
        ),
        "image_prompt_hero": (
            "Hero shot of an 18 inch square frosted acrylic constellation map "
            "panel with engraved stars and constellation lines glowing softly "
            "from edge-lit LED, mounted on a dark navy wall in a modern bedroom, "
            "atmospheric low-light photography"
        ),
        "image_prompt_process": (
            "Close-up of a CO2 laser engraving fine constellation lines onto a "
            "sheet of frosted acrylic on a honeycomb laser bed, the engraving "
            "light bright against the milky surface, sharp focus, industrial "
            "fabrication photography"
        ),
    },
    {
        "slug": "pet-memorial-wood-plaque",
        "title": "Pet Memorial Wood Plaque",
        "maker_slug": "blackriver-laserworks",
        "category": "Custom Signs",
        "technique": "LASER",
        "price": 68.0,
        "length_in": 10, "width_in": 8, "weight_lbs": 1.0,
        "materials": ["Maple hardwood", "Oil seal"],
        "colors": ["maple natural"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Pet name + dates + a short line of text (optional, up to 40 chars). "
            "Upload a photo at checkout if you'd like us to engrave a portrait — "
            "$25 add-on, takes an extra 2 days."
        ),
        "description": (
            "A small maple plaque to remember a good companion. Engraved name, "
            "dates, optional line of text. Available with photo portrait engraving "
            "as an add-on. Each piece individually cut and hand-finished — slight "
            "variation between pieces is expected."
        ),
        "image_prompt_hero": (
            "Hero shot of a 10 by 8 inch maple plaque engraved with the text "
            "'Daisy - Best Girl - 2009-2024' and a small paw print, resting on a "
            "wooden mantel beside a framed photo, warm soft light, emotional "
            "documentary photography"
        ),
        "image_prompt_process": (
            "Craftsperson's hands carefully hand-rubbing finishing oil onto a "
            "freshly engraved maple memorial plaque, the engraved text and paw "
            "print clearly visible, warm tungsten light, documentary woodshop "
            "photography, shallow depth of field"
        ),
    },
    {
        "slug": "whiskey-tasting-flight-board",
        "title": "Whiskey Tasting Flight Board",
        "maker_slug": "blackriver-laserworks",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 89.0,
        "length_in": 16, "width_in": 6, "weight_lbs": 2.0,
        "materials": ["Walnut", "Food-safe mineral oil"],
        "colors": ["walnut natural"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Engrave a name or quote across the top. Standard cutout holds four "
            "Glencairn glasses — let us know if you use a different glass shape."
        ),
        "description": (
            "Walnut flight board sized for four Glencairn glasses, engraved with "
            "your name, quote, or distillery list. Food-safe mineral oil finish — "
            "the engraved area accepts the oil too, so the contrast deepens over "
            "time rather than fading."
        ),
        "image_prompt_hero": (
            "Hero food photography shot of a walnut whiskey flight board with "
            "four Glencairn glasses each holding a different amber pour, the "
            "board engraved with 'The Bourbon Bench' at the top, dark moody "
            "bar setting, warm tungsten light, magazine quality"
        ),
        "image_prompt_process": (
            "Top-down shot of a craftsperson using a forstner bit on a drill "
            "press to bore the four glass-holder recesses into a walnut flight "
            "board, sawdust around the cuts, the laser-engraved title visible "
            "above, warm workshop lighting"
        ),
    },

    # ── Emberline Metalworks (CO · layered wildlife steel) ─────────────
    {
        "slug": "aspen-grove-layered-wall-panel",
        "title": "Aspen Grove Layered Wall Panel",
        "maker_slug": "emberline-metalworks",
        "category": "Wall Art",
        "technique": "PLASMA",
        "price": 245.0,
        "length_in": 36, "width_in": 24, "weight_lbs": 12.0,
        "materials": ["14ga steel", "Multi-layer powder coat"],
        "colors": ["white birch + gold", "weathered patina"],
        "description": (
            "Three-layer aspen grove panel — birch-white trunks against a "
            "deeper-toned forest layer, with gold-leaf-finished aspen leaves "
            "scattered across the third plane. Each layer is plasma-cut, "
            "individually powder-coated, then stacked with stainless standoffs "
            "for depth. Hand-finished edges; each leaf placement varies slightly."
        ),
        "image_prompt_hero": (
            "Hero shot of a 36 by 24 inch layered steel aspen grove wall panel, "
            "white-painted vertical aspen trunks on the front layer, darker green "
            "forest behind, with small gold-leaf aspen leaves floating across "
            "the depth, mounted on a soft grey-blue wall in a Colorado mountain "
            "home, warm natural light, magazine quality"
        ),
        "image_prompt_process": (
            "Documentary close-up of a craftsperson's gloved hands stacking the "
            "three layers of a steel aspen grove panel using stainless standoffs, "
            "the depth becoming visible as the layers align, workshop bench "
            "lighting, shallow depth of field"
        ),
    },
    {
        "slug": "mountain-lake-sunset-multilayer-scene",
        "title": "Mountain Lake Sunset Multi-Layer Scene",
        "maker_slug": "emberline-metalworks",
        "category": "Wall Art",
        "technique": "PLASMA",
        "price": 295.0,
        "length_in": 40, "width_in": 20, "weight_lbs": 11.0,
        "materials": ["14ga steel", "Heat-tinted finish", "Powder coat"],
        "colors": ["sunset gradient", "monochrome"],
        "description": (
            "Four-layer alpine scene: foreground evergreens, a mid-layer lake "
            "with ripple-cut surface, a mountain ridge, and a sunset gradient "
            "achieved with controlled torch heat-tinting on bare steel. "
            "Individually cut, individually finished, no two are alike."
        ),
        "image_prompt_hero": (
            "Hero shot of a 40 by 20 inch layered steel mountain lake scene with "
            "evergreens, a rippled lake surface, mountain ridge silhouette, and "
            "heat-tinted sunset gradient sky in oranges and purples, mounted "
            "over a fireplace mantel, magazine quality home decor"
        ),
        "image_prompt_process": (
            "Action shot of a metal artist using a controlled propane torch to "
            "heat-tint a sheet of bare steel to a sunset gradient, the orange "
            "and blue iridescent colors emerging on the metal surface, dramatic "
            "workshop lighting"
        ),
    },
    {
        "slug": "wolf-pack-silhouette-panel",
        "title": "Wolf Pack Silhouette Panel",
        "maker_slug": "emberline-metalworks",
        "category": "Wall Art",
        "technique": "PLASMA",
        "price": 225.0,
        "length_in": 34, "width_in": 18, "weight_lbs": 9.0,
        "materials": ["14ga steel", "Matte black powder coat"],
        "colors": ["matte black"],
        "description": (
            "Pack of five wolves moving through layered pine silhouettes — the "
            "depth comes from the negative space between the wolves and the "
            "trees behind them. Layered fabrication. Hand-finished edges; small "
            "variation in tail and ear shapes between batches."
        ),
        "image_prompt_hero": (
            "Hero shot of a 34 by 18 inch matte black layered steel wall panel "
            "depicting five wolves moving through pine forest silhouettes, "
            "mounted on rough sawn reclaimed wood backer over a cabin fireplace, "
            "warm tungsten lighting"
        ),
        "image_prompt_process": (
            "Plasma table cutting the detailed silhouette of a wolf head from "
            "14ga steel, sparks falling into the water bath, the recognizable "
            "shape just emerging from the steel sheet, dramatic industrial "
            "lighting"
        ),
    },
    {
        "slug": "bear-scene-layered-wall-art",
        "title": "Bear Scene Layered Wall Art",
        "maker_slug": "emberline-metalworks",
        "category": "Wall Art",
        "technique": "PLASMA",
        "price": 235.0,
        "length_in": 30, "width_in": 22, "weight_lbs": 8.5,
        "materials": ["14ga steel", "Burnt-edge patina + sealer"],
        "colors": ["burnt steel"],
        "description": (
            "A grizzly fishing in a mountain stream — three layers of depth with "
            "warm brown burnt-edge patina baked in. The patina seals itself "
            "under the outdoor topcoat, so the warm tones survive a covered "
            "porch. Each piece hand-finished."
        ),
        "image_prompt_hero": (
            "Hero shot of a 30 by 22 inch layered steel wall panel with a "
            "grizzly bear catching a fish in a stream, three depths of layered "
            "fabrication, burnt-brown patina giving warm tones, mounted on a "
            "wood plank wall in a mountain lodge, warm cabin lighting"
        ),
        "image_prompt_process": (
            "Close-up of a fabricator's torch passing along the edge of a "
            "cut steel bear silhouette, the orange flame producing the burnt "
            "patina, sparks visible, the bear shape clearly emerging from "
            "the work, dark workshop background"
        ),
    },
    {
        "slug": "wildflower-field-geometric-panel",
        "title": "Wildflower Field Geometric Panel",
        "maker_slug": "emberline-metalworks",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 195.0,
        "length_in": 28, "width_in": 28, "weight_lbs": 7.0,
        "materials": ["16ga steel", "Multi-color powder coat"],
        "colors": ["wildflower mixed", "monochrome"],
        "description": (
            "Geometric interpretation of a Colorado wildflower field — Indian "
            "paintbrush, columbine, lupine — broken into sharp-edged shapes "
            "and individually powder-coated in muted nature tones. Each panel "
            "individually finished; slight color variation between batches is "
            "expected and intentional."
        ),
        "image_prompt_hero": (
            "Hero shot of a 28 inch square steel wall panel with geometric "
            "wildflower forms in muted sage, dusty rose, slate blue, and "
            "marigold colors, mounted on a white plaster wall in a modern "
            "Colorado mountain home, natural daylight, magazine quality"
        ),
        "image_prompt_process": (
            "Documentary shot of a finisher spraying powder coat in a "
            "wildflower's sage-green tone onto the laser-cut wildflower form "
            "panels in a powder coat booth, the colored powder cloud visible, "
            "industrial workshop atmosphere"
        ),
    },

    # ── NorthForge Customs (MT · business signage) ─────────────────────
    {
        "slug": "brewery-tap-handle-sign-set",
        "title": "Brewery Tap Handle Sign Set",
        "maker_slug": "northforge-customs",
        "category": "Custom Signs",
        "technique": "LASER",
        "price": 385.0,
        "length_in": 12, "width_in": 4, "weight_lbs": 4.0,
        "materials": ["14ga steel + walnut", "Powder coat"],
        "colors": ["matte black", "raw steel"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Send beer name list (up to 12) and your brewery logo file. We'll "
            "send a digital proof within 48 hours. Standard tap mount included."
        ),
        "description": (
            "Set of laser-cut tap handles with engraved beer names + a master "
            "brewery sign for the bar back. Walnut grip, steel face. Standard "
            "1/4 inch industry tap mount. We've shipped these to taprooms across "
            "Montana, Idaho, and Wyoming."
        ),
        "image_prompt_hero": (
            "Hero shot of a set of six tall walnut + black steel brewery tap "
            "handles each engraved with a different beer name, mounted in a "
            "row on a wood-and-steel taproom bar back, atmospheric warm pub "
            "lighting, professional bar product photography"
        ),
        "image_prompt_process": (
            "Documentary close-up of a craftsperson assembling a steel and "
            "walnut tap handle, hands fitting the threaded brass mount into "
            "the bottom of the handle, work jig clamps holding the piece, "
            "warm workshop lighting"
        ),
    },
    {
        "slug": "cattle-brand-ranch-entrance-sign",
        "title": "Cattle Brand Ranch Entrance Sign",
        "maker_slug": "northforge-customs",
        "category": "Outdoor Art",
        "technique": "PLASMA",
        "price": 685.0,
        "length_in": 96, "width_in": 36, "weight_lbs": 65.0,
        "materials": ["3/8 inch Cor-Ten steel", "Natural rust patina"],
        "colors": ["Cor-Ten rust"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Send your cattle brand artwork + the ranch name. We'll engineer "
            "the sign for an arch span up to 16 feet wide. Crated and freighted "
            "with mounting brackets; install drawings included."
        ),
        "description": (
            "Heavy-gauge Cor-Ten steel ranch entrance sign with your cattle "
            "brand and ranch name. The rust patina develops naturally over 60 "
            "days outdoors then stabilizes — won't pit through within our "
            "lifetimes. Lead time 4-6 weeks. Crated and freighted directly to "
            "your ranch."
        ),
        "image_prompt_hero": (
            "Hero shot of a large Cor-Ten steel ranch entrance arch sign "
            "spanning across a gravel drive, with a cattle brand and the "
            "text 'BIG SKY RANCH · EST 1973' cut from the steel, rust patina "
            "fully developed, Montana mountain landscape in the background, "
            "golden hour light"
        ),
        "image_prompt_process": (
            "Heavy industrial plasma table mid-cut on a 3/8 inch thick "
            "Cor-Ten steel ranch sign, the cattle brand shape emerging from "
            "the steel as a shower of sparks falls into the water bath, "
            "dramatic industrial lighting, sense of scale"
        ),
    },
    {
        "slug": "steel-mountain-lodge-welcome-sign",
        "title": "Steel Mountain Lodge Welcome Sign",
        "maker_slug": "northforge-customs",
        "category": "Custom Signs",
        "technique": "PLASMA",
        "price": 425.0,
        "length_in": 60, "width_in": 30, "weight_lbs": 22.0,
        "materials": ["14ga steel", "Powder coat or raw"],
        "colors": ["matte black", "weathered patina"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Lodge or cabin name + a short tagline (optional). Choose a "
            "mountain silhouette layer behind the text. Mounting hardware "
            "rated for outdoor exposure included."
        ),
        "description": (
            "Large-format welcome sign for a cabin, lodge, or rental property "
            "— text and a mountain silhouette layer. We deliver these in person "
            "within 300 miles of Bozeman; freight beyond. Commercial fabrication "
            "with weather-rated mounting hardware."
        ),
        "image_prompt_hero": (
            "Hero shot of a 60 by 30 inch matte black steel welcome sign "
            "reading 'WELCOME TO TIMBERLINE LODGE' with a layered mountain "
            "silhouette behind the text, mounted on a log cabin exterior "
            "wall, golden hour mountain light, professional architectural "
            "product photography"
        ),
        "image_prompt_process": (
            "Two installers mounting a large steel mountain lodge welcome "
            "sign onto an exterior log cabin wall, one holding the sign "
            "level on a step ladder while the other secures it with lag "
            "screws, work belts visible, documentary install photography"
        ),
    },
    {
        "slug": "carved-steel-business-hours-sign",
        "title": "Carved Steel Business Hours Sign",
        "maker_slug": "northforge-customs",
        "category": "Custom Signs",
        "technique": "LASER",
        "price": 165.0,
        "length_in": 20, "width_in": 14, "weight_lbs": 4.0,
        "materials": ["14ga steel", "Powder coat"],
        "colors": ["matte black", "white"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Send your business name + your hours grid. We can match an existing "
            "wordmark by uploading the SVG. Standard 4-screw mount."
        ),
        "description": (
            "Storefront-grade business hours sign — your name across the top, a "
            "clean hours grid below. Laser-cut detail tight enough to do "
            "two-line copy in a 1/8 inch character height. Powder coat in "
            "OSHA-grade safety yellow if you need maximum visibility from "
            "the street."
        ),
        "image_prompt_hero": (
            "Hero shot of a matte black steel business hours sign reading "
            "'NORTH ROAD GENERAL STORE' with a clean weekday hours grid below, "
            "mounted next to a storefront door on a weathered red brick "
            "exterior, late afternoon light, commercial architectural "
            "photography"
        ),
        "image_prompt_process": (
            "Designer's hands at a CAD workstation reviewing the typography "
            "layout for a business hours sign on a wide-screen monitor, "
            "with a half-cut steel sample on the desk beside them, "
            "warm office lighting, documentary studio photography"
        ),
    },
    {
        "slug": "trail-marker-custom-plaque",
        "title": "Trail Marker Custom Plaque",
        "maker_slug": "northforge-customs",
        "category": "Outdoor Art",
        "technique": "LASER",
        "price": 145.0,
        "length_in": 16, "width_in": 10, "weight_lbs": 3.0,
        "materials": ["14ga aluminum", "Anodized + UV-stable lacquer"],
        "colors": ["anodized black", "anodized blue"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Trail name, distance, elevation gain. Add a small wildlife icon "
            "(elk, bighorn, eagle) at the corner if you'd like."
        ),
        "description": (
            "Trail marker plaque for ranches, private trail systems, and outdoor "
            "outfitters. Anodized aluminum stays legible after a Montana winter "
            "without a refinish. Mounting holes pre-drilled for post or tree "
            "installation."
        ),
        "image_prompt_hero": (
            "Hero shot of a 16 by 10 inch anodized black aluminum trail marker "
            "plaque reading 'EAGLE RIDGE LOOP · 4.2 MI · 1200 FT GAIN' with a "
            "small elk icon, mounted to a cedar trail post in a mountain meadow, "
            "morning light, outdoor product photography"
        ),
        "image_prompt_process": (
            "Close-up of a fiber laser engraving the topographic detail of a "
            "trail marker plaque onto anodized aluminum, sparks of laser light "
            "visible, the trail name and elevation text emerging clearly, "
            "industrial fabrication photography"
        ),
    },

    # ── Redwood CNC Collective (CA · artistic CNC carving) ─────────────
    {
        "slug": "topographic-lake-tahoe-wood-map",
        "title": "Topographic Lake Tahoe Wood Map",
        "maker_slug": "redwood-cnc-collective",
        "category": "Wall Art",
        "technique": "ROUTER",
        "price": 385.0,
        "length_in": 36, "width_in": 24, "weight_lbs": 12.0,
        "materials": ["Figured western maple", "Penetrating oil"],
        "colors": ["maple natural"],
        "description": (
            "3D topographic carving of Lake Tahoe and surrounding peaks in "
            "figured western maple. We hold a 1/32 inch stepover on the finishing "
            "pass — the carved contours feel polished under your hand even "
            "before sanding. Hand-rubbed penetrating oil. Each piece individually "
            "carved; no two grain patterns are identical."
        ),
        "image_prompt_hero": (
            "Hero shot of a 36 by 24 inch figured western maple panel with deeply "
            "3D-carved topographic contours showing Lake Tahoe surrounded by "
            "mountain peaks, oiled finish bringing out the wood grain, mounted "
            "on a white shiplap wall in a lakeside home, soft natural light"
        ),
        "image_prompt_process": (
            "Action shot of a large 5x10 CNC router with a small ball-end bit "
            "carving the topographic contours of a mountain range into a maple "
            "panel, fine sawdust trailing behind the bit, scale of the machine "
            "evident, documentary woodshop photography"
        ),
    },
    {
        "slug": "redwood-grove-relief-panel",
        "title": "Redwood Grove Relief Panel",
        "maker_slug": "redwood-cnc-collective",
        "category": "Wall Art",
        "technique": "ROUTER",
        "price": 425.0,
        "length_in": 36, "width_in": 18, "weight_lbs": 10.0,
        "materials": ["Reclaimed redwood", "Natural oil seal"],
        "colors": ["redwood natural"],
        "description": (
            "Vertical relief panel carved into reclaimed coastal redwood — the "
            "wood itself once stood in a grove like the one we depict. Deep "
            "3-axis carving brings out the bark texture and trunk depth. "
            "Hand-finished edges; the grain variation between boards is part "
            "of the piece, not a defect."
        ),
        "image_prompt_hero": (
            "Hero shot of a tall 36 by 18 inch reclaimed redwood panel with "
            "deeply carved redwood grove relief, soft natural oil bringing out "
            "the rich red-brown wood tones, mounted on a textured white "
            "plaster wall in a coastal California home, warm afternoon light, "
            "magazine quality"
        ),
        "image_prompt_process": (
            "Close-up of a small ball-end CNC router bit carving the deeply "
            "textured bark relief of a redwood trunk into a piece of reclaimed "
            "redwood, fine red sawdust visible, sharp focus on the cutting bit, "
            "warm woodshop lighting"
        ),
    },
    {
        "slug": "coastal-wave-form-wall-sculpture",
        "title": "Coastal Wave Form Wall Sculpture",
        "maker_slug": "redwood-cnc-collective",
        "category": "Wall Art",
        "technique": "ROUTER",
        "price": 365.0,
        "length_in": 42, "width_in": 14, "weight_lbs": 9.0,
        "materials": ["Maple + walnut layers", "Hand-rubbed oil"],
        "colors": ["maple + walnut natural"],
        "description": (
            "Three-axis carving of a Pacific coastal wave form — alternating "
            "layers of maple and walnut produce light-and-dark depth in the "
            "swell. Each piece sanded to 320 grit by hand after the CNC pass. "
            "Slight grain variation between boards expected."
        ),
        "image_prompt_hero": (
            "Hero shot of a long 42 by 14 inch horizontal wall sculpture "
            "carved from alternating maple and walnut layers depicting an "
            "abstract coastal wave form, oiled finish, mounted on a soft "
            "ocean-blue wall in a coastal living room, magazine quality "
            "interior photography"
        ),
        "image_prompt_process": (
            "Documentary shot of a craftsperson hand-sanding the carved curves "
            "of a wave-form wall sculpture with a sanding sponge, the maple "
            "and walnut layers visible, warm workshop bench lighting, shallow "
            "depth of field"
        ),
    },
    {
        "slug": "custom-topographic-mountain-range-panel",
        "title": "Custom Topographic Mountain Range Panel",
        "maker_slug": "redwood-cnc-collective",
        "category": "Wall Art",
        "technique": "ROUTER",
        "price": 445.0,
        "length_in": 40, "width_in": 20, "weight_lbs": 11.0,
        "materials": ["Hard maple", "Penetrating oil"],
        "colors": ["maple natural"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Send us a mountain range (we use USGS contour data). Most U.S. "
            "ranges work. We send a digital preview within 48 hours before "
            "we put a bit to wood."
        ),
        "description": (
            "Send us a mountain range. We pull the USGS contour data, build the "
            "tool path, and carve it into hard maple at a 1/16 inch stepover. "
            "Each commission is a one-off — every piece carries the grain "
            "pattern of a specific board hand-picked from our stock."
        ),
        "image_prompt_hero": (
            "Hero shot of a 40 by 20 inch hard maple wall panel with a deeply "
            "carved topographic relief of a recognizable mountain range with "
            "individual named peaks, oiled to a warm honey tone, mounted "
            "over a fireplace mantel in a mountain home, magazine quality"
        ),
        "image_prompt_process": (
            "Action shot of a 5x10 CNC router with a small ball-end bit "
            "tracing fine topographic contours into a hard maple panel, "
            "the carved mountain range slowly emerging from the wood, "
            "sawdust hood visible above, documentary fabrication photography"
        ),
    },
    {
        "slug": "cnc-carved-botanical-wall-panel",
        "title": "CNC Carved Botanical Wall Panel",
        "maker_slug": "redwood-cnc-collective",
        "category": "Wall Art",
        "technique": "ROUTER",
        "price": 295.0,
        "length_in": 24, "width_in": 24, "weight_lbs": 7.0,
        "materials": ["Walnut", "Hand-rubbed oil"],
        "colors": ["walnut natural"],
        "description": (
            "Square walnut botanical relief — eucalyptus, fern, and olive branch "
            "forms carved at varied depths so the leaves appear to layer "
            "naturally. Hand-finished after the CNC pass. Each piece is "
            "individually carved; slight grain variation expected."
        ),
        "image_prompt_hero": (
            "Hero shot of a 24 inch square walnut panel with a CNC-carved "
            "botanical motif — overlapping eucalyptus, fern, and olive branch "
            "leaves at varied carved depths, mounted above a modern entryway "
            "console table, soft natural light, magazine quality"
        ),
        "image_prompt_process": (
            "Close-up of a small CNC router bit carving the fine detail of "
            "an eucalyptus leaf into a walnut panel, the curved leaf form "
            "emerging cleanly from the wood, fine sawdust nearby, sharp "
            "focus, warm shop lighting"
        ),
    },

    # ── CopperEdge Makers (AZ · premium luxury metal décor) ────────────
    {
        "slug": "hexagonal-copper-wall-tile-set",
        "title": "Hexagonal Copper Wall Tile Set",
        "maker_slug": "copperedge-makers",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 485.0,
        "length_in": 6, "width_in": 7, "weight_lbs": 8.0,
        "materials": ["Solid copper sheet", "Vibratory polished"],
        "colors": ["natural copper", "patina blue-green"],
        "description": (
            "Set of 24 hexagonal copper wall tiles — each tile individually "
            "laser-cut, edge-deburred, and vibratory-polished to a soft satin "
            "finish. Mounts with 3M adhesive backing (included). Install in any "
            "honeycomb pattern; mix natural copper and patina'd tiles for a "
            "weathered desert palette."
        ),
        "image_prompt_hero": (
            "Hero shot of a wall installation of approximately 30 hexagonal "
            "solid copper tiles in a honeycomb pattern mounted on a clean "
            "white plaster wall in a luxury Arizona home, soft warm overhead "
            "lighting bringing out the metal's depth, high-end editorial "
            "interior photography"
        ),
        "image_prompt_process": (
            "Top-down shot of a craftsperson's hands holding several freshly "
            "cut copper hexagon tiles on a clean workbench, the satin polished "
            "finish catching warm desert light, cotton gloves visible, "
            "documentary luxury photography"
        ),
    },
    {
        "slug": "brushed-brass-geometric-wall-sculpture",
        "title": "Brushed Brass Geometric Wall Sculpture",
        "maker_slug": "copperedge-makers",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 565.0,
        "length_in": 36, "width_in": 24, "weight_lbs": 6.5,
        "materials": ["1/8 inch solid brass", "Hand-brushed satin"],
        "colors": ["brushed brass"],
        "description": (
            "Abstract geometric wall sculpture in 1/8 inch solid brass — "
            "interlocking triangular planes that catch the light differently "
            "as you move past them. Hand-brushed satin finish. Mounts flush to "
            "the wall with hidden brackets. Each piece individually finished."
        ),
        "image_prompt_hero": (
            "Hero shot of a 36 by 24 inch brushed brass geometric wall "
            "sculpture with overlapping triangular planes, mounted on a deep "
            "charcoal grey wall in a modern luxury living room, soft "
            "directional lighting making the brass surface catch the light "
            "differently across the planes, magazine quality"
        ),
        "image_prompt_process": (
            "Documentary close-up of a craftsperson hand-brushing the satin "
            "finish onto a flat brass triangular plane with a fine stainless "
            "brush, the brushing pattern emerging as a soft directional grain, "
            "warm workshop lighting"
        ),
    },
    {
        "slug": "modern-geometric-metal-sculpture",
        "title": "Modern Geometric Metal Sculpture",
        "maker_slug": "copperedge-makers",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 695.0,
        "length_in": 30, "width_in": 30, "weight_lbs": 8.0,
        "materials": ["Anodized aluminum", "Multi-color anodize"],
        "colors": ["bronze + black", "champagne + black"],
        "description": (
            "Square geometric sculpture in anodized aluminum — overlapping "
            "rings in alternating bronze and matte black create depth and "
            "movement on the wall. Designed for hospitality installations "
            "and luxury residential projects."
        ),
        "image_prompt_hero": (
            "Hero shot of a 30 inch square geometric metal sculpture in "
            "anodized bronze and matte black overlapping rings, mounted on "
            "an off-white textured plaster wall in a modern luxury hotel "
            "lobby, evening lighting, editorial photography"
        ),
        "image_prompt_process": (
            "Documentary shot of laser-cut anodized aluminum ring pieces being "
            "individually inspected by a craftsperson on a clean workbench, "
            "the bronze and black anodized colors visible, cotton gloves "
            "in frame, high-end industrial photography"
        ),
    },
    {
        "slug": "architectural-sunburst-wall-piece",
        "title": "Architectural Sunburst Wall Piece",
        "maker_slug": "copperedge-makers",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 585.0,
        "length_in": 36, "width_in": 36, "weight_lbs": 7.5,
        "materials": ["1/8 inch brushed aluminum", "Brushed satin finish"],
        "colors": ["brushed aluminum", "brushed brass"],
        "description": (
            "Architectural-grade sunburst wall piece — 48 radial rays "
            "individually cut and arranged into a 36 inch diameter rosette. "
            "Brushed satin finish on each ray. Hidden bracket mount; sits "
            "1/2 inch off the wall to allow indirect light to graze across "
            "the rays."
        ),
        "image_prompt_hero": (
            "Hero shot of a 36 inch diameter brushed aluminum architectural "
            "sunburst wall piece with 48 radial rays catching warm desert "
            "sunlight, mounted above a console table in a luxury Sedona "
            "home foyer, terracotta floor tiles visible, magazine quality"
        ),
        "image_prompt_process": (
            "Documentary shot of a craftsperson arranging the 48 individual "
            "brushed aluminum rays of a sunburst wall piece on a layout "
            "template, hands carefully positioning each ray in alignment, "
            "clean luxury workshop bench, warm tungsten light"
        ),
    },
    {
        "slug": "geometric-mirror-frame-wall-piece",
        "title": "Geometric Mirror Frame Wall Piece",
        "maker_slug": "copperedge-makers",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 645.0,
        "length_in": 36, "width_in": 30, "weight_lbs": 11.0,
        "materials": ["Solid brass frame", "Custom-cut mirror", "Brushed finish"],
        "colors": ["brushed brass", "antique brass"],
        "description": (
            "Geometric brass-framed mirror — overlapping diamond-cut brass "
            "plates around a custom-cut mirror panel. Hand-brushed satin finish. "
            "Mirror is fitted before final brushing so the brass framing "
            "carries the same texture all the way around the reflective edge."
        ),
        "image_prompt_hero": (
            "Hero shot of a 36 by 30 inch geometric brushed brass framed "
            "mirror with overlapping diamond-cut brass plates surrounding "
            "the mirror, mounted above a marble bathroom vanity in a luxury "
            "Sedona home, warm vanity lighting, magazine quality interior "
            "photography"
        ),
        "image_prompt_process": (
            "Documentary close-up of a craftsperson fitting a custom-cut "
            "mirror panel into the brushed brass diamond frame, hands "
            "carefully aligning the mirror in the recess, jeweler's "
            "loupe nearby, warm workshop lighting"
        ),
    },

    # ── Forge & Grain Workshop (ID · wood + steel hybrid) ──────────────
    {
        "slug": "steel-walnut-floating-shelf-set",
        "title": "Steel & Walnut Floating Shelf Set",
        "maker_slug": "forge-and-grain",
        "category": "Wall Art",
        "technique": "CUSTOM",
        "price": 325.0,
        "length_in": 36, "width_in": 8, "weight_lbs": 14.0,
        "materials": ["Solid black walnut", "1/4 inch steel bracket", "Powder coat"],
        "colors": ["walnut + matte black"],
        "description": (
            "Three floating shelves in solid black walnut on hidden 1/4 inch "
            "steel brackets. Brackets rated for 50 lbs per shelf — solid "
            "enough for cast iron cookware or a heavy book stack. Joinery "
            "matters; welds matter. We obsess over the seam where the steel "
            "meets the wood."
        ),
        "image_prompt_hero": (
            "Hero shot of three black walnut floating shelves on hidden steel "
            "brackets mounted on a sage-green kitchen wall, the shelves "
            "holding plants and cookbooks and a stack of stoneware, warm "
            "natural light from a side window, magazine quality kitchen "
            "photography"
        ),
        "image_prompt_process": (
            "Close-up of a craftsperson's hands fitting a steel hidden "
            "bracket into a precision-routed slot on the underside of a "
            "walnut floating shelf, the wood-and-steel joint visible, "
            "workshop bench lighting, sharp focus"
        ),
    },
    {
        "slug": "reclaimed-wood-steel-coat-rack",
        "title": "Reclaimed Wood + Steel Coat Rack",
        "maker_slug": "forge-and-grain",
        "category": "Wall Art",
        "technique": "CUSTOM",
        "price": 245.0,
        "length_in": 36, "width_in": 8, "weight_lbs": 11.0,
        "materials": ["Reclaimed Idaho pine", "Steel hooks", "Hand-rubbed oil"],
        "colors": ["pine + matte black"],
        "description": (
            "Wall-mount coat rack — reclaimed pine plank from an old Idaho "
            "potato barn, hand-forged steel hooks bolted through with carriage "
            "bolts. Five hooks, rated for a heavy winter coat each. Hand-"
            "finished — slight variation in plank weathering is expected."
        ),
        "image_prompt_hero": (
            "Hero shot of a 36 inch wide reclaimed pine plank wall coat rack "
            "with five hand-forged matte black steel hooks, mounted in a "
            "warm entryway hallway holding a wool coat and a wide-brim hat, "
            "warm morning light through a side window, documentary lifestyle "
            "photography"
        ),
        "image_prompt_process": (
            "Documentary shot of a fabricator forging a steel coat hook on "
            "an anvil with a small ball-peen hammer, orange-red glowing "
            "hot steel, sparks visible, dark workshop background, sense "
            "of motion, sharp focus"
        ),
    },
    {
        "slug": "industrial-pipe-wood-bench",
        "title": "Industrial Pipe + Wood Bench",
        "maker_slug": "forge-and-grain",
        "category": "Wall Art",
        "technique": "CUSTOM",
        "price": 485.0,
        "length_in": 48, "width_in": 14, "weight_lbs": 38.0,
        "materials": ["Hard maple slab", "Black iron pipe legs"],
        "colors": ["maple + matte black"],
        "description": (
            "Industrial mudroom or entry bench — 2-inch thick hard maple slab "
            "on black iron pipe legs. Pipe flanges thru-bolted into the slab "
            "with weld-finished steel washers. Hand-finished edges; each slab "
            "individually selected for grain."
        ),
        "image_prompt_hero": (
            "Hero shot of a 48 inch wide hard maple slab entry bench on "
            "black iron pipe legs, sitting against a whitewashed mudroom "
            "wall with a folded blanket and a pair of well-worn leather "
            "boots beside it, warm morning light, lifestyle interior "
            "photography"
        ),
        "image_prompt_process": (
            "Top-down shot of a craftsperson thru-bolting a black iron "
            "pipe flange into the underside of a hard maple slab bench top, "
            "hands using a wrench, the pipe assembly visible, workshop "
            "bench lighting"
        ),
    },
    {
        "slug": "steel-frame-wall-cubby",
        "title": "Steel Frame Wall Cubby",
        "maker_slug": "forge-and-grain",
        "category": "Wall Art",
        "technique": "CUSTOM",
        "price": 195.0,
        "length_in": 30, "width_in": 12, "weight_lbs": 9.0,
        "materials": ["1/8 inch steel frame", "Cherry hardwood inserts"],
        "colors": ["matte black + cherry"],
        "description": (
            "A 6-cubby wall organizer — welded 1/8 inch steel frame with "
            "cherry hardwood floors for each compartment. Mounts with two "
            "concealed cleats. Hand-finished edges throughout; the steel "
            "is welded then ground flush so no welds are visible."
        ),
        "image_prompt_hero": (
            "Hero shot of a 30 by 12 inch matte black steel frame wall "
            "cubby with six small compartments each holding a cherry "
            "hardwood floor, mounted on a textured grey wall holding "
            "small ceramic vases and folded linen napkins, warm soft "
            "interior light, magazine quality"
        ),
        "image_prompt_process": (
            "Documentary close-up of a fabricator using a flap disc "
            "grinder to grind a welded steel frame joint flush, sparks "
            "flying, the wood inserts visible nearby, dark workshop "
            "atmosphere, sharp focus"
        ),
    },
    {
        "slug": "wood-steel-console-table",
        "title": "Wood + Steel Console Table",
        "maker_slug": "forge-and-grain",
        "category": "Wall Art",
        "technique": "CUSTOM",
        "price": 785.0,
        "length_in": 54, "width_in": 14, "weight_lbs": 62.0,
        "materials": ["Black walnut slab", "1/4 inch welded steel base", "Hand-rubbed oil"],
        "colors": ["walnut + matte black"],
        "description": (
            "Hallway or entry console — 1.75 inch thick black walnut slab "
            "on a welded 1/4 inch steel hairpin base. Slab edge live-edge on "
            "one side, hand-planed flush on the other. Hand-rubbed oil "
            "finish. Lead time 3 weeks; crated freight."
        ),
        "image_prompt_hero": (
            "Hero shot of a 54 inch wide black walnut slab console table on "
            "welded steel hairpin legs in a modern entryway, the walnut slab "
            "showing rich grain pattern, a ceramic lamp and a small framed "
            "photo on top, warm afternoon light, magazine quality interior "
            "photography"
        ),
        "image_prompt_process": (
            "Documentary shot of a craftsperson hand-planing the live edge "
            "of a thick black walnut slab on a workshop bench, walnut shavings "
            "curling off the plane blade, warm shop lighting, shallow depth "
            "of field, sharp focus on the plane"
        ),
    },
]


# ════════════════════════════════════════════════════════════════════════
# Helpers (mirror seed_starter_products.py — idempotent, R2-safe).
# ════════════════════════════════════════════════════════════════════════
async def _generate_image(slug: str, prompt: str, suffix: str = "") -> str:
    fname = f"{slug}{('-' + suffix) if suffix else ''}.jpg"
    out_path = SEED_DIR / fname
    public_path = f"/seed-images/starter-pack/{fname}"
    if out_path.exists() and out_path.stat().st_size > 5000:
        return public_path

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        print(f"  [WARN] emergentintegrations missing ({e})")
        return public_path

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        print("  [WARN] EMERGENT_LLM_KEY not set")
        return public_path

    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"v2-{slug}-{suffix}-{uuid.uuid4().hex[:8]}",
            system_message=(
                "You generate cohesive, well-composed photography for an artisan "
                "marketplace. Photos should look authentic, documentary-style — never "
                "AI-rendered or over-stylized. Avoid text, watermarks, or logos in "
                "the image unless explicitly requested."
            ),
        )
        .with_model("gemini", "gemini-3.1-flash-image-preview")
        .with_params(modalities=["image", "text"])
    )

    try:
        msg = UserMessage(text=prompt)
        _text, images = await chat.send_message_multimodal_response(msg)
        if not images:
            return public_path
        img_bytes = base64.b64decode(images[0]["data"])
        out_path.write_bytes(img_bytes)
        print(f"  ✓ {fname} ({len(img_bytes)//1024}KB)")
    except Exception as e:
        print(f"  [WARN] image gen failed for {fname}: {e}")

    return public_path


async def _next_founder_number() -> int:
    counter = await db.platform_meta.find_one_and_update(
        {"key": "founder_counter"},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    return int((counter or {}).get("value") or 1)


async def _upsert_maker(m: dict):
    portrait = await _generate_image(f"maker-{m['slug']}-portrait", m["image_prompt_portrait"])
    cover = await _generate_image(f"maker-{m['slug']}-cover", m["image_prompt_cover"])
    existing = await db.makers.find_one(
        {"slug": m["slug"]}, {"_id": 0, "id": 1, "created_at": 1, "founder_number": 1},
    )
    founder_number = (existing or {}).get("founder_number") or await _next_founder_number()
    now = datetime.now(timezone.utc)
    doc = {
        "id": (existing or {}).get("id") or str(uuid.uuid4()),
        "slug": m["slug"],
        "name": m["name"],
        "initials": m["initials"],
        "location": m["location"],
        "bio": m["bio"],
        "techniques": m["techniques"],
        "years_crafting": m.get("years_crafting"),
        "machinery": m.get("machinery", []),
        "workshop_videos": [],
        "portrait": portrait,
        "cover": cover,
        "listings_count": 5,
        "rating": m.get("rating", 4.95),
        "subscription_status": "free",
        "listings_by_month": {},
        "listings_used_lifetime": 0,
        "pending_charges_cents": 0,
        "listing_credits": 0,
        "charge_history": [],
        "tier": "founder",
        "founder_status": "inaugural",
        "founder_started_at": now.isoformat(),
        "founder_expires_at": None,
        "founder_grace_until": (now + timedelta(days=14)).isoformat(),
        "founder_number": founder_number,
        "is_beta_tester": False,
        "featured_example": True,
        "created_at": (existing or {}).get("created_at") or now_iso(),
    }
    await db.makers.update_one({"slug": m["slug"]}, {"$set": doc}, upsert=True)


async def _upsert_product(p: dict):
    hero = await _generate_image(p["slug"], p["image_prompt_hero"], "hero")
    process = await _generate_image(p["slug"], p["image_prompt_process"], "process")
    expires_at = (datetime.now(timezone.utc) + timedelta(days=120)).isoformat()
    existing = await db.products.find_one({"slug": p["slug"]}, {"_id": 0, "id": 1, "created_at": 1})
    doc = {
        "id": (existing or {}).get("id") or str(uuid.uuid4()),
        "slug": p["slug"],
        "title": p["title"],
        "category": p["category"],
        "technique": p["technique"],
        "price": p["price"],
        "description": p["description"],
        "materials": p.get("materials", []),
        "dimensions": " × ".join(
            f"{p[k]}\"" for k in ("length_in", "width_in", "height_in") if p.get(k) is not None
        ),
        "length_in": p.get("length_in"),
        "width_in": p.get("width_in"),
        "height_in": p.get("height_in"),
        "dim_unit": "in",
        "weight_lbs": p.get("weight_lbs"),
        "colors": p.get("colors", []),
        "in_stock": p.get("in_stock", 5),
        "images": [hero, process],
        "maker_slug": p["maker_slug"],
        "status": "published",
        "expires_at": expires_at,
        "renewal_option": "automatic",
        "personalization_enabled": p.get("personalization_enabled", False),
        "personalization_instructions": p.get("personalization_instructions"),
        "variants": [],
        "featured_example": True,
        "is_seed": True,
        "created_at": (existing or {}).get("created_at") or now_iso(),
    }
    await db.products.update_one({"slug": p["slug"]}, {"$set": doc}, upsert=True)


async def main():
    print(f"\n════ Starter Pack v2 · {len(SEED_MAKERS)} makers, {len(SEED_PRODUCTS)} products ════\n")
    for m in SEED_MAKERS:
        await _upsert_maker(m)
        print(f"  ✓ maker: {m['slug']}")
    for p in SEED_PRODUCTS:
        await _upsert_product(p)
        print(f"  ✓ product: {p['slug']} → {p['maker_slug']}")
    # Sync listings_count
    for m in SEED_MAKERS:
        actual = await db.products.count_documents(
            {"maker_slug": m["slug"], "deleted_at": None, "status": "published"}
        )
        await db.makers.update_one({"slug": m["slug"]}, {"$set": {"listings_count": actual}})
    print("\n✓ Done.")


if __name__ == "__main__":
    asyncio.run(main())
