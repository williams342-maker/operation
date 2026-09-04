"""_LoopAwareMotor must CLOSE the clients it discards, not just drop them.

core.py keeps one AsyncIOMotorClient per living event loop and prunes the
entries whose loop has closed. Pruning used to `pop()` the entry and stop
there, on the reasoning recorded in the comment that a closed loop's "sockets
are dead". They are not: pymongo owns real TCP connections and background
monitor threads that outlive the loop entirely, so a pruned-but-unclosed
client kept both for the life of the process.

Production never reaches that branch — one uvicorn loop means one client. A
full pytest session reaches it constantly, because every asyncio.run() and
every pytest-asyncio loop mints another client, and across ~2900 tests the
discarded ones accumulated.

These assertions deliberately do not import motor or reach MongoDB. The
invariant under test is about lifecycle bookkeeping, so a stub client that
records close() proves it directly and runs anywhere.
"""
import asyncio

import core


class _StubClient:
    """Stands in for AsyncIOMotorClient; records whether it was closed."""

    def __init__(self, url):
        self.url = url
        self.closed = False

    def close(self):
        self.closed = True


def _clients_across_loops(count):
    mgr = core._LoopAwareMotor("mongodb://stub-not-contacted")

    async def grab():
        return mgr.current()

    # Each asyncio.run() builds a loop, uses it, and closes it, so every client
    # but the last belongs to a loop that is closed by the time we finish.
    return mgr, [asyncio.run(grab()) for _ in range(count)]


def test_discarded_clients_are_closed(monkeypatch):
    monkeypatch.setattr(core, "AsyncIOMotorClient", _StubClient)
    _, created = _clients_across_loops(4)

    leaked = [c for c in created[:-1] if not c.closed]
    assert not leaked, (
        f"{len(leaked)} of {len(created) - 1} discarded clients were never closed; "
        "each keeps its connection pool and monitor threads alive"
    )


def test_the_live_client_is_not_closed(monkeypatch):
    # The counterpart assertion: over-eager closing would break the caller that
    # is still holding the client, which is worse than the leak.
    monkeypatch.setattr(core, "AsyncIOMotorClient", _StubClient)
    _, created = _clients_across_loops(4)
    assert not created[-1].closed, "the most recent client must stay usable"


def test_the_registry_stays_bounded(monkeypatch):
    monkeypatch.setattr(core, "AsyncIOMotorClient", _StubClient)
    mgr, _ = _clients_across_loops(8)
    assert len(mgr._clients) <= 2, (
        f"registry holds {len(mgr._clients)} entries after 8 loops; "
        "closed loops must be pruned rather than accumulated"
    )


def test_close_all_closes_everything_and_empties(monkeypatch):
    monkeypatch.setattr(core, "AsyncIOMotorClient", _StubClient)
    mgr, created = _clients_across_loops(3)
    mgr.close_all()
    assert all(c.closed for c in created), "close_all must close every client"
    assert not mgr._clients, "close_all must empty the registry"
