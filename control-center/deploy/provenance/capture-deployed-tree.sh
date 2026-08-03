#!/usr/bin/env bash
# capture-deployed-tree.sh — READ-ONLY provenance capture of the running production deployment.
#
# WHAT IT DOES (and does NOT do):
#   * Reads the deployed application tree by COPYING it OUT of the running container/host.
#     It NEVER writes to, execs into, restarts, or reconfigures the running application.
#   * Records the self-declared release identity (version/commit/branch) — identity strings only.
#   * Prunes secrets, runtime data, logs, caches, dependencies, and generated artifacts from the
#     LOCAL COPY before anything is hashed or archived, so those never leave the host.
#   * Produces a file inventory of SHA-256 hashes and a pruned source archive (kept on the host).
#
# It does NOT compute a diff and does NOT transfer anything off the host. Run compare-against-d354a615.sh
# afterwards (offline) to produce the sanitized diff for review.
#
# USAGE:
#   ./capture-deployed-tree.sh --container <name|id> [--app-path /app] [--identity-url <url>]
#   ./capture-deployed-tree.sh --tree /path/to/deployed/checkout   # if deployed as a plain dir, not a container
#
# SAFETY: run as a user that can read the container/tree. Uses only: docker inspect, docker cp,
#   find, sha256sum, tar, curl (identity only). No docker exec, no restart, no writes to the app.

set -euo pipefail

CONTAINER=""
APP_PATH="/app"
IDENTITY_URL=""
TREE=""
OUT="${OUT:-$HOME/opsworkbench-provenance-$(date -u +%Y%m%d-%H%M%SZ)}"

while [ $# -gt 0 ]; do
  case "$1" in
    --container) CONTAINER="$2"; shift 2 ;;
    --app-path) APP_PATH="$2"; shift 2 ;;
    --identity-url) IDENTITY_URL="$2"; shift 2 ;;
    --tree) TREE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$CONTAINER" ] && [ -z "$TREE" ]; then
  echo "ERROR: provide --container <name|id> or --tree <dir>." >&2
  exit 2
fi

mkdir -p "$OUT"
WORK="$OUT/deployed-tree"
mkdir -p "$WORK"
echo "==> Output directory: $OUT"

# ---------------------------------------------------------------------------
# 1. Release identity (identity strings ONLY — never the full environment).
# ---------------------------------------------------------------------------
IDENT="$OUT/release-identity.txt"
{
  echo "captured_at_utc=$(date -u +%FT%TZ)"
  echo "host=$(hostname)"
  echo "capture_mode=$([ -n "$CONTAINER" ] && echo container || echo tree)"
} > "$IDENT"

if [ -n "$CONTAINER" ]; then
  # Read-only container metadata.
  docker inspect "$CONTAINER" --format 'image={{.Config.Image}}' >> "$IDENT" 2>/dev/null || true
  docker inspect "$CONTAINER" --format 'image_id={{.Image}}' >> "$IDENT" 2>/dev/null || true
  docker inspect "$CONTAINER" --format 'started_at={{.State.StartedAt}}' >> "$IDENT" 2>/dev/null || true
  docker inspect "$CONTAINER" --format 'labels={{json .Config.Labels}}' >> "$IDENT" 2>/dev/null || true
  # Identity env vars ONLY — the grep guarantees no secret-bearing variables are written to disk.
  docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep -E '^(BUILD_VERSION|CONTROL_CENTER_SOURCE_COMMIT|GIT_COMMIT|GIT_BRANCH|NODE_VERSION)=' \
    >> "$IDENT" || true
fi

if [ -n "$IDENTITY_URL" ]; then
  # The runtimeIdentity endpoint returns {version, commit, branch, node} — no secrets.
  echo "identity_endpoint_response=$(curl -fsS --max-time 10 "$IDENTITY_URL" 2>/dev/null || echo unavailable)" >> "$IDENT"
fi
echo "==> Wrote release identity: $IDENT"

# ---------------------------------------------------------------------------
# 2. Copy the deployed tree OUT (read-only wrt the running app).
# ---------------------------------------------------------------------------
if [ -n "$CONTAINER" ]; then
  echo "==> Copying $CONTAINER:$APP_PATH -> $WORK (docker cp is read-only to the container)"
  docker cp "$CONTAINER:$APP_PATH/." "$WORK/"
else
  echo "==> Copying $TREE -> $WORK (read-only)"
  cp -a "$TREE/." "$WORK/"
fi

# ---------------------------------------------------------------------------
# 3. Prune secrets / runtime data / logs / caches / deps / generated artifacts
#    from the LOCAL COPY, so they are never hashed, archived, or transferred.
# ---------------------------------------------------------------------------
echo "==> Pruning excluded content from the local copy"
cd "$WORK"

# Directories: dependencies, VCS, caches, coverage, runtime data, logs, uploads, build outputs.
find . -type d \( \
  -name node_modules -o -name .git -o -name .cache -o -name .npm -o -name .turbo -o \
  -name coverage -o -name tmp -o -name temp -o -name logs -o -name log -o \
  -name data -o -name db -o -name uploads -o -name .next -o -name dist -o -name build \
  \) -prune -exec rm -rf {} + 2>/dev/null || true

# Files: secrets, keys, env files, logs, dumps, sqlite, archives.
# The trailing `! -name '*.example' ...` KEEPS non-secret template files (e.g. .env.staging.example) so
# they are not misreported as drift; only real secret-bearing files are pruned.
find . -type f \( \
  -name '.env' -o -name '.env.*' -o -name '*.env' -o \
  -name '*.pem' -o -name '*.key' -o -name '*.pfx' -o -name '*.p12' -o -name '*.crt' -o \
  -name 'id_rsa*' -o -name 'id_ed25519*' -o -name '*.secret' -o -name 'secrets*.json' -o \
  -name '*.log' -o -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.dump' -o -name '*.pid' \
  \) ! -name '*.example' ! -name '*.sample' ! -name '*.template' ! -name '*.dist' -delete 2>/dev/null || true

# ---------------------------------------------------------------------------
# 4. Best-effort secret scan of the pruned copy (flag only; never blocks capture).
# ---------------------------------------------------------------------------
FLAG="$OUT/secret-scan-flags.txt"
: > "$FLAG"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks dir "$WORK" --no-banner --redact --report-path "$OUT/gitleaks-report.json" >/dev/null 2>&1 || \
    echo "gitleaks reported potential findings — REVIEW $OUT/gitleaks-report.json before returning anything." >> "$FLAG"
else
  # Fallback heuristic (only when gitleaks is unavailable): match ACTUAL secret material — private keys,
  # provider key formats, and credential-in-URL — NOT source identifiers named token/secret/password.
  # Advisory only: the secret-file prune above is the primary control, and the archive stays local.
  grep -rInE '(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|sk-(ant-)?[A-Za-z0-9_-]{24,}|://[^/:@[:space:]]+:[^/@[:space:]]+@[^[:space:]/])' \
    "$WORK" 2>/dev/null | head -50 >> "$FLAG" || true
  if [ -s "$FLAG" ]; then
    echo "(advisory: review the lines above — test fixtures with fake secrets can match. The secret-file prune is the primary control and the archive stays local regardless.)" >> "$FLAG"
  fi
fi
echo "==> Secret-scan flags: $FLAG (empty is good)"

# ---------------------------------------------------------------------------
# 5. File inventory of SHA-256 hashes (path + hash only; leaks no content).
# ---------------------------------------------------------------------------
INV="$OUT/deployed-inventory.tsv"
echo "==> Building SHA-256 inventory: $INV"
{
  printf 'sha256\tpath\n'
  find . -type f | LC_ALL=C sort | while IFS= read -r f; do
    printf '%s\t%s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "${f#./}"
  done
} > "$INV"
echo "    $(($(wc -l < "$INV") - 1)) files inventoried"

# ---------------------------------------------------------------------------
# 6. Deterministic archive of the pruned tree (kept ON THE HOST for the compare step).
# ---------------------------------------------------------------------------
ARCH="$OUT/deployed-source.tar.gz"
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='UTC 2020-01-01' -czf "$ARCH" .
sha256sum "$ARCH" | tee "$ARCH.sha256"
echo ""
echo "============================================================"
echo "Capture complete. Files in: $OUT"
echo "  release-identity.txt      <- return (identity strings only)"
echo "  deployed-inventory.tsv    <- return (hashes + paths only)"
echo "  secret-scan-flags.txt     <- review; must be empty/benign before returning anything"
echo "  deployed-source.tar.gz    <- KEEP LOCAL; feed to compare-against-d354a615.sh"
echo ""
echo "NEXT: run  compare-against-d354a615.sh $ARCH  on a machine with internet"
echo "      (or already-cloned repo) to produce the SANITIZED diff for review."
echo "============================================================"
