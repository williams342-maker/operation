"""iter413bv — Generate the 4 outstanding Garage Builders emblem variants.

Reads the master 2048×2048 PNG at
`/app/frontend/public/downloads/garage-builders.png` and produces:

  1. garage-builders-monochrome.png — white-on-transparent, high contrast
  2. garage-builders-orange.png     — single-color orange (#ff4500) on transparent
  3. garage-builders-square.png     — 1080×1080 social avatar variant
  4. garage-builders-engraving.svg  — vector traced from a binary version

Variants 1-3 are generated via Gemini Nano Banana (image-to-image
refinement) using the EMERGENT_LLM_KEY. The vector (variant 4) is
deterministic — produced by potrace on a thresholded copy of the
master PNG, no LLM involved.

Run once from the backend container:
    cd /app/backend && python scripts/generate_emblem_variants.py
"""
from __future__ import annotations
from config import env_get

import asyncio
import base64
import os
import subprocess
import sys
from pathlib import Path

# Make the backend importable when this script is run directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

MASTER = Path("/app/frontend/public/downloads/garage-builders.png")
OUT_DIR = Path("/app/frontend/public/downloads")
MODEL_ID = "gemini-3.1-flash-image-preview"


def _load_master_b64() -> str:
    with open(MASTER, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


async def _generate(prompt: str, dest: Path, master_b64: str) -> bool:
    """Single image-to-image generation. Returns True on success."""
    api_key = env_get("EMERGENT_LLM_KEY")
    if not api_key:
        print(f"  [{dest.name}] EMERGENT_LLM_KEY missing — skipping")
        return False
    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"emblem-variant-{dest.stem}",
            system_message="You are a precision logo refinement engine. "
                           "Preserve the source composition exactly. Apply the "
                           "requested transformation. Output PNG only.",
        )
        .with_model("gemini", MODEL_ID)
        .with_params(modalities=["image", "text"])
    )
    msg = UserMessage(
        text=prompt,
        file_contents=[ImageContent(master_b64)],
    )
    try:
        text, images = await chat.send_message_multimodal_response(msg)
    except Exception as e:
        print(f"  [{dest.name}] LLM call failed: {e}")
        return False
    if not images:
        print(f"  [{dest.name}] no image returned (text was: {text[:120] if text else '<empty>'})")
        return False
    img_bytes = base64.b64decode(images[0]["data"])
    dest.write_bytes(img_bytes)
    print(f"  [{dest.name}] saved · {len(img_bytes) // 1024} KB · mime={images[0]['mime_type']}")
    return True


def _build_engraving_svg(src_png: Path, dest_svg: Path) -> bool:
    """Vectorize a binarized copy of the master PNG with potrace.

    Pipeline:
      1. PIL → grayscale → threshold to pure 1-bit black & white.
      2. Save as BMP (potrace's preferred input).
      3. potrace → SVG with single-path vector outline.
    """
    try:
        from PIL import Image
    except ImportError:
        print(f"  [{dest_svg.name}] Pillow not installed — skipping")
        return False
    try:
        img = Image.open(src_png).convert("L")
        # Threshold: any pixel darker than 160 → black, else white.
        # Tuned against the orange-on-dark master so the gear outline
        # and labels both survive vectorization.
        bw = img.point(lambda p: 0 if p < 160 else 255, mode="1")
        tmp_bmp = dest_svg.with_suffix(".tmp.bmp")
        bw.save(tmp_bmp)
        # potrace -s = SVG output, --tight = crop to glyph bbox.
        subprocess.run(
            ["potrace", "-s", "--tight", "-o", str(dest_svg), str(tmp_bmp)],
            check=True,
            capture_output=True,
        )
        tmp_bmp.unlink(missing_ok=True)
        print(f"  [{dest_svg.name}] saved · {dest_svg.stat().st_size // 1024} KB · vector path")
        return True
    except subprocess.CalledProcessError as e:
        print(f"  [{dest_svg.name}] potrace failed: {e.stderr.decode()[:200]}")
        return False
    except Exception as e:
        print(f"  [{dest_svg.name}] vectorization failed: {e}")
        return False


PROMPTS = {
    "garage-builders-monochrome.png": (
        "Convert this badge to a single-color WHITE-on-transparent design. "
        "Every line, gear tooth, label, and icon should be pure white "
        "(#ffffff) on a fully transparent background. Preserve the "
        "circular gear composition and every text label exactly as in "
        "the source. No gradients, no orange, no drop shadows. Output "
        "PNG with alpha channel."
    ),
    "garage-builders-orange.png": (
        "Convert this badge to a single-color ORANGE-on-transparent "
        "design. Use exactly the brand orange #ff4500 for every line, "
        "gear tooth, label, and icon. Fully transparent background. "
        "Preserve the circular gear composition and every text label "
        "exactly. No gradients, no white fill, no drop shadows. "
        "Output PNG with alpha channel."
    ),
    "garage-builders-square.png": (
        "Recompose this badge as a 1080×1080 social avatar. Center the "
        "gear emblem and crop to a square. Keep the orange + warm "
        "background palette of the original, preserve the GARAGE "
        "BUILDERS lockup in the center, and preserve all 9 maker "
        "segment labels around the perimeter. The output must read "
        "clearly at small sizes (Instagram/X avatar). Output PNG."
    ),
}


async def main():
    if not MASTER.exists():
        print(f"ERROR: master emblem missing at {MASTER}")
        sys.exit(1)
    print(f"Master: {MASTER} ({MASTER.stat().st_size // 1024} KB)")
    print(f"Output: {OUT_DIR}/")
    master_b64 = _load_master_b64()

    print("\n── 1-3. Nano Banana image-to-image variants ──")
    for filename, prompt in PROMPTS.items():
        await _generate(prompt, OUT_DIR / filename, master_b64)

    print("\n── 4. Engraving-ready vector (potrace) ──")
    _build_engraving_svg(MASTER, OUT_DIR / "garage-builders-engraving.svg")

    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
