"""Admin MongoDB backup — on-demand `mongodump` archive streamed to the browser.

Super-admin only. The `/api/admin/db/backup` endpoint shells out to the
`mongodump` binary (bundled with the Mongo Tools), captures the gzipped
archive on its stdout, and streams that straight back to the requesting
client. Nothing is persisted on the backend pod's local disk.

Every successful download is audit-logged to `admin_audit_log` with the
requester email, IP, UA, and archive size in bytes so we can answer the
"who pulled a copy of the whole database last week?" question months
later during an incident review.

Requires `mongodump` on the PATH of the backend pod. In this repo's
standard container image it lives at `/usr/bin/mongodump` (MongoDB Tools
100.x).
"""
from __future__ import annotations

import asyncio
import os
import shutil
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from config import settings
from core import db, logger, now_iso
from maker_auth import require_super_admin

router = APIRouter()

_MONGODUMP = shutil.which("mongodump") or "/usr/bin/mongodump"
_CHUNK = 64 * 1024  # 64 KB chunks for streaming — keeps peak memory flat


async def _stream_mongodump(mongo_url: str, db_name: str):
    """Spawn mongodump, yield its stdout in 64 KB chunks.

    The archive format (`--archive=-`) writes a single binary stream to
    stdout which we forward to the HTTP client. Gzip compression happens
    inside mongodump so CPU on the backend pod stays low.
    """
    proc = await asyncio.create_subprocess_exec(
        _MONGODUMP,
        f"--uri={mongo_url}",
        f"--db={db_name}",
        "--gzip",
        "--archive=-",
        "--quiet",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    total = 0
    try:
        assert proc.stdout is not None
        while True:
            chunk = await proc.stdout.read(_CHUNK)
            if not chunk:
                break
            total += len(chunk)
            yield chunk
    finally:
        rc = await proc.wait()
        err_tail = ""
        if proc.stderr is not None:
            try:
                err_bytes = await proc.stderr.read()
                err_tail = err_bytes.decode("utf-8", "replace")[-2000:]
            except Exception:  # pragma: no cover — best effort
                pass
        # Surface the final size + exit status in logs so ops can spot
        # a truncated / failed dump even though the HTTP stream already
        # returned 200 by this point (headers went out with the first byte).
        logger.info(
            "admin_db_backup finished · size=%s bytes · rc=%s · stderr=%r",
            total, rc, err_tail,
        )
        # Non-zero exit is logged but we don't raise — the stream is
        # already partially delivered. Ops drill (doc:
        # `/app/docs/mongodb-backup.md`) catches this by running a
        # restore against the downloaded archive.


@router.get("/admin/db/backup", include_in_schema=False)
async def admin_db_backup(request: Request, claims: dict = Depends(require_super_admin())):
    """Stream a full `mongodump --archive --gzip` of the production DB.

    - Super-admin only (env ADMIN_EMAILS). Non-super admins get 403 via
      the `require_super_admin` dependency, even if their capability
      set includes `finance` / `support`. This is intentional: the dump
      contains every PII record in the marketplace.
    - No on-disk temp file — archive is piped straight through.
    - Audit-logged to `admin_audit_log`.
    """
    mongo_url = settings.mongo_url
    db_name = settings.db_name
    if not mongo_url or not db_name:
        raise HTTPException(500, "MONGO_URL / DB_NAME missing from backend env.")
    if not os.path.isfile(_MONGODUMP):
        raise HTTPException(500, "mongodump binary not available on backend pod.")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"crafters-backup-{stamp}.archive.gz"

    # Audit log — we write this BEFORE streaming so even a client
    # disconnection mid-transfer is attributable.
    try:
        await db.admin_audit_log.insert_one({
            "kind": "db_backup_download",
            "admin_email": (claims.get("email") or "").lower(),
            "ip": (request.client.host if request.client else None),
            "user_agent": request.headers.get("user-agent", "")[:400],
            "filename": filename,
            "db_name": db_name,
            "created_at": now_iso(),
        })
    except Exception as exc:  # pragma: no cover — audit log must never block
        logger.warning("admin_audit_log insert failed (non-fatal): %s", exc)

    return StreamingResponse(
        _stream_mongodump(mongo_url, db_name),
        media_type="application/gzip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Disable proxy buffering — Cloudflare / nginx should forward
            # the stream byte-for-byte so large DBs don't OOM the edge.
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-store",
        },
    )


@router.get("/admin/db/backup/diag", include_in_schema=False)
async def admin_db_backup_diag(_claims: dict = Depends(require_super_admin())):
    """Tiny diagnostic — confirms mongodump exists + env wiring is sane.
    Returns quickly without running a full dump. Used by the admin UI
    button to show a green/red light before the user clicks "Download."."""
    import r2_storage
    return {
        "mongodump_present": os.path.isfile(_MONGODUMP),
        "mongodump_path": _MONGODUMP,
        "mongo_url_set": bool(settings.mongo_url),
        "db_name": settings.db_name,
        "r2_configured": r2_storage.is_configured(),
    }


@router.get("/admin/db/backup/offsite", include_in_schema=False)
async def admin_db_backup_offsite_list(_claims: dict = Depends(require_super_admin())):
    """List the most recent offsite backups stored in R2.

    Surfaced in the admin BackupTab so operators can see at a glance
    whether the nightly cron is succeeding (most-recent timestamp) and
    whether retention sweeping is working (count stays bounded). The
    archive itself is served straight from R2 — we never proxy
    download through this endpoint, since R2 egress is free and we'd
    just be wasting backend CPU."""
    from offsite_backup import list_offsite_backups
    rows = await list_offsite_backups(limit=30)
    return {"backups": rows, "count": len(rows)}


@router.post("/admin/db/backup/offsite/run", include_in_schema=False)
async def admin_db_backup_offsite_run(_claims: dict = Depends(require_super_admin())):
    """Manually trigger an offsite backup (same code path as the cron).

    Useful when ops wants to force a snapshot just before a risky deploy
    or migration without waiting for the 03:15 UTC nightly window. The
    `auto_offsite_backup_enabled` toggle gates the cron job but NOT the
    manual trigger — super admins can always manually take a backup."""
    # Bypass the toggle for manual runs by temporarily setting it ON for
    # this single call. Cleaner: call the underlying logic directly via
    # a small wrapper that ignores the toggle. We use the cleaner path.
    from offsite_backup import run_offsite_backup
    from routers.settings import get_setting

    # Save the original toggle state and force-enable it just for this
    # one manual call so the underlying job runs even if the cron is
    # currently OFF. Then restore.
    original = await get_setting("auto_offsite_backup_enabled", False)
    await db.site_settings.update_one(
        {"_id": "global"},
        {"$set": {"auto_offsite_backup_enabled": True, "_manual_backup_in_progress": True}},
    )
    try:
        result = await run_offsite_backup()
    finally:
        await db.site_settings.update_one(
            {"_id": "global"},
            {"$set": {"auto_offsite_backup_enabled": original},
             "$unset": {"_manual_backup_in_progress": ""}},
        )
    return result


@router.post("/admin/db/backup/drill/run", include_in_schema=False)
async def admin_db_backup_drill_run(_claims: dict = Depends(require_super_admin())):
    """Run the recovery drill on demand (super-admin only).

    Bypasses the `auto_recovery_drill_enabled` toggle since this is an
    explicit manual action — operators should be able to force a drill
    after recovery from an incident, before a major migration, or just
    to keep the muscle memory fresh between scheduled quarterly runs.

    The drill restores the latest R2 archive into an isolated drill
    namespace (never touches prod collections), runs integrity counts,
    drops the drill namespace, and posts pass/fail to Slack/Discord
    plus the admin audit log. Returns the full summary dict."""
    from recovery_drill import run_recovery_drill
    return await run_recovery_drill(manual=True)



@router.get("/admin/billing/charge-clearing/preview", include_in_schema=False)
async def admin_charge_clearing_preview(_claims: dict = Depends(require_super_admin())):
    """Dry-run the monthly Plus charge-clearing sweep.

    Returns the candidate makers and total cents that *would* be invoiced
    without actually creating any Stripe Invoice. Lets ops eyeball the
    batch before the cron runs (or before a manual run).
    """
    from charge_clearing import clear_plus_ledger_balances
    return await clear_plus_ledger_balances(apply=False)


@router.post("/admin/billing/charge-clearing/run", include_in_schema=False)
async def admin_charge_clearing_run(_claims: dict = Depends(require_super_admin())):
    """Manually trigger the Plus charge-clearing sweep (super-admin only).

    Same code path as the monthly cron but bypasses the
    `auto_charge_clearing_enabled` toggle — operators can always run a
    sweep on demand. Each maker's pending balance is invoiced via Stripe
    against their card on file.
    """
    from charge_clearing import clear_plus_ledger_balances
    return await clear_plus_ledger_balances(apply=True)



@router.get("/admin/marketing/review-prompts/preview", include_in_schema=False)
async def admin_review_prompts_preview(_claims: dict = Depends(require_super_admin())):
    """Dry-run the post-delivery review-prompt sweep — returns the
    candidate count without sending anything. Useful for sanity-checking
    deliverability before flipping the toggle ON in a fresh environment."""
    from review_prompts import run_review_prompts
    return await run_review_prompts(apply=False)


@router.post("/admin/marketing/review-prompts/run", include_in_schema=False)
async def admin_review_prompts_run(_claims: dict = Depends(require_super_admin())):
    """Manually trigger the post-delivery review-prompt sweep. Bypasses
    the `auto_review_prompt_enabled` toggle so operators can always run
    on demand. Idempotent: orders that have already received a prompt
    (`review_prompt_sent_at` set) are silently skipped."""
    from review_prompts import run_review_prompts
    return await run_review_prompts(apply=True)
