"""iter355 — Generate 16 hero collage photos via Nano Banana.

One-off script. Reads the prompt spec inline, generates 4 documentary-style
craft photos per hero set × 4 sets = 16 images. Writes JPEG bytes to
`/app/frontend/public/hero-photos/{set_idx}-{panel_idx}.jpg`. Hero.jsx
references these local paths instead of Unsplash.

Run from /app/backend:
    python3 -m scripts.generate_hero_photos

Concurrency: 4 images at a time so we don't slam the upstream too hard.
"""
from __future__ import annotations
import asyncio
import base64
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
if not EMERGENT_LLM_KEY:
    raise SystemExit("EMERGENT_LLM_KEY missing.")

OUT_DIR = Path("/app/frontend/public/hero-photos")
OUT_DIR.mkdir(parents=True, exist_ok=True)

SETS = [
    {
        "name": "small-shops-big-potential",
        "panels": [
            "Documentary-style close-up photograph of a sharp woodworking hand-plane "
            "curling fresh maple shavings off a workbench. Warm side-light from a window. "
            "Shallow depth of field. The shavings catch the light. Natural wood grain visible. "
            "Authentic American workshop. No people in frame. No watermarks. No text overlays. "
            "Square 1:1 framing, magazine quality.",

            "Documentary-style close-up of leather worker's hands stitching a wallet "
            "with a hand-held needle and waxed thread. Saddle-stitch technique. "
            "Tan vegetable-tanned leather. Brass rivets nearby. Workbench surface. "
            "Soft natural daylight. Authentic small-shop atmosphere. "
            "No watermarks, no text. Square 1:1 framing, magazine quality.",

            "Documentary-style photo of an angle grinder throwing bright orange sparks "
            "while cutting raw steel in a small American metal-fabrication shop. "
            "Sparks arc beautifully against a dark workshop background. Shallow depth of field. "
            "Slight motion blur on sparks. No people's faces in frame. No watermarks. "
            "Square 1:1 framing, dramatic documentary quality.",

            "Documentary-style close-up of a hand-thrown ceramic mug being shaped on "
            "a spinning potter's wheel. Muddy hands gently pulling the clay walls upward. "
            "Splatter of slip on the wheel head. Warm tungsten light from the studio. "
            "Shallow depth of field. No watermarks. No text. Square 1:1, magazine quality.",
        ],
    },
    {
        "name": "made-by-real-people",
        "panels": [
            "Documentary-style photo of two craftsperson's hands collaboratively working on "
            "a wooden joinery project at a busy artisan workbench. Various hand tools laid out. "
            "Warm afternoon light. Sawdust on the bench. Authentic small American workshop. "
            "No faces visible. No watermarks. Square 1:1, magazine quality.",

            "Documentary-style close-up of skilled hands working colored cotton threads on "
            "a traditional floor loom. The shuttle mid-pass through the warp. Vibrant earth-tone "
            "yarns. Wooden loom frame in soft focus. Studio daylight. No faces in frame. "
            "No watermarks. Square 1:1, magazine quality.",

            "Documentary-style photo of a blacksmith hammering glowing orange steel on an "
            "anvil inside a small forge. Sparks fly. Hammer caught mid-strike. Tongs holding "
            "the hot piece. Dark workshop background contrasts the bright metal. "
            "Authentic American smithy. No watermarks. Square 1:1, dramatic documentary quality.",

            "Documentary-style close-up of a glassblower shaping molten glass on the end of "
            "a blowpipe. The glass glows bright orange. Wooden shaping tool in hand. Dark furnace "
            "background. Heat shimmer visible. No faces visible. No watermarks. Square 1:1, "
            "magazine quality.",
        ],
    },
    {
        "name": "made-in-america-made-to-last",
        "panels": [
            "Documentary-style overhead photo of a handcrafted oak workbench with hand tools "
            "laid out neatly — chisels, mallet, marking gauge, sliding bevel. Aged wood with "
            "tool marks. Natural soft daylight. American-made craftsmanship feel. "
            "No watermarks. No text. Square 1:1, magazine quality.",

            "Documentary-style close-up of a hand-stitched full-grain leather bifold wallet "
            "lying on a wooden surface. Solid brass corner-rivets. Visible saddle-stitch in "
            "tan thread. Aged patina on the leather. Heirloom quality. Studio daylight. "
            "No watermarks. Square 1:1, magazine quality.",

            "Documentary-style close-up of a hand-forged kitchen knife resting on a butcher-block "
            "cutting board. Hammered-finish steel blade. Stabilized walnut burl handle with brass "
            "pin rivets. Soft side-lighting catching the blade's edge. American bladesmith "
            "craftsmanship. No watermarks. Square 1:1, magazine quality.",

            "Documentary-style photo of a stack of three handmade stoneware bowls fresh from "
            "the kiln, cooling on a wooden shelf. Speckled reactive glaze in earth tones — "
            "celadon green, oatmeal, dark iron. Workshop atmosphere in background. "
            "No watermarks. Square 1:1, magazine quality.",
        ],
    },
    {
        "name": "one-of-a-kind-every-time",
        "panels": [
            "Documentary-style close-up of a live-edge black walnut slab showing dramatic grain, "
            "knots, and natural edge bark. Resting on sawhorses in a small woodshop. Sunlight "
            "highlights the wood's character. Sawdust visible. No watermarks. Square 1:1, "
            "magazine quality.",

            "Documentary-style close-up of a handwoven textile with a bold geometric pattern "
            "in rust, indigo, and cream. Visible weave structure and slight imperfections that "
            "prove human hands. Soft studio daylight. No watermarks. Square 1:1, magazine quality.",

            "Documentary-style close-up of a hand-thrown ceramic vessel with a vibrant reactive "
            "copper-red glaze. Visible thrown rings around the body. Drip glaze near the foot. "
            "Soft side-lighting. Dark seamless background. No watermarks. Square 1:1, "
            "magazine quality.",

            "Documentary-style overhead close-up of hand-stamped sterling silver jewelry on "
            "raw linen — a ring, a pair of earrings, and a small pendant. Each piece slightly "
            "irregular, with hammer marks. Soft daylight. No watermarks. Square 1:1, "
            "magazine quality.",
        ],
    },
]


async def gen_one(set_idx: int, panel_idx: int, prompt: str) -> str | None:
    from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore

    out_path = OUT_DIR / f"{set_idx}-{panel_idx}.jpg"
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"hero-{set_idx}-{panel_idx}-{uuid.uuid4().hex[:6]}",
        system_message=(
            "You generate photorealistic, documentary-style photography for an "
            "artisan marketplace. Avoid AI-rendered look, watermarks, on-image text, and "
            "any visible faces. Subjects should look like actual handmade American "
            "craft work captured by a magazine photographer."
        ),
    ).with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])

    try:
        _text, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))
        if not images:
            print(f"  set {set_idx} panel {panel_idx}: no images returned"); return None
        img_bytes = base64.b64decode(images[0]["data"])
        out_path.write_bytes(img_bytes)
        size_kb = len(img_bytes) // 1024
        print(f"  set {set_idx} panel {panel_idx}: wrote {out_path.name} ({size_kb} KB)")
        return str(out_path)
    except Exception as e:
        print(f"  set {set_idx} panel {panel_idx}: FAIL — {type(e).__name__}: {str(e)[:200]}")
        return None


async def main():
    tasks = []
    for set_idx, s in enumerate(SETS):
        for panel_idx, prompt in enumerate(s["panels"]):
            tasks.append((set_idx, panel_idx, prompt))
    print(f"Generating {len(tasks)} hero photos (4 sets × 4 panels)…")

    # Batch concurrent calls to 4 at a time so we don't slam the upstream.
    results: list[tuple[int, int, str | None]] = []
    BATCH = 4
    for i in range(0, len(tasks), BATCH):
        chunk = tasks[i : i + BATCH]
        coros = [gen_one(s, p, prompt) for (s, p, prompt) in chunk]
        chunk_results = await asyncio.gather(*coros, return_exceptions=False)
        for (s, p, _), r in zip(chunk, chunk_results):
            results.append((s, p, r))
        print(f"  ── batch {i // BATCH + 1} done ({i + len(chunk)}/{len(tasks)})")

    ok = sum(1 for _, _, r in results if r)
    print(f"\nDONE: {ok}/{len(tasks)} images generated.")


if __name__ == "__main__":
    asyncio.run(main())
