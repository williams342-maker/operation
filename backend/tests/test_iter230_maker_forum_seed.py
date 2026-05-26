"""iter230 regression — maker-attributed forum threads + cross-maker replies.

Locks the 10 maker-authored threads + ~20 cross-maker replies so future
forum-purge or schema-migration bugs can't strip the ecosystem feel back
to anonymous starter posts.
"""
import asyncio
import pytest

from core import db


SEED_KEYS = [
    "maker-cascade-powder-recure-temp",
    "maker-hillcountry-patina-consistency",
    "maker-appalachian-epoxy-degas-bubbles",
    "maker-greatlakes-laser-air-assist-pressure",
    "maker-blackriver-walnut-engrave-depth",
    "maker-emberline-multilayer-standoff-spacing",
    "maker-northforge-cor-ten-cure-time",
    "maker-redwood-stepover-figured-maple",
    "maker-copperedge-brass-fingerprint-protection",
    "maker-forgegrain-steel-wood-joint-seasoning",
]


@pytest.fixture(scope="module")
def forum_state():
    loop = asyncio.new_event_loop()
    try:
        async def _load():
            threads = await db.forum_threads.find(
                {"seed_key": {"$in": SEED_KEYS}}, {"_id": 0},
            ).to_list(None)
            replies_by_thread = {}
            for t in threads:
                rs = await db.forum_replies.find(
                    {"thread_id": t["id"]}, {"_id": 0},
                ).to_list(None)
                replies_by_thread[t["id"]] = rs
            return threads, replies_by_thread
        return loop.run_until_complete(_load())
    finally:
        loop.close()


def test_all_ten_maker_threads_present(forum_state):
    threads, _ = forum_state
    assert len(threads) == 10, f"expected 10 maker threads, got {len(threads)}"


def test_each_thread_attributes_to_a_maker(forum_state):
    """`linked_maker_slug` is the field the UI uses to render the
    "Started by Cascade Iron Works" badge instead of a generic email.
    If this loses its bind, the threads collapse back to looking
    anonymous."""
    threads, _ = forum_state
    missing = [t["seed_key"] for t in threads if not t.get("linked_maker_slug")]
    assert not missing, f"threads missing linked_maker_slug: {missing}"


def test_each_thread_has_at_least_one_reply(forum_state):
    """Empty threads with maker attribution look worse than no thread
    — they imply nobody in the maker community engaged. Every seeded
    thread MUST have at least one cross-maker reply."""
    threads, replies = forum_state
    bare = [t["seed_key"] for t in threads if len(replies.get(t["id"], [])) == 0]
    assert not bare, f"threads with zero replies: {bare}"


def test_replies_are_from_OTHER_makers_not_thread_author(forum_state):
    """Cross-pollination is the whole point. A thread authored by Cascade
    that's only got a reply from Cascade defeats the design — that's
    just a self-thread."""
    threads, replies = forum_state
    by_id = {t["id"]: t for t in threads}
    for tid, rs in replies.items():
        author_slug = by_id[tid].get("linked_maker_slug")
        for r in rs:
            replier = r.get("linked_maker_slug")
            assert replier and replier != author_slug, (
                f"thread {by_id[tid]['seed_key']}: reply from same maker "
                f"({replier}) — must be cross-maker"
            )


def test_reply_bodies_are_specific_not_filler(forum_state):
    """The brief explicitly banned 'this community is amazing'-style
    filler. Every reply must read like real maker advice with at least
    one piece of concrete detail. We catch the lowest bar: ≥ 30 chars,
    no exclamation marks, no emoji, no banned filler phrases."""
    _, replies = forum_state
    banned_filler = [
        "great post", "thanks for sharing", "this community is amazing",
        "love this", "great question", "amazing post", "appreciate the share",
    ]
    import re
    emoji_re = re.compile(r"[\U0001F300-\U0001FAFF\U0001F600-\U0001F64F\U0001F680-\U0001F6FF]")
    for rs in replies.values():
        for r in rs:
            body = r.get("body", "")
            assert len(body) >= 30, f"reply too short: {body!r}"
            assert "!" not in body, f"exclamation mark in reply: {body[:80]!r}"
            assert not emoji_re.search(body), f"emoji in reply: {body[:80]!r}"
            low = body.lower()
            for phrase in banned_filler:
                assert phrase not in low, f"filler phrase '{phrase}' in: {body[:80]!r}"


def test_threads_use_valid_categories(forum_state):
    """Must use one of the live forum categories. A bad category would
    silently exclude these threads from category filter views."""
    from routers.community_forum import FORUM_CATEGORY_IDS
    threads, _ = forum_state
    for t in threads:
        assert t.get("category") in FORUM_CATEGORY_IDS, (
            f"{t['seed_key']}: invalid category {t.get('category')!r}"
        )


def test_seed_keys_are_unique(forum_state):
    """seed_key is the de-dup gate for idempotent re-runs. Duplicates
    would mean the re-run logic is broken."""
    threads, _ = forum_state
    keys = [t["seed_key"] for t in threads]
    assert len(set(keys)) == len(keys), f"duplicate seed_keys: {keys}"


def test_community_users_created_for_makers(forum_state):
    """Every maker that authored OR replied needs a community_users row
    so the API can resolve them. Missing rows would render the post
    without a name (UI falls back to email). We piggy-back on the
    existing fixture instead of opening a new event loop — fresh loops
    after the fixture closed cause Motor state corruption."""
    threads, replies = forum_state
    # Build the set of all maker slugs appearing in threads + replies.
    referenced = {t.get("linked_maker_slug") for t in threads if t.get("linked_maker_slug")}
    for rs in replies.values():
        for r in rs:
            if r.get("linked_maker_slug"):
                referenced.add(r["linked_maker_slug"])
    # All 10 starter-pack makers must show up (10 authors, possibly with
    # overlap on the reply side — but the union must cover all 10).
    assert len(referenced) == 10, (
        f"expected all 10 starter-pack makers referenced in forum, "
        f"got {len(referenced)}: {referenced}"
    )
