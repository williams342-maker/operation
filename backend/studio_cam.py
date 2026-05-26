"""Maker Studio CAM strategy engine.

Deterministic lookup table-driven recommendation system for feed rate,
RPM, plunge rate, tooling, and pass count based on material + depth +
machine type. Driven by published manufacturer cutting charts (Hypertherm,
Onsrud, Boeing aluminum, Trotec laser) — so the numbers are conservative
real-world defaults, not LLM hallucinations.

Output: a JSON-friendly dict consumed by both the /api/studio/cam-strategy
endpoint and the React Studio UI. The frontend renders the dict as a clean
card under the parametric controls.

Schema:
  {
    "tool": "1/4\" carbide single-flute end mill",
    "feed_rate":  60,      # IPM (or mm/min if units == "mm")
    "plunge_rate": 12,     # IPM
    "rpm":        18000,
    "passes":     2,
    "depth_per_pass": 0.125,  # in
    "chipload":   0.004,   # in/tooth
    "notes":      "Use climb milling for cleanest edge…",
    "machine":    "router",
    "material":   "wood",
    "tier":       "conservative",
  }
"""
from __future__ import annotations

import math
from typing import Optional


# ─────────────────────────────────────────────────────────────────────────────
# Cutting chart per (material, machine). Values are "conservative typical"
# entries pulled from public manufacturer references. The runtime function
# scales them by depth + adjusts for engrave mode.
# ─────────────────────────────────────────────────────────────────────────────

CAM_CHART = {
    ("wood", "router"): {
        "tool": '1/4" carbide upcut spiral end mill',
        "rpm": 18000,
        "feed_rate": 100,
        "plunge_rate": 30,
        "chipload": 0.005,
        "max_depth_per_pass": 0.25,
    },
    ("wood", "laser"): {
        "tool": "60W CO2 laser, air assist",
        "rpm": None,
        "feed_rate": 25,         # mm/s typical; we convert via units
        "plunge_rate": None,
        "chipload": None,
        "max_depth_per_pass": 0.25,
    },
    ("plywood", "router"): {
        "tool": '1/8" carbide compression end mill',
        "rpm": 18000,
        "feed_rate": 80,
        "plunge_rate": 25,
        "chipload": 0.004,
        "max_depth_per_pass": 0.20,
    },
    ("plywood", "laser"): {
        "tool": "60W CO2 laser, air assist",
        "rpm": None,
        "feed_rate": 18,
        "plunge_rate": None,
        "chipload": None,
        "max_depth_per_pass": 0.25,
    },
    ("steel", "router"): {
        # Most hobby routers can't cut steel — this is for industrial mills.
        "tool": '1/4" carbide 4-flute end mill',
        "rpm": 1800,
        "feed_rate": 6,
        "plunge_rate": 1.5,
        "chipload": 0.001,
        "max_depth_per_pass": 0.030,
    },
    ("steel", "plasma"): {
        "tool": "Plasma torch 45A, 0.040 consumables",
        "rpm": None,
        "feed_rate": 100,
        "plunge_rate": None,
        "chipload": None,
        "max_depth_per_pass": 0.50,
    },
    ("aluminum", "router"): {
        "tool": '1/4" carbide O-flute end mill, single flute',
        "rpm": 18000,
        "feed_rate": 40,
        "plunge_rate": 8,
        "chipload": 0.003,
        "max_depth_per_pass": 0.040,
    },
    ("aluminum", "laser"): {
        "tool": "Fiber laser 1kW",
        "rpm": None,
        "feed_rate": 100,
        "plunge_rate": None,
        "chipload": None,
        "max_depth_per_pass": 0.125,
    },
    ("acrylic", "router"): {
        "tool": '1/4" carbide O-flute end mill',
        "rpm": 16000,
        "feed_rate": 80,
        "plunge_rate": 20,
        "chipload": 0.005,
        "max_depth_per_pass": 0.125,
    },
    ("acrylic", "laser"): {
        "tool": "60W CO2 laser, air assist (low)",
        "rpm": None,
        "feed_rate": 12,
        "plunge_rate": None,
        "chipload": None,
        "max_depth_per_pass": 0.25,
    },
}

# Suggested default machine per material — what most CNC creators on the
# platform actually use. Override-able by the API caller.
DEFAULT_MACHINE = {
    "wood":     "router",
    "plywood":  "router",
    "steel":    "plasma",
    "aluminum": "router",
    "acrylic":  "laser",
}

NOTES_LIBRARY = {
    ("wood", "router"): (
        "Use climb milling for the cleanest edge. Slow your feed rate by 20% for "
        "burl or knotty stock — it'll save you tear-out."
    ),
    ("wood", "laser"): (
        "Birch ply varies a lot batch-to-batch — always burn a 1×1\" test square "
        "before committing to a long job. Char less = speed up, not power down."
    ),
    ("plywood", "router"): (
        "Compression bit eliminates top + bottom tear-out in one pass. Don't drop "
        "below 80 IPM or you'll burn the cores."
    ),
    ("plywood", "laser"): (
        "Use the lowest power that fully cuts — over-power = scorched edges. "
        "Air assist keeps the kerf clean."
    ),
    ("steel", "router"): (
        "Flood coolant is REQUIRED. Without it, expect 30% chipload reduction and "
        "regular tool changes. Climb-mill only on rigid setups."
    ),
    ("steel", "plasma"): (
        "Keep torch height at 1.5 mm. Change consumables every 2 hours of arc-on "
        "time. Dross usually means feed too slow, not amps too low."
    ),
    ("aluminum", "router"): (
        "Single flute O-flutes evacuate aluminum chips cleanly. Light mist of "
        "WD-40 as coolant is enough for sub-1/4\" depths. Ramp into cuts."
    ),
    ("aluminum", "laser"): (
        "Aluminum reflects ~92% of CO2 wavelengths — use fiber only. "
        "Nitrogen assist for oxidation-free edge."
    ),
    ("acrylic", "router"): (
        "Use an O-flute bit (NEVER an upcut spiral — it'll chip). Run RPMs high "
        "and feeds high to throw chips and avoid remelt."
    ),
    ("acrylic", "laser"): (
        "Cast acrylic flame-polishes itself. Use the LOWEST power that cuts "
        "through. Extruded acrylic crystallizes — avoid."
    ),
}


def _round_smart(v: float) -> float:
    if v >= 100:
        return round(v)
    if v >= 10:
        return round(v, 1)
    return round(v, 3)


def cam_strategy(
    material: str,
    depth: float,
    *,
    units: str = "inches",
    machine: Optional[str] = None,
    engrave_only: bool = False,
) -> dict:
    """Return a deterministic CAM recommendation dict.

    Parameters mirror the design intent JSON; `depth` is the stock thickness
    in the user's declared units. We always normalize to inches internally
    so the chart values stay consistent.
    """
    material = (material or "wood").lower()
    if material not in DEFAULT_MACHINE:
        material = "wood"
    machine = (machine or DEFAULT_MACHINE[material]).lower()
    chart_key = (material, machine)
    if chart_key not in CAM_CHART:
        # Fall back to the default machine for the material.
        machine = DEFAULT_MACHINE[material]
        chart_key = (material, machine)

    chart = CAM_CHART[chart_key]
    depth_in = float(depth) if units == "inches" else float(depth) / 25.4

    # Engraving never needs full-depth, so we cap to 0.030" or 0.020 × depth.
    if engrave_only:
        engrave_depth = max(0.01, min(0.030, depth_in * 0.2))
        passes = 1
        depth_per_pass_in = engrave_depth
        note_extra = " Engraving — single shallow pass."
    else:
        max_dpp = chart["max_depth_per_pass"]
        passes = max(1, math.ceil(depth_in / max_dpp))
        depth_per_pass_in = depth_in / passes
        note_extra = ""

    notes = NOTES_LIBRARY.get(chart_key, "") + note_extra

    # Unit conversion for the response. Feed rates in CAM_CHART are in IPM
    # for routers, mm/s for lasers (since that's how their docs read).
    if units == "mm":
        feed_out = chart["feed_rate"] * 25.4 if machine == "router" else chart["feed_rate"]
        plunge_out = (chart["plunge_rate"] * 25.4) if (chart["plunge_rate"] and machine == "router") else chart["plunge_rate"]
        depth_per_pass_out = depth_per_pass_in * 25.4
    else:
        feed_out = chart["feed_rate"]
        plunge_out = chart["plunge_rate"]
        depth_per_pass_out = depth_per_pass_in

    unit_label = {
        "router": ("IPM", "in"),
        "laser":  ("mm/s", "—"),
        "plasma": ("IPM", "in"),
    }.get(machine, ("IPM", "in"))

    return {
        "material": material,
        "machine":  machine,
        "tool":     chart["tool"],
        "rpm":      chart["rpm"],
        "feed_rate": _round_smart(feed_out) if feed_out is not None else None,
        "plunge_rate": _round_smart(plunge_out) if plunge_out is not None else None,
        "passes":   passes,
        "depth_per_pass": _round_smart(depth_per_pass_out),
        "chipload": chart["chipload"],
        "units":    units,
        "feed_unit": unit_label[0],
        "depth_unit": "mm" if units == "mm" else "in",
        "engrave_only": engrave_only,
        "tier":     "conservative",
        "notes":    notes,
    }


SUPPORTED_MACHINES = ("router", "laser", "plasma")
