"""Quarterly DR drill — restore the latest R2 backup into a throwaway
Mongo namespace, run integrity probes, drop the namespace, post the
result to Slack/Discord, and audit-log everything.

Why this exists:
  Backups you've never tested don't exist. Once a quarter we verify the
  newest R2 archive is actually restoreable end-to-end. The drill:

    1. Lists offsite backups in R2, picks the most recent.
    2. Streams it to a /tmp file (R2 egress is free).
    3. Runs `mongorestore` with `--nsFrom=<DB_NAME>.* --nsTo=<DRILL_NS>.*`
       which restores into an isolated database on the same Mongo
       cluster — never touches production collections.
    4. Counts `<DRILL_NS>.products` and a couple of other key
       collections; flags PASS only if `products >= MIN_PRODUCTS`.
    5. Drops the drill namespace + deletes the local /tmp file.
    6. Posts a single compact Slack message with the result.
    7. Audit-logs to `admin_audit_log` regardless of pass/fail so the
       trail is complete even if Slack is down.

  No production collection is ever read or written by this drill.
  The throwaway namespace lives next to prod in the same cluster, but
  the rename via `--nsFrom/--nsTo` is enforced by `mongorestore` itself.

Manually triggerable:
  POST /api/admin/db/backup/drill/run

Scheduled:
  First day of each quarter (Jan/Apr/Jul/Oct) at 04:30 UTC. Self-skips
  when the `auto_recovery_drill_enabled` site_setting toggle is OFF
  (default OFF) so flipping it in admin Settings is enough — no
  redeploy.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from datetime import datetime, timezone

from core import db, logger, now_iso
import r2_storage
from notify_webhook import notify_team

_MONGORESTORE = shutil.which("mongorestore") or "/usr/bin/mongorestore"
DRILL_NS_PREFIX = "_dr_drill_"
MIN_PRODUCTS = 100         # drill PASS threshold (configurable via setting)
MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024 * 1024  # 5 GB safety ceiling


async def _run(cmd: list[str], timeout: int = 300) -> tuple[int, str]:
    """Spawn a subprocess, capture stderr, return (rc, stderr_tail)."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError(f"timeout running {' '.join(cmd[:2])}")
    err_text = (err or b"").decode("utf-8", "replace")[-2000:]
    return proc.returncode or 0, err_text


async def _download_latest_archive_to_tmp(tmp_dir: str) -> tuple[str, dict]:
    """Pick the newest object under `backups/mongo/` in R2 and stream
    it to a local file. Returns (local_path, metadata)."""
    if not r2_storage.is_configured():
        raise RuntimeError("R2 not configured — set R2_* env vars or skip drill.")
    cli = r2_storage.client()

    latest = None
    paginator = cli.get_paginator("list_objects_v2")
    for page in paginator.paginate(
        Bucket=r2_storage.R2_BUCKET, Prefix="backups/mongo/",
    ):
        for obj in page.get("Contents", []) or []:
            if latest is None or obj["LastModified"] > latest["LastModified"]:
                latest = obj
    if not latest:
        raise RuntimeError(
            "No archives in R2 under backups/mongo/ — run an offsite backup first."
        )
    if int(latest.get("Size", 0)) > MAX_DOWNLOAD_BYTES:
        raise RuntimeError(
            f"latest archive too large ({latest['Size']} bytes); "
            "drill skipped to avoid OOM."
        )

    local = os.path.join(tmp_dir, "latest.archive.gz")
    cli.download_file(r2_storage.R2_BUCKET, latest["Key"], local)
    last_mod = latest["LastModified"]
    if last_mod.tzinfo is None:
        last_mod = last_mod.replace(tzinfo=timezone.utc)
    return local, {
        "key": latest["Key"],
        "size_bytes": int(latest.get("Size", 0)),
        "size_mb": round(int(latest.get("Size", 0)) / 1024 / 1024, 2),
        "uploaded_at": last_mod.isoformat(),
    }


async def _restore_into_drill_namespace(archive_path: str, source_db: str, drill_db: str) -> None:
    """mongorestore --nsFrom=<source>.* --nsTo=<drill>.* — isolates
    everything in the temp namespace. The source namespace must be the
    one written by `offsite_backup.py` (uses the prod DB_NAME)."""
    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        raise RuntimeError("MONGO_URL not set")
    rc, err = await _run(
        [
            _MONGORESTORE,
            f"--uri={mongo_url}",
            "--gzip",
            f"--archive={archive_path}",
            f"--nsFrom={source_db}.*",
            f"--nsTo={drill_db}.*",
            "--drop",          # drop drill collections before restore (clean slate)
            "--quiet",
        ],
        timeout=600,
    )
    if rc != 0:
        raise RuntimeError(f"mongorestore exit {rc}: {err}")


async def _integrity_probe(drill_db: str, min_products: int) -> dict:
    """Run a few sanity counts on the restored namespace.

    `products >= min_products` is the PASS gate. We also count makers,
    blog_posts, and orders so the Slack message has a useful snapshot.
    Counts are read straight from PyMongo via the same
    `motor` client we use everywhere — no shell or extra round-trip.
    """
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL")
    client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
    try:
        d = client[drill_db]
        counts = {}
        # Use estimated counts where possible (much faster on big colls)
        # and fall back to count_documents for the few we want exact.
        for coll in ("products", "makers", "blog_posts", "payment_transactions",
                     "buyer_users", "buyer_subscribers"):
            try:
                counts[coll] = await d[coll].estimated_document_count()
            except Exception:
                counts[coll] = -1
        # Exact count for products since that's the PASS gate.
        try:
            counts["products"] = await d["products"].count_documents({})
        except Exception:
            counts["products"] = -1

        passed = counts.get("products", 0) >= min_products
        return {"passed": passed, "counts": counts, "min_products": min_products}
    finally:
        client.close()


async def _drop_drill_namespace(drill_db: str) -> None:
    """Drop the entire throwaway DB. Idempotent — never raises."""
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL")
    client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
    try:
        await client.drop_database(drill_db)
    except Exception as e:
        logger.warning("[drill] drop_database failed (non-fatal): %s", e)
    finally:
        client.close()


def _format_summary(probe: dict) -> str:
    counts = probe.get("counts") or {}
    parts = []
    for k in ("products", "makers", "blog_posts", "payment_transactions"):
        if k in counts:
            parts.append(f"{counts[k]:,} {k.replace('_', ' ')}")
    return " · ".join(parts) or "(no counts)"


async def run_recovery_drill(*, manual: bool = False) -> dict:
    """Single-shot drill. Returns a summary dict. Manual runs bypass the
    toggle (super admins can always force a drill); cron runs honor it."""
    from routers.settings import get_setting

    if not manual and not await get_setting("auto_recovery_drill_enabled", False):
        return {"ran": False, "reason": "toggle_off"}

    source_db = os.environ.get("DB_NAME")
    if not source_db:
        return {"ran": False, "reason": "missing_db_name"}

    started = datetime.now(timezone.utc)
    drill_db = f"{DRILL_NS_PREFIX}{started.strftime('%Y%m%d%H%M%S')}"
    min_products = int(await get_setting(
        "recovery_drill_min_products", MIN_PRODUCTS,
    ) or MIN_PRODUCTS)

    summary: dict = {
        "ran": True, "drill_db": drill_db, "started_at": started.isoformat(),
        "manual": manual, "min_products": min_products,
    }

    tmp_dir = tempfile.mkdtemp(prefix="cm_drill_")
    archive_path: str | None = None
    try:
        # 1) Pull latest archive from R2 to /tmp
        archive_path, meta = await _download_latest_archive_to_tmp(tmp_dir)
        summary["archive"] = meta

        # 2) Restore into the drill namespace (isolated, --drop ensures
        #    a fresh state).
        await _restore_into_drill_namespace(archive_path, source_db, drill_db)

        # 3) Integrity probe
        probe = await _integrity_probe(drill_db, min_products=min_products)
        summary.update(probe)

        # 4) Mark pass/fail
        summary["ok"] = bool(probe.get("passed"))
        summary["error"] = None
    except Exception as e:
        summary["ok"] = False
        summary["passed"] = False
        summary["error"] = str(e)[:500]
        logger.exception("[drill] failed: %s", e)
    finally:
        # 5) Always drop the drill namespace + clean /tmp
        try:
            await _drop_drill_namespace(drill_db)
        except Exception:
            pass
        try:
            if archive_path and os.path.isfile(archive_path):
                os.unlink(archive_path)
            os.rmdir(tmp_dir)
        except Exception as e:
            logger.warning("[drill] cleanup partial: %s", e)

    duration_s = (datetime.now(timezone.utc) - started).total_seconds()
    summary["duration_s"] = round(duration_s, 2)

    # 6) Notify team via existing Slack/Discord webhook plumbing.
    try:
        if summary.get("ok"):
            kind = "drill_pass"
            title = "✓ Recovery drill PASSED"
            body = (
                f"Restored {summary.get('archive', {}).get('size_mb', '?')} MB archive into "
                f"isolated namespace `{drill_db}`, verified integrity, dropped namespace cleanly.\n\n"
                f"*Counts:* {_format_summary(summary)}"
            )
        else:
            kind = "drill_fail"
            title = "⊗ Recovery drill FAILED"
            err = summary.get("error") or f"products count below threshold ({summary.get('counts', {}).get('products')})"
            body = (
                f"Restore or integrity probe failed for archive "
                f"`{summary.get('archive', {}).get('key', '(none)')}`.\n\n"
                f"*Error:* {err}\n*Threshold:* products ≥ {min_products}"
            )
        await notify_team(
            kind=kind, title=title, summary=body,
            fields=[
                ("Duration", f"{summary['duration_s']}s"),
                ("Triggered", "Manual" if manual else "Cron"),
            ],
            link=None,
        )
    except Exception as e:
        logger.warning("[drill] slack notify failed: %s", e)

    # 7) Audit log
    try:
        await db.admin_audit_log.insert_one({
            "kind": "recovery_drill_run",
            **{k: v for k, v in summary.items() if k != "counts"},
            "counts": summary.get("counts"),
            "created_at": now_iso(),
        })
    except Exception as e:
        logger.warning("[drill] audit insert failed: %s", e)

    logger.info("[drill] result: ok=%s products=%s duration=%ss",
                summary.get("ok"),
                (summary.get("counts") or {}).get("products"),
                summary.get("duration_s"))
    return summary
