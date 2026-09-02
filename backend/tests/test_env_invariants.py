"""The tests and the API server must agree on which database they mean.

They are separate processes and they agree only by both reading DB_NAME. When
they stop agreeing, nothing says so. The tests write to one database and read it
back successfully; the server reads another and correctly reports the row
missing; and the symptom is a bare 404 from POST /api/maker/auth/verify with no
database named anywhere in it.

That cost five modules, thirteen tests, and seven wrong hypotheses before anyone
printed the value. The measured drift was:

    DB_NAME at conftest import : 'backend_ci_test'   (what CI sets, what the server uses)
    DB_NAME at test time       : 'test_database'     (what the tests actually used)

32 test modules call os.environ.setdefault("DB_NAME", "test_database") at module
level. setdefault is meant to yield to a configured value and normally does; in
CI it demonstrably did not. What clears DB_NAME during collection is not yet
known, so this asserts the INVARIANT rather than the explanation - it holds
whatever the mechanism turns out to be.

Deliberately a test rather than a collection hook. The first version raised
pytest.UsageError from pytest_collection_finish, which aborted the entire
session: 1 test collected instead of 2,939. A correctness problem affecting
thirteen tests should not cost the other 2,926 their run.

The startup snapshot arrives through the `env_at_startup` fixture rather than an
import. `from conftest import ...` loads conftest a SECOND time as a top-level
module, separate from the one pytest already holds, re-running its module-level
code - which is a side effect a test asserting an invariant has no business
causing.
"""
from __future__ import annotations

import os


def test_db_name_is_the_one_the_server_was_started_with(env_at_startup):
    started = env_at_startup.get("DB_NAME")
    now = os.environ.get("DB_NAME")
    assert now == started, (
        "DB_NAME changed while test modules were imported: {!r} -> {!r}. "
        "The API server still uses {!r}, so any test seeding through its own "
        "AsyncIOMotorClient writes where the server does not read: the write "
        "succeeds, the read-back succeeds, and the endpoint returns 404. "
        "Find the module that rebound it. Do not relax this assertion."
        .format(started, now, started)
    )


def test_mongo_url_is_unchanged_too(env_at_startup):
    # Same class of failure, same silence. Cheap to assert while we are here.
    started = env_at_startup.get("MONGO_URL")
    if not started:
        return  # nothing configured to drift from
    assert os.environ.get("MONGO_URL") == started, (
        "MONGO_URL changed while test modules were imported: {!r} -> {!r}"
        .format(started, os.environ.get("MONGO_URL"))
    )
