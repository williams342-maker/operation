"""Admin trigger for the weekly Shop Health digest (iter367).

POST /api/admin/digest/shop-health/run  { force?: bool, dry_run?: bool }
  → run summary (dry_run includes a per-maker preview without sending).

The cron itself lives in scheduler.py (Sundays 09:00 UTC); this endpoint
exists for manual kicks + verification after deploys.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from maker_auth import current_admin

router = APIRouter()


class DigestRunRequest(BaseModel):
    force: bool = False
    dry_run: bool = True


@router.post("/admin/digest/shop-health/run")
async def run_shop_health_digest(
    body: DigestRunRequest, _admin=Depends(current_admin),
) -> dict:
    from shop_health_digest import run_weekly_shop_health_digest
    return await run_weekly_shop_health_digest(
        force=body.force, dry_run=body.dry_run, trigger="admin",
    )
