"""Scheduled offsite MongoDB backups.

Runs `mongodump --archive --gzip` and uploads the resulting binary
archive to a private R2 bucket prefix (`backups/`). Old archives older
than `BACKUP_RETENTION_DAYS` are swept on the same job — no separate
cron needed.

Why R2 specifically:
  • R2 egress is free, so restoring large archives doesn't cost.
  • We already have R2 wired (ASSETS bucket). Reuse the same boto3
    client + creds, just point at the same bucket with a private prefix.
  • S3-compatible API means switching to AWS S3 / Backblaze later is a
    one-line endpoint change.

Toggle: `auto_offsite_backup_enabled` in `site_settings`. Default OFF.
Operator must explicitly opt in via the admin Settings tab. When OFF
the scheduled job is a no-op so flipping the switch doesn't require a
redeploy.

Cadence: nightly at 03:15 UTC (low-traffic window for the marketplace).
"""
from __future__ import annotations

import asyncio
import io
import os
import shutil
from datetime import datetime, timezone, timedelta

from core import db, logger, now_iso
import r2_storage

_MONGODUMP = shutil.which("mongodump") or "/usr/bin/mongodump"
BACKUP_PREFIX = "backups/mongo/"           # never collides with user assets
DEFAULT_RETENTION_DAYS = 30
DEFAULT_MAX_BYTES = 5 * 1024 * 1024 * 1024  # 5 GB ceiling — bail before OOM


async def _spawn_mongodump_to_buffer(mongo_url: str, db_name: str, max_bytes: int) -> bytes:
    """Run mongodump and capture its full stdout in memory.

    For Crafters Market's current size (<200 MB compressed) the in-memory
    buffer is fine. If the archive ever exceeds `max_bytes` we abort
    before the buffer fills and surface a clear error in the audit log
    so ops can switch to streaming-multipart upload (TODO if it ever
    becomes a problem).
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
    chunks: list[bytes] = []
    total = 0
    assert proc.stdout is not None
    while True:
        chunk = await proc.stdout.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            proc.kill()
            raise RuntimeError(
                f"backup exceeds in-memory cap ({max_bytes} bytes); "
                "switch to streaming-multipart upload."
            )
        chunks.append(chunk)
    rc = await proc.wait()
    err_tail = ""
    if proc.stderr is not None:
        try:
            err_bytes = await proc.stderr.read()
            err_tail = err_bytes.decode("utf-8", "replace")[-500:]
        except Exception:
            pass
    if rc != 0:
        raise RuntimeError(f"mongodump exit {rc}: {err_tail}")
    return b"".join(chunks)


async def run_offsite_backup() -> dict:
    """Scheduler entrypoint. Returns a summary dict the cron logs."""
    from routers.settings import get_setting

    if not await get_setting("auto_offsite_backup_enabled", False):
        return {"ran": False, "reason": "toggle_off"}

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        return {"ran": False, "reason": "missing_env"}
    if not r2_storage.is_configured():
        return {"ran": False, "reason": "r2_not_configured"}
    if not os.path.isfile(_MONGODUMP):
        return {"ran": False, "reason": "mongodump_missing"}

    started = datetime.now(timezone.utc)
    stamp = started.strftime("%Y%m%d-%H%M%S")
    key = f"{BACKUP_PREFIX}crafters-{db_name}-{stamp}.archive.gz"

    try:
        # 1) Generate the dump in memory.
        archive = await _spawn_mongodump_to_buffer(mongo_url, db_name, DEFAULT_MAX_BYTES)
        size = len(archive)

        # 2) Upload to R2. We bypass `r2_storage.upload_bytes` because
        # that helper enforces the 8 MB image cap; backups use the raw
        # boto3 client instead, with a Backup-specific cache header
        # (private, no public read — backups never leave the bucket).
        cli = r2_storage.client()
        # Use put_object so we can set custom metadata + ACL bits in one
        # call. Wrapping bytes in a BytesIO keeps boto3 happy with
        # streaming reads and means we don't have to load the buffer
        # twice.
        cli.put_object(
            Bucket=r2_storage.R2_BUCKET,
            Key=key,
            Body=io.BytesIO(archive),
            ContentType="application/gzip",
            ContentLength=size,
            CacheControl="private, no-store",
            Metadata={
                "db_name": db_name,
                "size_bytes": str(size),
                "created_at": now_iso(),
                "source": "scheduler.offsite_backup",
            },
        )

        # 3) Sweep old archives — anything older than retention is
        # deleted in the same run so we never accumulate cruft.
        retention_days = int(await get_setting(
            "auto_offsite_backup_retention_days", DEFAULT_RETENTION_DAYS,
        ) or DEFAULT_RETENTION_DAYS)
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        deleted: list[str] = []
        try:
            paginator = cli.get_paginator("list_objects_v2")
            for page in paginator.paginate(
                Bucket=r2_storage.R2_BUCKET, Prefix=BACKUP_PREFIX,
            ):
                for obj in page.get("Contents", []) or []:
                    last_mod = obj.get("LastModified")
                    if not last_mod:
                        continue
                    if last_mod.tzinfo is None:
                        last_mod = last_mod.replace(tzinfo=timezone.utc)
                    if last_mod < cutoff and obj["Key"] != key:
                        cli.delete_object(Bucket=r2_storage.R2_BUCKET, Key=obj["Key"])
                        deleted.append(obj["Key"])
        except Exception as e:
            # Sweep failures are non-fatal — the new archive is already
            # uploaded. Just log so ops can check next time.
            logger.warning("[offsite_backup] retention sweep failed: %s", e)

        # 4) Audit log row — successful run.
        duration_s = (datetime.now(timezone.utc) - started).total_seconds()
        summary = {
            "ran": True, "ok": True, "key": key, "size_bytes": size,
            "size_mb": round(size / 1024 / 1024, 2),
            "duration_s": round(duration_s, 2),
            "retention_days": retention_days,
            "deleted_keys": deleted,
        }
        await db.admin_audit_log.insert_one({
            "kind": "offsite_backup_run",
            **summary,
            "created_at": now_iso(),
        })
        logger.info("[offsite_backup] %s", summary)
        return summary

    except Exception as e:
        logger.exception("[offsite_backup] failed: %s", e)
        try:
            await db.admin_audit_log.insert_one({
                "kind": "offsite_backup_failed",
                "error": str(e)[:500],
                "created_at": now_iso(),
            })
        except Exception:
            pass
        return {"ran": True, "ok": False, "error": str(e)[:500]}


async def list_offsite_backups(limit: int = 30) -> list[dict]:
    """Read-only inventory of what's currently in R2 under the backup
    prefix. Used by the admin BackupTab to show recent successful runs
    without paging through audit logs.

    Returns rows with `key`, `size_bytes`, `size_mb`, `created_at`. R2
    doesn't preserve `Metadata` on `list_objects_v2` so we use the
    object's `LastModified` as the truthful created-at (which is also
    what shows up in the R2 dashboard).
    """
    if not r2_storage.is_configured():
        return []
    try:
        cli = r2_storage.client()
        out: list[dict] = []
        paginator = cli.get_paginator("list_objects_v2")
        for page in paginator.paginate(
            Bucket=r2_storage.R2_BUCKET, Prefix=BACKUP_PREFIX,
            PaginationConfig={"MaxItems": limit * 2},
        ):
            for obj in page.get("Contents", []) or []:
                size = int(obj.get("Size", 0))
                last_mod = obj.get("LastModified")
                if last_mod and last_mod.tzinfo is None:
                    last_mod = last_mod.replace(tzinfo=timezone.utc)
                out.append({
                    "key": obj["Key"],
                    "size_bytes": size,
                    "size_mb": round(size / 1024 / 1024, 2),
                    "created_at": last_mod.isoformat() if last_mod else None,
                })
        out.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return out[:limit]
    except Exception as e:
        logger.warning("[offsite_backup] list failed: %s", e)
        return []
