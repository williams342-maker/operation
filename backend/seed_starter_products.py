from config import env_get
"""Seed starter pack — 4 founding makers × 5 products = 20 listings.

iter227 — User-spec'd seed pass for marketplace density. Each maker
gets a distinct regional identity + workshop voice, and each product
gets BOTH a hero shot AND a process shot (sparks/CNC-in-progress/raw
cut stage) so the catalog feels like a real working community rather
than an AI-generated showroom.

Idempotent: re-runs upsert by slug. Image files are skipped if already
on disk. Run with:

    cd /app/backend && python3 seed_starter_products.py

All inserted docs carry `featured_example: True` so the existing
"✦ FOUNDING MAKER" badge renders and the existing purge endpoint at
POST /api/admin/seed/featured-content/purge will clear them. The 4
new makers also get `tier: "founder"` + `founder_status: "inaugural"`
so they appear on /founders.

Design choices (locked):
    * 4 regional makers: PNW, Texas Hill Country, Appalachia, Great Lakes.
      Each maker's location, story, and machinery match their products.
    * 5 products per maker, mapped to the user's 20-item brief.
    * Hero + process shot per product (40 Gemini Nano Banana calls).
    * Realism techniques from the brief baked into every description:
        - "Cut and finished in a small fabrication workshop in <region>"
        - Material tags (steel/aluminum/hardwood/epoxy/powder coat)
        - "Small imperfection psychology": hand-finished edges, grain
          variation language so visitors don't feel they're seeing a
          stamped catalog.
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
# 4 NEW FOUNDING MAKERS · distinct regional identities
# ════════════════════════════════════════════════════════════════════════
SEED_MAKERS = [
    {
        "slug": "cascade-iron-works",
        "name": "Cascade Iron Works",
        "initials": "CI",
        "location": "Hood River, OR",
        "bio": (
            "Heavy-gauge steel work cut in a converted apple-orchard shed at the base of "
            "Mt Hood. Brothers Eli and Sam Reeves run the place — Eli on the plasma table, "
            "Sam on the powder gun. We obsess about edge finish and won't ship a piece "
            "until the welds disappear under the topcoat."
        ),
        "techniques": ["PLASMA", "CUSTOM"],
        "years_crafting": 8,
        "machinery": ["5x10 Plasma CNC", "8x4 CNC Router", "Powder Coat Booth"],
        "rating": 4.97,
        "image_prompt_portrait": (
            "Documentary photo of two brothers in their 30s standing in a small metal "
            "fabrication shop with a Pacific Northwest forest visible through the open "
            "garage door, both wearing welding aprons and work gloves, one holding a "
            "cut steel mountain silhouette, warm late-afternoon light, shallow depth "
            "of field, looking at camera, authentic not staged"
        ),
        "image_prompt_cover": (
            "Wide shot of a small Pacific Northwest metal fabrication workshop, plasma "
            "CNC table on the left mid-cut showering sparks, completed steel mountain "
            "panels leaning against the wall on the right, cedar siding visible outside, "
            "moody industrial lighting, documentary photography style"
        ),
    },
    {
        "slug": "hill-country-forge",
        "name": "Hill Country Forge",
        "initials": "HF",
        "location": "Fredericksburg, TX",
        "bio": (
            "Custom metal signage and farmhouse name plates from a hill-country workshop "
            "outside Fredericksburg. Built around a 4x4 fiber laser and a stubborn "
            "respect for hand-rubbed finishes. We've made signs for ranches, breweries, "
            "and three of the best BBQ joints in the state — every piece leaves with a "
            "burn-marked maker's mark on the back."
        ),
        "techniques": ["LASER", "CUSTOM"],
        "years_crafting": 11,
        "machinery": ["4x4 Fiber Laser", "Press Brake", "Hand-Patina Bench"],
        "rating": 4.98,
        "image_prompt_portrait": (
            "Documentary portrait of a Texan woman in her 40s wearing a denim apron over "
            "a flannel shirt, holding a freshly laser-cut steel ranch sign with her shop "
            "name engraved, standing in front of a fiber laser machine in a tidy "
            "small-town workshop, warm golden hour light coming through an open bay door, "
            "looking at camera, authentic documentary style"
        ),
        "image_prompt_cover": (
            "Top-down hero shot of a Texas hill-country fabrication workbench: a row of "
            "freshly laser-cut steel signs in various sizes, brass mounting hardware "
            "laid out in piles, a worn leather glove and a hand-stamping mallet, warm "
            "tungsten work-light, dark wood bench surface, magazine-quality composition"
        ),
    },
    {
        "slug": "appalachian-steel-slab",
        "name": "Appalachian Steel & Slab",
        "initials": "AS",
        "location": "Asheville, NC",
        "bio": (
            "Hybrid maker — we pour epoxy rivers through black walnut slabs in the "
            "mornings and run our plasma table in the afternoons. The work that "
            "happens at the seam between wood and steel is what we live for. Studio "
            "tucked into a converted barn outside Asheville, runoff from the French "
            "Broad about a mile north."
        ),
        "techniques": ["PLASMA", "ROUTER", "CUSTOM"],
        "years_crafting": 7,
        "machinery": ["4x8 Plasma CNC", "5x10 CNC Router", "Pressure Pot for Epoxy"],
        "rating": 4.96,
        "image_prompt_portrait": (
            "Bearded craftsman in his late 30s in a leather apron, standing at a "
            "workbench with a half-finished black walnut slab table next to a sheet of "
            "raw steel, North Carolina barn interior with cedar beams overhead, soft "
            "natural light from a window on the left, hands shown gripping a hand "
            "plane, documentary portrait style, shallow depth of field"
        ),
        "image_prompt_cover": (
            "Atmospheric workshop shot: a black walnut slab on sawhorses with bright "
            "teal epoxy river half-poured down the center, steel offcuts and bar "
            "clamps in the foreground, exposed barn rafters above, golden hour light "
            "streaming through a side window, dust motes visible, documentary "
            "photography style, magazine quality"
        ),
    },
    {
        "slug": "great-lakes-fabworks",
        "name": "Great Lakes Fabworks",
        "initials": "GL",
        "location": "Marquette, MI",
        "bio": (
            "Industrial-strength functional fabrication out of Michigan's Upper "
            "Peninsula. We don't do decorative — we do brackets that hold three "
            "generations of shelving, machine guards that pass MIOSHA on the first "
            "walkthrough, and tool-wall systems built around your actual setup. "
            "Quote turnaround is 24 hours; we send a sketch with every bid."
        ),
        "techniques": ["LASER", "PLASMA", "CUSTOM"],
        "years_crafting": 14,
        "machinery": ["6kW Fiber Laser", "Press Brake", "MIG / TIG Stations"],
        "rating": 4.95,
        "image_prompt_portrait": (
            "Documentary portrait of a man in his 50s in safety glasses pushed up on his "
            "forehead, work jacket over a hi-vis shirt, holding a stack of laser-cut "
            "steel shelving brackets, standing in a clean industrial fabrication shop "
            "with a 6kW fiber laser visible behind him, cool overhead LED lighting, "
            "looking at camera, no smile, authentic shop-floor documentary style"
        ),
        "image_prompt_cover": (
            "Overhead workbench shot: a precise grid of laser-cut steel brackets, "
            "machine guard panels, and tool-organizer pegboard sections arranged "
            "neatly on a steel workbench, with a tablet showing engineering drawings "
            "in the corner, cool blue-white industrial lighting, sharp focus, "
            "professional product photography style"
        ),
    },
]


# ════════════════════════════════════════════════════════════════════════
# 20 PRODUCTS — mapped to the 4 makers (5 each), drawn from the spec.
# Every product has BOTH a hero shot AND a process shot.
# ════════════════════════════════════════════════════════════════════════
SEED_PRODUCTS = [
    # ── Cascade Iron Works (PNW) ───────────────────────────────────────
    {
        "slug": "mountain-range-steel-wall-panel",
        "title": "Mountain Range Steel Wall Panel",
        "maker_slug": "cascade-iron-works",
        "category": "Wall Art",
        "technique": "PLASMA",
        "price": 245.0,
        "length_in": 36, "width_in": 14, "weight_lbs": 9.5,
        "materials": ["14ga cold-rolled steel", "Matte black powder coat"],
        "colors": ["black"],
        "description": (
            "Three-layer Cascade Range silhouette cut from 14ga cold-rolled steel and "
            "finished in our matte black powder coat. Mounting holes are drilled, "
            "deburred, and recessed so the heads sit flush — no rough edges anywhere "
            "your hand will go. Cut and finished in a small fabrication workshop at "
            "the base of Mt Hood. Each piece is individually cut; expect tiny "
            "variation in the ridge line — that's the plasma signature, not a defect."
        ),
        "image_prompt_hero": (
            "Hero product photograph of a 36-inch wide layered steel mountain range "
            "wall panel in matte black, three offset peaks creating depth, mounted "
            "on a textured concrete wall, soft directional lighting from upper left, "
            "professional product photography, magazine quality, slight shadow"
        ),
        "image_prompt_process": (
            "Action shot of a plasma CNC table cutting a mountain silhouette out of "
            "14ga steel, blue-white sparks showering downward, smoke hood visible "
            "above, dramatic lighting, sense of motion, documentary fabrication "
            "photography, sharp focus on the cutting torch"
        ),
    },
    {
        "slug": "industrial-gear-clock-wall-piece",
        "title": "Industrial Gear Clock Wall Piece",
        "maker_slug": "cascade-iron-works",
        "category": "Wall Art",
        "technique": "PLASMA",
        "price": 189.0,
        "length_in": 24, "width_in": 24, "weight_lbs": 6.0,
        "materials": ["12ga steel", "Acrylic backing", "Silent quartz movement"],
        "colors": ["black", "raw steel"],
        "description": (
            "Three-layer gear assembly mounted over a smoked acrylic disk — the layered "
            "depth gives the clock a real mechanical illusion that flat designs can't "
            "fake. Silent quartz movement runs 18-24 months on a single AA. Hand-"
            "finished edges; small variation in tooth profile between batches is "
            "intentional."
        ),
        "image_prompt_hero": (
            "Hero shot of a 24-inch industrial-style steel gear clock with three "
            "layered gears creating mechanical depth, smoked acrylic backing, "
            "mounted on a weathered brick wall, golden-hour light from the side, "
            "professional product photography, sharp focus on the clock face"
        ),
        "image_prompt_process": (
            "Close-up of a worker's gloved hands assembling the layered steel gears "
            "of an industrial wall clock on a workbench, allen wrench in one hand, "
            "smoked acrylic backing piece nearby, warm work-light, documentary "
            "fabrication style, shallow depth of field"
        ),
    },
    {
        "slug": "wildlife-deer-in-forest-scene",
        "title": "Wildlife Series — Deer in Forest Scene",
        "maker_slug": "cascade-iron-works",
        "category": "Wall Art",
        "technique": "PLASMA",
        "price": 215.0,
        "length_in": 32, "width_in": 20, "weight_lbs": 7.0,
        "materials": ["14ga steel", "Burnt-edge patina", "Outdoor sealer"],
        "colors": ["burnt steel", "black"],
        "description": (
            "Layered forest scene with a buck stepping through the tree line at dusk. "
            "Edges are torch-burnished after cutting and sealed with a satin outdoor "
            "topcoat so the warm brown patina survives a covered porch. Rustic lodge "
            "aesthetic — pairs well with reclaimed wood backers (not included)."
        ),
        "image_prompt_hero": (
            "Hero shot of a 32-inch layered steel wall panel depicting a deer "
            "silhouette stepping through a pine forest tree line, burnt-edge "
            "patina giving it warm brown highlights, mounted on rough sawn reclaimed "
            "wood backer, lodge interior setting, warm tungsten lighting"
        ),
        "image_prompt_process": (
            "Close-up of a fabricator's torch passing over the cut edge of a steel "
            "deer silhouette, producing the burnt patina effect, orange flame visible, "
            "sparks reflected on the steel, dramatic dark workshop background, "
            "documentary photography, shallow depth of field"
        ),
    },
    {
        "slug": "custom-fire-pit-steel-panels",
        "title": "Custom Fire Pit Steel Panels (Set of 4)",
        "maker_slug": "cascade-iron-works",
        "category": "Outdoor Art",
        "technique": "PLASMA",
        "price": 425.0,
        "length_in": 24, "width_in": 18, "weight_lbs": 22.0,
        "materials": ["1/4 inch Cor-Ten steel", "Hand-finished edges"],
        "colors": ["Cor-Ten rust patina"],
        "description": (
            "Four-panel fire pit surround in 1/4 inch Cor-Ten steel — the rust patina "
            "develops naturally over the first 60 days outdoors and seals itself. "
            "Choose your cutout design at checkout (forest, mountain, wolf, geometric). "
            "Panels slot together with stainless bolts; no welding required on your end."
        ),
        "image_prompt_hero": (
            "Hero shot of a 4-panel outdoor fire pit surround in rust-patina Cor-Ten "
            "steel with a forest silhouette cutout, glowing fire visible through the "
            "cutouts at dusk, snow patches around the base, mountains in the "
            "background, atmospheric outdoor product photography"
        ),
        "image_prompt_process": (
            "Documentary shot of a thick quarter-inch Cor-Ten steel panel mid-cut on "
            "a heavy industrial plasma table, sparks showering, the forest silhouette "
            "design half-revealed, water bath beneath the cutting bed visible, "
            "industrial workshop atmosphere"
        ),
    },
    {
        "slug": "cnc-carved-wooden-mountain-relief",
        "title": "CNC Carved Wooden Mountain Relief",
        "maker_slug": "cascade-iron-works",
        "category": "Wall Art",
        "technique": "ROUTER",
        "price": 295.0,
        "length_in": 30, "width_in": 12, "weight_lbs": 8.0,
        "materials": ["Solid walnut", "Natural oil seal", "Hand-finished edges"],
        "colors": ["walnut natural"],
        "description": (
            "A 3-axis carve of the Cascade range silhouette in solid walnut. We hold a "
            "1/16 inch stepover on the finishing pass so the topographic ridges feel "
            "smooth under your hand. Sealed with a hand-rubbed mineral oil — slight "
            "variation in grain pattern is part of the piece, no two are alike."
        ),
        "image_prompt_hero": (
            "Hero product shot of a 30-inch walnut wood panel with 3D CNC-carved "
            "topographic mountain relief showing depth and contour lines of a "
            "mountain range, oiled finish bringing out grain, mounted on a white "
            "shiplap wall, natural daylight from the side, magazine quality"
        ),
        "image_prompt_process": (
            "Action shot of a CNC router bit carving topographic mountain contours "
            "into a walnut slab, sawdust flying, blue dust collection hose in frame, "
            "shop vacuum noise implied, sharp focus on the cutting bit, documentary "
            "woodshop fabrication photography"
        ),
    },

    # ── Hill Country Forge (TX) ────────────────────────────────────────
    {
        "slug": "forest-silhouette-laser-cut-sign",
        "title": "Forest Silhouette Laser-Cut Sign",
        "maker_slug": "hill-country-forge",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 125.0,
        "length_in": 30, "width_in": 12, "weight_lbs": 4.5,
        "materials": ["16ga steel", "Satin black powder coat"],
        "colors": ["satin black"],
        "description": (
            "A finely engraved tree-line panel laser-cut from 16ga steel and powder-"
            "coated satin black. The detail down in the underbrush is what makes "
            "this one — fiber laser kerf lets us hold sub-millimeter line work that "
            "plasma can't touch. Cut and finished in a small fabrication workshop "
            "outside Fredericksburg."
        ),
        "image_prompt_hero": (
            "Hero shot of a 30-inch wide satin black steel wall panel with a finely "
            "detailed forest tree-line silhouette including small branches and "
            "underbrush, mounted on a whitewashed cabin wall, soft natural window "
            "light, professional product photography"
        ),
        "image_prompt_process": (
            "Tight close-up of a fiber laser head mid-cut on 16ga steel, brilliant "
            "blue-white cutting plume, fine forest detail being revealed, the cut "
            "kerf visible in the foreground, sharp focus, industrial fabrication "
            "documentary photography"
        ),
    },
    {
        "slug": "custom-business-logo-metal-sign",
        "title": "Custom Business Logo Metal Sign",
        "maker_slug": "hill-country-forge",
        "category": "Custom Signs",
        "technique": "LASER",
        "price": 295.0,
        "length_in": 36, "width_in": 18, "weight_lbs": 12.0,
        "materials": ["16ga steel or aluminum", "Powder coat"],
        "colors": ["black", "white", "raw steel"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Upload your logo file (SVG, AI, or high-res PNG). We'll send a vector "
            "preview for approval within 24 hours. Add LED backlight at checkout."
        ),
        "description": (
            "Storefront-grade custom logo sign cut to your exact vector. Mounting "
            "holes laid out to your wall spec; optional LED backlight kit puts a "
            "halo glow behind the steel after dark. Commercial fabrication — we've "
            "shipped these to ranches, restaurants, and breweries across Texas."
        ),
        "image_prompt_hero": (
            "Hero shot of a 36-inch wide custom steel business sign with a generic "
            "ranch-style emblem cut from 16ga steel, mounted on a stone storefront "
            "wall with subtle LED backlight halo glow at dusk, professional "
            "commercial photography style"
        ),
        "image_prompt_process": (
            "Designer's hands at a workstation reviewing a vector CAD file on a "
            "monitor while a finished laser-cut steel logo sign sits on the bench "
            "beside them, warm desk-lamp lighting, documentary workshop style"
        ),
    },
    {
        "slug": "farmhouse-family-name-sign",
        "title": "Farmhouse Family Name Sign",
        "maker_slug": "hill-country-forge",
        "category": "Custom Signs",
        "technique": "LASER",
        "price": 145.0,
        "length_in": 28, "width_in": 10, "weight_lbs": 4.0,
        "materials": ["14ga powder-coated steel", "Hand-rubbed patina"],
        "colors": ["weathered black", "raw rust"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Family name + established year (4 digits). Up to 14 letters in the "
            "name. Script font shown; sans-serif and slab serif available on request."
        ),
        "description": (
            "Script family-name sign in a rustic frame — wedding gift territory. "
            "We hand-rub the finish after powder coat so the patina has real depth "
            "rather than a flat factory look. Each one's a little different by design."
        ),
        "image_prompt_hero": (
            "Hero shot of a 28-inch wide weathered black steel farmhouse family name "
            "sign with elegant script reading 'The Whitfield Family - Est. 2019' "
            "inside a rustic framed border, mounted above a fireplace mantel with "
            "fresh greenery and candles, warm golden-hour light, magazine quality"
        ),
        "image_prompt_process": (
            "Documentary close-up of a craftsperson's hands hand-rubbing patina "
            "onto a finished steel family name sign with a soft cloth, the script "
            "name partially visible, warm tungsten work-lamp, shallow depth of "
            "field, authentic workshop style"
        ),
    },
    {
        "slug": "address-number-metal-plaque",
        "title": "Address Number Metal Plaque",
        "maker_slug": "hill-country-forge",
        "category": "Custom Signs",
        "technique": "LASER",
        "price": 79.0,
        "length_in": 18, "width_in": 6, "weight_lbs": 1.8,
        "materials": ["14ga steel", "Reflective coating option"],
        "colors": ["matte black", "raw steel"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Up to 5 address digits. Add reflective coating at checkout for "
            "night-time visibility (DOT-grade vinyl, 5-year warranty)."
        ),
        "description": (
            "Clean modern address plaque — laser-cut steel digits in your choice of "
            "matte black or raw steel patina. Add the reflective coating option for "
            "fire/EMS visibility at night. Mounting holes and stand-offs included."
        ),
        "image_prompt_hero": (
            "Hero shot of a modern matte black steel address plaque reading '1847' "
            "mounted with brushed stainless standoffs on a sleek board-and-batten "
            "exterior wall, late afternoon Texas hill country light, professional "
            "architectural product photography"
        ),
        "image_prompt_process": (
            "Top-down shot of freshly laser-cut steel address number digits arranged "
            "on a workbench: '1', '8', '4', '7', sharp clean edges still showing "
            "the dark cut line, mounting hardware laid out beside them, "
            "documentary workshop photography"
        ),
    },
    {
        "slug": "custom-quote-wall-panel",
        "title": "Custom Quote Wall Panel",
        "maker_slug": "hill-country-forge",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 169.0,
        "length_in": 30, "width_in": 14, "weight_lbs": 5.5,
        "materials": ["16ga steel", "Matte powder coat"],
        "colors": ["black", "white"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Up to 80 characters of quote text. Choose typeface family at checkout: "
            "industrial slab, refined serif, or modern sans-serif."
        ),
        "description": (
            "Typography-forward wall piece — your quote, your typeface, cut from "
            "16ga steel. The negative space between the letters is where the design "
            "lives; we tune the spacing letter-by-letter rather than letting the "
            "default kerning rule the piece."
        ),
        "image_prompt_hero": (
            "Hero shot of a 30-inch wide matte black steel wall panel with the "
            "laser-cut quote 'Build the workshop you wish you had' in industrial "
            "slab typeface, mounted on a raw concrete wall, dramatic side lighting "
            "casting subtle shadows through the letterforms, magazine quality"
        ),
        "image_prompt_process": (
            "Close-up of a designer reviewing letter spacing on a digital screen "
            "showing typography for the quote, with a partially cut steel quote "
            "panel on the bench beside the workstation, warm desk lighting, "
            "documentary studio photography"
        ),
    },

    # ── Appalachian Steel & Slab (NC) ──────────────────────────────────
    {
        "slug": "custom-state-outline-wall-art",
        "title": "Custom State Outline Wall Art",
        "maker_slug": "appalachian-steel-slab",
        "category": "Wall Art",
        "technique": "PLASMA",
        "price": 135.0,
        "length_in": 22, "width_in": 18, "weight_lbs": 4.5,
        "materials": ["14ga steel", "Powder coat"],
        "colors": ["black", "raw steel", "navy"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Choose your state at checkout. Add a city name + date in script "
            "underneath for an extra $12 — relocation gifts and housewarmings "
            "are our most-shipped combo."
        ),
        "description": (
            "Minimalist state cutout — clean outline, no decorative noise. The "
            "real magic is the optional script underneath: city name + the date "
            "someone moved there. We've shipped a lot of these as 'first house' "
            "gifts. Hand-finished edges."
        ),
        "image_prompt_hero": (
            "Hero shot of a 22-inch tall minimalist matte black steel cutout of the "
            "state of Texas with the script text 'Austin · Est. 2024' cut into the "
            "metal below the outline, mounted on a white shiplap wall, soft natural "
            "light, magazine quality home decor photography"
        ),
        "image_prompt_process": (
            "Plasma table mid-cut on a state outline shape, sparks falling into a "
            "water bath beneath, the recognizable outline starting to emerge from "
            "the steel sheet, industrial workshop atmosphere, sharp focus on the "
            "cutting torch"
        ),
    },
    {
        "slug": "workshop-nameplate-sign",
        "title": "Workshop Nameplate Sign",
        "maker_slug": "appalachian-steel-slab",
        "category": "Custom Signs",
        "technique": "LASER",
        "price": 98.0,
        "length_in": 20, "width_in": 8, "weight_lbs": 2.5,
        "materials": ["Brushed aluminum", "Anodized finish"],
        "colors": ["brushed silver", "black anodized"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Up to 24 characters. Industrial minimal style — works in a garage "
            "branding setup or as a maker's mark above a workbench."
        ),
        "description": (
            "Brushed aluminum shop nameplate — industrial minimal, no decorative "
            "frame. Looks like factory signage because it more or less is, just "
            "made to your name instead of an OSHA number. Mounting standoffs "
            "included for a clean float."
        ),
        "image_prompt_hero": (
            "Hero shot of a 20-inch wide brushed aluminum shop nameplate reading "
            "'NORTH RIDGE FABRICATION' in clean industrial sans-serif, mounted "
            "with stainless standoffs on a raw concrete garage wall, cool "
            "industrial overhead lighting, professional product photography"
        ),
        "image_prompt_process": (
            "Hands using a deburring tool on the freshly cut edges of a brushed "
            "aluminum nameplate sign on a workbench, clean industrial workshop, "
            "documentary photography, shallow depth of field, sharp focus on the "
            "deburring action"
        ),
    },
    {
        "slug": "epoxy-river-wall-art-panel",
        "title": "Epoxy River Wall Art Panel",
        "maker_slug": "appalachian-steel-slab",
        "category": "Wall Art",
        "technique": "CUSTOM",
        "price": 385.0,
        "length_in": 36, "width_in": 14, "weight_lbs": 11.0,
        "materials": ["Black walnut slab", "Pigmented epoxy resin", "Natural oil"],
        "colors": ["walnut + teal", "walnut + emerald", "walnut + cobalt"],
        "description": (
            "A 14-inch wide black walnut slab with a pigmented epoxy river flowing "
            "down the center line. Each slab is hand-selected for grain pattern, "
            "so no two pieces are identical — slight variation is part of what "
            "makes the hybrid build feel honest. Hand-finished edges, natural "
            "oil topcoat."
        ),
        "image_prompt_hero": (
            "Hero shot of a 36-inch tall vertical wall panel: black walnut slab "
            "with rich grain pattern and a teal-pigmented epoxy river flowing "
            "down the center, mounted on a white plaster wall, warm directional "
            "natural light, magazine-quality interior photography"
        ),
        "image_prompt_process": (
            "Action shot of a craftsperson pouring teal-pigmented epoxy resin "
            "between the edges of a black walnut slab forming a river pattern, "
            "the resin glistening as it spreads, gloved hands holding the mixing "
            "cup, workshop bench surface, dramatic side lighting, documentary "
            "fabrication photography"
        ),
    },
    {
        "slug": "custom-cutting-board-engraved",
        "title": "Custom Cutting Board — Engraved",
        "maker_slug": "appalachian-steel-slab",
        "category": "Wall Art",
        "technique": "ROUTER",
        "price": 89.0,
        "length_in": 18, "width_in": 12, "weight_lbs": 3.0,
        "materials": ["Maple end-grain", "Food-safe mineral oil"],
        "colors": ["maple natural"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Engraving line: up to 30 characters. Add a date below for free. "
            "Wedding monogram, anniversary, housewarming — all popular."
        ),
        "description": (
            "End-grain maple cutting board with a deep-routed engraving — keeps "
            "your monogram clean even after years of knife work because we cut "
            "into the end-grain side, not the long-grain. Slight variation in "
            "grain pattern between boards. Re-oil twice a year."
        ),
        "image_prompt_hero": (
            "Hero shot of a 18 by 12 inch maple end-grain cutting board with a "
            "deep-routed monogram 'M&L' and the date '2024' engraved into one "
            "corner, fresh herbs and a chef's knife resting on it, warm farmhouse "
            "kitchen counter setting, natural window light, food photography style"
        ),
        "image_prompt_process": (
            "Close-up of a CNC router bit carving an engraved monogram into the "
            "end-grain face of a maple cutting board, fine sawdust visible in the "
            "carved groove, sharp focus on the bit, warm workshop lighting"
        ),
    },
    {
        "slug": "workshop-bench-top-custom-slab",
        "title": "Workshop Bench-Top Custom Slab",
        "maker_slug": "appalachian-steel-slab",
        "category": "Wall Art",
        "technique": "ROUTER",
        "price": 595.0,
        "length_in": 72, "width_in": 30, "weight_lbs": 95.0,
        "materials": ["Hard maple slab", "Penetrating epoxy seal", "Hand-finished edges"],
        "colors": ["maple natural"],
        "description": (
            "A 72-inch hard maple workbench-top slab — flattened on our 4x10 "
            "router, finished by hand. We hit it with a penetrating epoxy seal "
            "before delivery so the first oil spill doesn't soak in. Premium "
            "functional build — for makers and craftspeople who spend serious "
            "time at a bench. Crated and freighted; lead time 3-4 weeks."
        ),
        "image_prompt_hero": (
            "Hero shot of a 72-inch hard maple workbench top slab set up on heavy "
            "steel workbench legs in a high-end woodshop, hand-plane and brass-"
            "headed mallets resting on the surface, warm shop lighting, "
            "documentary craft photography, sharp focus on the wood grain"
        ),
        "image_prompt_process": (
            "Top-down action shot of a large CNC router flattening pass running "
            "across the face of a hard maple workbench slab, fine sawdust trail "
            "behind the spoilboard bit, scale of the machine evident, "
            "documentary fabrication photography"
        ),
    },

    # ── Great Lakes Fabworks (MI) ──────────────────────────────────────
    {
        "slug": "heavy-duty-cnc-cut-brackets",
        "title": "Heavy-Duty CNC Cut Brackets (Set of 4)",
        "maker_slug": "great-lakes-fabworks",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 75.0,
        "length_in": 10, "width_in": 8, "weight_lbs": 6.0,
        "materials": ["3/16 inch steel", "Raw or powder coat"],
        "colors": ["raw steel", "matte black", "white"],
        "description": (
            "Set of four structural shelf brackets cut from 3/16 inch steel — "
            "rated for 75 lbs per bracket on a 10-inch shelf. Holes pre-drilled "
            "for #14 wood screws (not included). Edges deburred, corners broken. "
            "Order in raw steel for a workshop look or powder coated for the "
            "kitchen / living room."
        ),
        "image_prompt_hero": (
            "Hero shot of four heavy-duty matte black steel L-bracket shelf "
            "supports arranged in a set on a workbench, with one already mounted "
            "supporting a thick walnut shelf with a stack of books, professional "
            "product photography, magazine quality"
        ),
        "image_prompt_process": (
            "Fiber laser head mid-cut on a sheet of 3/16 inch steel, multiple "
            "bracket shapes being cut in a nested pattern to maximize material "
            "yield, brilliant cutting light, sharp focus, industrial fabrication "
            "documentary photography"
        ),
    },
    {
        "slug": "tool-organizer-wall-system",
        "title": "Tool Organizer Wall System",
        "maker_slug": "great-lakes-fabworks",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 285.0,
        "length_in": 48, "width_in": 24, "weight_lbs": 18.0,
        "materials": ["14ga steel pegboard panels", "Powder coat", "Hook hardware set"],
        "colors": ["matte black", "industrial grey"],
        "description": (
            "Modular steel pegboard wall system — bays are 24 by 24 and lock "
            "together flush, so you can build out 2 by 2 or 4 by 8 depending on "
            "the wall. Pegs and hooks are heavy-gauge cold-drawn steel, not "
            "the bent-wire stuff. Comes with starter hook set (20 pieces)."
        ),
        "image_prompt_hero": (
            "Hero shot of a 48 by 24 inch matte black steel pegboard wall system "
            "fully loaded with hand tools — hammers, screwdrivers, wrenches, "
            "calipers — neatly organized in a clean workshop, cool industrial "
            "lighting, professional product photography"
        ),
        "image_prompt_process": (
            "Two workshop technicians installing modular steel pegboard panels "
            "on a workshop wall, one holding the panel level while the other "
            "drives screws, work gloves and a stud finder visible, documentary "
            "installation photography"
        ),
    },
    {
        "slug": "industrial-cable-routing-brackets",
        "title": "Industrial Cable Routing Brackets",
        "maker_slug": "great-lakes-fabworks",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 45.0,
        "length_in": 6, "width_in": 4, "weight_lbs": 1.2,
        "materials": ["1/8 inch aluminum", "Anodized clear"],
        "colors": ["natural aluminum"],
        "description": (
            "Set of 12 aluminum cable routing brackets — designed for a tidy "
            "workshop or home-lab setup. Each bracket cradles up to 3 cables "
            "and bolts down with two screws. Niche product, but if you've ever "
            "wished your bench wasn't a snake nest, these are the fix."
        ),
        "image_prompt_hero": (
            "Hero shot of clean aluminum cable routing brackets installed along "
            "the back edge of a workshop bench, organizing power cables and "
            "ethernet cables neatly, cool industrial lighting, sharp focus, "
            "professional product photography"
        ),
        "image_prompt_process": (
            "Top-down shot of a stack of freshly laser-cut aluminum cable "
            "routing brackets on a steel workbench, blue protective film still "
            "on the surface of the cut metal, mounting hardware in a small "
            "parts tray nearby, documentary workshop photography"
        ),
    },
    {
        "slug": "machine-guard-custom-panels",
        "title": "Machine Guard Custom Panels",
        "maker_slug": "great-lakes-fabworks",
        "category": "Custom Signs",
        "technique": "LASER",
        "price": 325.0,
        "length_in": 36, "width_in": 24, "weight_lbs": 14.0,
        "materials": ["14ga steel", "Powder coat OSHA safety yellow"],
        "colors": ["safety yellow", "matte black"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Send your machine make/model and we'll quote a custom panel set with "
            "matched mounting tabs. Most CNCs, presses, and grinders fit our "
            "standard cutouts within 48-hour quote turnaround."
        ),
        "description": (
            "Custom machine guard panels — built to your CNC, press, or grinder. "
            "Panels are cut, formed, and finished in OSHA safety yellow powder "
            "coat. Adds authenticity to a real production shop, and they pass "
            "MIOSHA inspection on the first walkthrough."
        ),
        "image_prompt_hero": (
            "Hero shot of an OSHA safety yellow steel machine guard panel "
            "installed on the side of an industrial CNC milling machine in a "
            "clean production workshop, cool overhead lighting, professional "
            "industrial product photography"
        ),
        "image_prompt_process": (
            "Press brake forming a 90-degree bend on a yellow powder-coated "
            "steel machine guard panel, the operator's hands holding the panel "
            "in position, the press jaw mid-cycle, dramatic industrial lighting"
        ),
    },
    {
        "slug": "laser-engraved-wooden-map",
        "title": "Laser Engraved Wooden Map",
        "maker_slug": "great-lakes-fabworks",
        "category": "Wall Art",
        "technique": "LASER",
        "price": 165.0,
        "length_in": 24, "width_in": 18, "weight_lbs": 3.5,
        "materials": ["Birch plywood", "Hand-rubbed oil finish"],
        "colors": ["birch natural"],
        "personalization_enabled": True,
        "personalization_instructions": (
            "Choose a city. We'll engrave the street grid + add a star at the "
            "address of your choice. 'Where we got married' is the #1 request, "
            "if you're looking for a gift idea."
        ),
        "description": (
            "Laser-engraved city map on 1/4 inch birch plywood. We engrave the "
            "actual street grid down to alley resolution, then mark a meaningful "
            "spot with a star. Wedding gifts, housewarming gifts, 'we met here' "
            "gifts. Hand-rubbed oil finish — light grain variation between panels."
        ),
        "image_prompt_hero": (
            "Hero shot of a 24 by 18 inch birch plywood panel with a laser-"
            "engraved street map of downtown Chicago, a small engraved star "
            "marking a specific intersection, mounted on a white wall in a "
            "modern living room, natural daylight, magazine quality home decor"
        ),
        "image_prompt_process": (
            "Close-up of a CO2 laser engraving fine street grid lines into "
            "birch plywood, the bright cutting light illuminating the wood "
            "surface, a wisp of smoke rising from the engraving, sharp focus, "
            "documentary fabrication photography"
        ),
    },
]


# ════════════════════════════════════════════════════════════════════════
# Image generation — reuses the seed_featured_examples pattern exactly.
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
        print(f"  [WARN] emergentintegrations missing ({e}) — placeholder kept")
        return public_path

    api_key = env_get("EMERGENT_LLM_KEY")
    if not api_key:
        print("  [WARN] EMERGENT_LLM_KEY not set — placeholder kept")
        return public_path

    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"starter-{slug}-{suffix}-{uuid.uuid4().hex[:8]}",
            system_message=(
                "You generate cohesive, well-composed photography for an artisan "
                "marketplace. Photos should look authentic, documentary-style — never "
                "AI-rendered or over-stylized. Avoid text, watermarks, or logos in "
                "the image unless explicitly requested. No human faces unless "
                "explicitly described in the prompt."
            ),
        )
        .with_model("gemini", "gemini-3.1-flash-image-preview")
        .with_params(modalities=["image", "text"])
    )

    try:
        msg = UserMessage(text=prompt)
        _text, images = await chat.send_message_multimodal_response(msg)
        if not images:
            print(f"  [WARN] no image returned for {fname}")
            return public_path
        img_bytes = base64.b64decode(images[0]["data"])
        out_path.write_bytes(img_bytes)
        print(f"  ✓ {fname} ({len(img_bytes)//1024}KB)")
    except Exception as e:
        print(f"  [WARN] image gen failed for {fname}: {e}")

    return public_path


# ════════════════════════════════════════════════════════════════════════
# Upsert helpers — idempotent by slug.
# ════════════════════════════════════════════════════════════════════════
async def _next_founder_number() -> int:
    """Bump the platform founder_counter and return the new number. Same
    behavior as the live promote endpoint so /founders sorts correctly."""
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
        {"slug": m["slug"]},
        {"_id": 0, "id": 1, "created_at": 1, "founder_number": 1},
    )

    # Founder number — reuse existing if present, otherwise allocate a fresh
    # one off the platform counter so we don't collide with real promotions.
    founder_number = (existing or {}).get("founder_number")
    if not founder_number:
        founder_number = await _next_founder_number()

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
        # Founding Maker tier — same shape the live promote endpoint uses.
        "tier": "founder",
        "founder_status": "inaugural",
        "founder_started_at": now.isoformat(),
        "founder_expires_at": None,                     # inaugural = lifetime
        "founder_grace_until": (now + timedelta(days=14)).isoformat(),
        "founder_number": founder_number,
        "is_beta_tester": False,
        # Transparency flag — drives the "✦ FEATURED EXAMPLE" badge so visitors
        # know these aren't actively transacting makers yet.
        "featured_example": True,
        "created_at": (existing or {}).get("created_at") or now_iso(),
    }
    await db.makers.update_one({"slug": m["slug"]}, {"$set": doc}, upsert=True)
    return doc


async def _upsert_product(p: dict):
    hero = await _generate_image(p["slug"], p["image_prompt_hero"], "hero")
    process = await _generate_image(p["slug"], p["image_prompt_process"], "process")
    expires_at = (datetime.now(timezone.utc) + timedelta(days=120)).isoformat()

    existing = await db.products.find_one(
        {"slug": p["slug"]},
        {"_id": 0, "id": 1, "created_at": 1},
    )
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
        # Transparency + purge enablement — same flag the existing purge endpoint
        # at POST /api/admin/seed/featured-content/purge already filters on.
        "featured_example": True,
        "is_seed": True,
        "created_at": (existing or {}).get("created_at") or now_iso(),
    }
    await db.products.update_one({"slug": p["slug"]}, {"$set": doc}, upsert=True)


async def main():
    print(f"\n════ Starter Pack Seeder · {len(SEED_MAKERS)} makers, {len(SEED_PRODUCTS)} products ════\n")
    print("→ Inserting makers...")
    for m in SEED_MAKERS:
        await _upsert_maker(m)
        print(f"  ✓ {m['slug']}")
    print(f"\n→ Inserting {len(SEED_PRODUCTS)} products (hero + process image each)...")
    for p in SEED_PRODUCTS:
        await _upsert_product(p)
        print(f"  ✓ {p['slug']} → {p['maker_slug']}")
    # Sync listings_count from actual product counts so each maker page is
    # accurate.
    for m in SEED_MAKERS:
        actual = await db.products.count_documents(
            {"maker_slug": m["slug"], "deleted_at": None, "status": "published"}
        )
        await db.makers.update_one({"slug": m["slug"]}, {"$set": {"listings_count": actual}})
    print("\n✓ Done.")


if __name__ == "__main__":
    asyncio.run(main())
