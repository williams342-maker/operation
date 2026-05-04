# MongoDB Backup & Restore — Crafters Market

Production ops doc. Two paths to get a full snapshot of the database:

1. **Self-serve admin export** (fastest, no shell access needed) — new
   `GET /api/admin/db/backup` endpoint streams a `mongodump`-equivalent
   archive.
2. **Shell `mongodump`** — if you have SSH into the production pod or are
   running local backup jobs against the replica set.

Both produce an archive that can be restored into any MongoDB with the
standard `mongorestore` tool.

---

## 1) Self-serve — `/api/admin/db/backup`

**Endpoint:** `GET /api/admin/db/backup`
**Auth:** Super-admin JWT only (`Authorization: Bearer <token>`)
**Response:** `application/gzip` streaming download
**Filename:** `crafters-backup-YYYYMMDD-HHMMSS.archive.gz`

The endpoint shells out to the `mongodump` binary (bundled with the Mongo
toolset in the pod) and streams the result straight to your browser. Nothing
is persisted on the backend pod's local disk.

### Curl (download from your laptop)

```bash
TOKEN="$(cat ~/.crafters-admin-token)"
API_URL="https://craftersmarket.org"

curl -L -o "crafters-backup-$(date +%Y%m%d).archive.gz" \
  -H "Authorization: Bearer ${TOKEN}" \
  "${API_URL}/api/admin/db/backup"
```

### Admin UI button

The **Settings → Backup** admin tab has a "Download full backup" button
that triggers the same endpoint and saves the file to your browser's
Downloads folder. Wire instructions for button usage are listed in the
admin tab itself.

### What's in the archive

Every collection in the `DB_NAME` database (see `backend/.env`), in
`mongodump` binary format — not a CSV / JSON dump. That's deliberate:

- Full fidelity for all types (ObjectId, Date, Binary, Decimal128)
- Restoreable back into any MongoDB with one command
- Compressed on-the-fly (gzip) so the transfer is small
- Indexes + index-build metadata are included

### Restoring

```bash
mongorestore \
  --uri "mongodb://user:pass@host:27017" \
  --nsInclude "craftersmarket.*" \
  --gzip \
  --archive=crafters-backup-20260501.archive.gz
```

For a fresh database:

```bash
mongorestore \
  --uri "mongodb://localhost:27017" \
  --drop \
  --gzip \
  --archive=crafters-backup-20260501.archive.gz
```

Replace `craftersmarket` with whatever `DB_NAME` you want in the target
environment (the archive is namespace-agnostic; `--nsFrom` / `--nsTo`
flags can remap during restore).

---

## 2) Shell `mongodump` (for cron jobs / disaster recovery)

If you're running a cron on a separate box and want to pull a backup
directly, the production `MONGO_URL` from `backend/.env` is the source of
truth. **Do not commit it anywhere.**

```bash
#!/usr/bin/env bash
set -euo pipefail

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="/var/backups/crafters/crafters-${STAMP}.archive.gz"

mkdir -p "$(dirname "$OUT")"

mongodump \
  --uri "$MONGO_URL" \
  --gzip \
  --archive="$OUT"

# Retain 30 days, delete older
find /var/backups/crafters -type f -name '*.archive.gz' -mtime +30 -delete

# Optional — rsync / aws s3 cp the fresh archive off-box for true redundancy
# aws s3 cp "$OUT" s3://crafters-backups/ --sse AES256
```

### Recommended cron

```
# Nightly at 03:15 UTC
15 3 * * *  /opt/crafters/bin/mongodump-nightly.sh >> /var/log/crafters-backup.log 2>&1
```

---

## Recovery drill

Quarterly, spin up a throwaway MongoDB container and restore the most
recent archive into it to confirm backups are actually usable. A backup
you can't restore isn't a backup.

```bash
docker run --rm -d --name mongo-drill -p 27099:27017 mongo:7
mongorestore --uri "mongodb://localhost:27099" --gzip \
  --archive=crafters-backup-latest.archive.gz
mongosh --port 27099 --eval "db.getSiblingDB('craftersmarket').products.countDocuments()"
docker rm -f mongo-drill
```

If the product count matches the production number within a reasonable
delta, the restore path works.

---

## Security notes

- The `/api/admin/db/backup` endpoint is **super-admin only** (env
  `ADMIN_EMAILS`). Non-super admins get a 403 even if their capability
  set includes `finance` or `support`. The backup contains every PII
  record in the database — it's not a normal admin action.
- Every download is **audit-logged** to `admin_audit_log` with the
  requester email, IP, UA, and archive size in bytes.
- The archive is streamed, never persisted on the backend pod's disk, so
  a pod compromise doesn't leak stored backups.
- Archives downloaded to laptops should be **encrypted at rest** (e.g.,
  FileVault / BitLocker / LUKS) and deleted after the restore drill is
  done. Don't leave them in `~/Downloads`.
