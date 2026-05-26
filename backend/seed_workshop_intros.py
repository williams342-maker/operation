"""Generate "From the Workshop" intros for the iter227 starter pack makers.

iter228 — 4 documentary-style intro paragraphs, 120-180 words each,
surfaced on /makers/<slug> directly under the maker's bio. Distinct from
the existing `bio` field: bio is the 1-3 sentence tagline, workshop_intro
is the deeper story that turns a visitor into a believer.

Voice goals (locked in the prompt below):
  • First-person plural ("we") — these are small shops, not corporations.
  • Specific machinery + materials called out by name (no generic
    "we use modern equipment" filler).
  • One concrete origin moment ("started in a garage", "took over
    grandpa's lathe", "left a corporate gig") to anchor authenticity.
  • Reference to the region — these makers' locations are part of the
    brand identity (Hood River vs Fredericksburg vs Asheville vs UP MI).
  • End on a confident promise about craftsmanship (one line, no fluff).

Idempotent — re-runs skip makers that already have a workshop_intro.
Run with:

    cd /app/backend && python3 seed_workshop_intros.py
"""
import asyncio
import os
import sys
import uuid

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from core import db  # noqa: E402

# The 4 iter227 starter-pack makers. We could expand to all
# featured_example makers but the user's brief was specifically these
# four — staying disciplined.
TARGET_SLUGS = [
    # iter227 starter pack
    "cascade-iron-works",
    "hill-country-forge",
    "appalachian-steel-slab",
    "great-lakes-fabworks",
    # iter229 expansion — 6 new makers
    "blackriver-laserworks",
    "emberline-metalworks",
    "northforge-customs",
    "redwood-cnc-collective",
    "copperedge-makers",
    "forge-and-grain",
]


PROMPT_TEMPLATE = """You're writing a "From the Workshop" intro paragraph for a small
independent maker's profile page on an artisan marketplace. The reader
is a buyer evaluating whether this maker is real and whether their
craftsmanship is worth a $200-$500 commit.

CONTEXT ABOUT THIS MAKER:
- Shop name: {name}
- Region: {location}
- Bio tagline: {bio}
- Years in the craft: {years}
- Workshop machinery: {machinery}
- Specialty techniques: {techniques}

WRITE A 120-180 WORD INTRO PARAGRAPH that:
1. Opens with a concrete origin moment — a specific year, person, or
   incident that put them into this craft (you can invent a plausible one
   that fits their region and equipment — be specific, not generic).
2. Names at least 2 of their machinery items by their actual model/type
   ("our 5x10 plasma table", "the press brake we picked up from an estate
   sale in Ohio") — specifics build trust.
3. Mentions one thing they refuse to compromise on (an edge finish, a
   material grade, a process step) — the obsession that separates them
   from a stamped catalog.
4. References their region naturally — not as a tagline but woven into
   the texture of the place.
5. Ends with one confident closer line — no exclamation marks, no marketing
   fluff, no "delivered to your door" e-commerce-speak.

VOICE:
- First-person plural ("we") throughout
- Conversational but tight — a maker telling you straight, not a
  brochure
- AVOID: "we strive", "we believe", "passionate", "luxury", "premium",
  "exclusive", "discover", "explore", "world-class", "state-of-the-art",
  emoji, exclamation marks
- USE: specific equipment names, a year, a place, one stubborn
  craftsmanship principle

OUTPUT: Just the paragraph text. No quotes, no headings, no markdown."""


async def _generate_intro(maker: dict) -> str | None:
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        print(f"  [WARN] emergentintegrations missing ({e})")
        return None

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        print("  [WARN] EMERGENT_LLM_KEY not set")
        return None

    prompt = PROMPT_TEMPLATE.format(
        name=maker.get("name", "—"),
        location=maker.get("location", "—"),
        bio=maker.get("bio", "—"),
        years=maker.get("years_crafting") or "several",
        machinery=", ".join(maker.get("machinery") or []) or "small CNC + hand tools",
        techniques=", ".join(maker.get("techniques") or []) or "—",
    )

    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"workshop-intro-{maker['slug']}-{uuid.uuid4().hex[:8]}",
            system_message=(
                "You write documentary-style 'From the Workshop' intros for "
                "independent makers. First-person plural, specific machinery, "
                "no marketing fluff. 120-180 words. No emoji, no exclamation marks."
            ),
        )
        .with_model("gemini", "gemini-3-flash-preview")
    )

    try:
        text = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        print(f"  [WARN] LLM call failed for {maker['slug']}: {e}")
        return None

    # Light cleanup: strip stray quotes/markdown the model occasionally adds.
    cleaned = (text or "").strip().strip('"').strip("'").strip()
    # Some Gemini outputs prepend "Here's the paragraph:" — strip that.
    for lead in ("Here's the paragraph:", "Here is the paragraph:", "Paragraph:"):
        if cleaned.lower().startswith(lead.lower()):
            cleaned = cleaned[len(lead):].strip()
    return cleaned or None


async def main():
    print(f"\n════ Workshop Intro Generator · {len(TARGET_SLUGS)} makers ════\n")
    for slug in TARGET_SLUGS:
        maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
        if not maker:
            print(f"  ✗ {slug}: not found in DB, skipping")
            continue
        if maker.get("workshop_intro"):
            print(f"  → {slug}: already has intro ({len(maker['workshop_intro'])} chars), skipping")
            continue
        print(f"  · {slug}: generating…")
        intro = await _generate_intro(maker)
        if not intro:
            print(f"  ✗ {slug}: no intro generated")
            continue
        await db.makers.update_one({"slug": slug}, {"$set": {"workshop_intro": intro}})
        word_count = len(intro.split())
        preview = intro[:90] + ("…" if len(intro) > 90 else "")
        print(f"  ✓ {slug}: {word_count} words · {preview}")
    print("\n✓ Done.")


if __name__ == "__main__":
    asyncio.run(main())
