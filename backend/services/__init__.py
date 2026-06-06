"""iter335 — Service-layer modules used by the unified Promote engine.

Routers stay thin; the business logic that talks to multiple
collections (wallets + campaigns + listings + analytics) lives here so
the same primitives can be reused by the daily allocator cron and by
the request handlers.
"""
