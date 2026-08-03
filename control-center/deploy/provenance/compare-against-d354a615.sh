#!/usr/bin/env bash
# compare-against-d354a615.sh — OFFLINE comparison of the captured deployed tree against a clean
# checkout of d354a615 (the preserved production-lineage tip). Produces a SANITIZED diff for review.
#
# Runs nowhere near production. Inputs are the pruned archive from capture-deployed-tree.sh plus a
# clean, read-only checkout of d354a615 (cloned here, or supplied via --checkout).
#
# OUTPUTS (only these should be returned for review):
#   file-classification.tsv   path, status (identical|modified|added|removed), deployed_sha, base_sha
#   summary.txt               counts + release identity echo
#   sanitized-diff.patch      unified diff of modified/added TEXT source files, secret-redacted
#   inventory-hashes.txt      top-level hashes of the archive + both inventories
#
# USAGE:
#   ./compare-against-d354a615.sh <deployed-source.tar.gz> [--identity <release-identity.txt>] \
#       [--repo https://github.com/williams342-maker/operation.git] \
#       [--ref provenance/project-deployment-history-local-tip-20260803] \
#       [--base-subdir control-center] [--deployed-subdir .] [--checkout <existing-clean-dir>]

set -euo pipefail

ARCHIVE="${1:-}"
[ -n "$ARCHIVE" ] && shift || { echo "ERROR: pass the deployed-source.tar.gz path." >&2; exit 2; }
[ -f "$ARCHIVE" ] || { echo "ERROR: archive not found: $ARCHIVE" >&2; exit 2; }

REPO="https://github.com/williams342-maker/operation.git"
REF="provenance/project-deployment-history-local-tip-20260803"   # annotated tag -> d354a615
BASE_SUBDIR="control-center"      # deployed /app is assumed to mirror the control-center app subtree
DEPLOYED_SUBDIR="."
CHECKOUT=""
IDENTITY=""
OUT="${OUT:-$PWD/provenance-compare-$(date -u +%Y%m%d-%H%M%SZ)}"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --base-subdir) BASE_SUBDIR="$2"; shift 2 ;;
    --deployed-subdir) DEPLOYED_SUBDIR="$2"; shift 2 ;;
    --checkout) CHECKOUT="$2"; shift 2 ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. Extract the deployed tree.
DEPLOYED="$TMP/deployed"
mkdir -p "$DEPLOYED"
tar -xzf "$ARCHIVE" -C "$DEPLOYED"
DEPLOYED_ROOT="$DEPLOYED/$DEPLOYED_SUBDIR"

# 2. Clean checkout of d354a615 (verify it resolves to the expected commit).
if [ -z "$CHECKOUT" ]; then
  CHECKOUT="$TMP/base"
  echo "==> Cloning $REPO @ $REF (read-only, shallow)"
  git clone --quiet --no-tags "$REPO" "$CHECKOUT"
  git -C "$CHECKOUT" fetch --quiet --tags origin "$REF" || true
  git -C "$CHECKOUT" -c advice.detachedHead=false checkout --quiet "$REF"
fi
BASE_COMMIT="$(git -C "$CHECKOUT" rev-parse HEAD)"
echo "==> Base checkout HEAD: $BASE_COMMIT"
case "$BASE_COMMIT" in
  d354a615*) : ;;
  *) echo "WARNING: base HEAD is $BASE_COMMIT, expected d354a615…. Confirm --ref before trusting results." >&2 ;;
esac
BASE_ROOT="$CHECKOUT/$BASE_SUBDIR"
[ -d "$BASE_ROOT" ] || { echo "ERROR: base subdir not found: $BASE_ROOT (adjust --base-subdir)" >&2; exit 2; }

# 3. Build path->sha inventories for both sides (skip .git).
inv() { # $1=root  -> stdout "sha\tpath"
  ( cd "$1" && find . -type f -not -path './.git/*' | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s\t%s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "${f#./}"
    done )
}
inv "$DEPLOYED_ROOT" > "$TMP/deployed.inv"
inv "$BASE_ROOT"     > "$TMP/base.inv"

# 4. Classify every path via a single awk over both inventories.
CLASS="$OUT/file-classification.tsv"
awk -F'\t' '
  FNR==NR { dep[$2]=$1; depseen[$2]=1; next }
  { base[$2]=$1; baseseen[$2]=1 }
  END {
    for (p in depseen) allp[p]=1
    for (p in baseseen) allp[p]=1
    for (p in allp) {
      d = (p in dep) ? dep[p] : ""
      b = (p in base) ? base[p] : ""
      if (d != "" && b != "") status = (d==b) ? "identical" : "modified"
      else if (d != "") status = "added"
      else status = "removed"
      printf "%s\t%s\t%s\t%s\n", status, p, d, b
    }
  }
' "$TMP/deployed.inv" "$TMP/base.inv" | LC_ALL=C sort -k1,1 -k2,2 > "$TMP/class.body"
{ printf 'status\tpath\tdeployed_sha\tbase_sha\n'; cat "$TMP/class.body"; } > "$CLASS"

# 5. Sanitized unified diff for modified/added TEXT files only (binaries skipped).
RAW="$TMP/raw.patch"
: > "$RAW"
awk -F'\t' '$1=="modified" || $1=="added" {print $2}' "$TMP/class.body" | while IFS= read -r p; do
  dfile="$DEPLOYED_ROOT/$p"; bfile="$BASE_ROOT/$p"
  # Skip binaries / very large files.
  if [ -f "$dfile" ] && LC_ALL=C grep -qI . "$dfile" 2>/dev/null; then
    [ "$(wc -c < "$dfile")" -gt 1048576 ] && { echo "# skipped large file: $p" >> "$RAW"; continue; }
    diff -u "${bfile:-/dev/null}" "$dfile" 2>/dev/null | sed "s#$TMP/base/$BASE_SUBDIR/#base/#; s#$TMP/deployed/#deployed/#" >> "$RAW" || true
  else
    echo "# binary or unreadable, compared by hash only: $p" >> "$RAW"
  fi
done

# 6. Redact secrets from the diff. gitleaks if present, plus a always-on heuristic sed pass.
SAN="$OUT/sanitized-diff.patch"
cp "$RAW" "$SAN"
# Heuristic redaction of high-signal secret shapes (defence in depth; excluded files should already be gone).
sed -i -E \
  -e 's/(-----BEGIN[ A-Z]*PRIVATE KEY-----).*/\1[REDACTED]/g' \
  -e 's/(AKIA[0-9A-Z]{16})/[REDACTED-AWS-KEY]/g' \
  -e 's/(xox[baprs]-[A-Za-z0-9-]+)/[REDACTED-SLACK]/g' \
  -e 's/(([Pp]assword|[Ss]ecret|[Tt]oken|[Aa]pi[_-]?key)[[:space:]]*[:=][[:space:]]*).+/\1[REDACTED]/g' \
  "$SAN"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --no-git --source "$SAN" --no-banner --redact --report-path "$OUT/gitleaks-on-diff.json" >/dev/null 2>&1 || \
    echo "gitleaks flagged the diff — review $OUT/gitleaks-on-diff.json and hand-redact before returning." >> "$OUT/REVIEW-REQUIRED.txt"
fi

# 7. Summary + hashes.
SUM="$OUT/summary.txt"
{
  echo "OpsWorkbench provenance comparison — deployed tree vs d354a615"
  echo "generated_utc=$(date -u +%FT%TZ)"
  echo "base_commit=$BASE_COMMIT (expected d354a615…)"
  echo "base_subdir=$BASE_SUBDIR  deployed_subdir=$DEPLOYED_SUBDIR"
  echo ""
  echo "counts:"
  for s in identical modified added removed; do
    printf '  %-10s %s\n' "$s" "$(awk -F'\t' -v S="$s" '$1==S' "$TMP/class.body" | wc -l)"
  done
  echo ""
  [ -n "$IDENTITY" ] && { echo "release identity (from capture):"; sed 's/^/  /' "$IDENTITY"; }
} > "$SUM"

{
  echo "archive_sha256   $(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
  echo "classification   $(sha256sum "$CLASS" | cut -d' ' -f1)"
  echo "sanitized_diff   $(sha256sum "$SAN" | cut -d' ' -f1)"
} > "$OUT/inventory-hashes.txt"

echo ""
echo "============================================================"
cat "$SUM"
echo "------------------------------------------------------------"
echo "Outputs in: $OUT"
echo "  summary.txt  file-classification.tsv  sanitized-diff.patch  inventory-hashes.txt"
[ -f "$OUT/REVIEW-REQUIRED.txt" ] && echo "  !! REVIEW-REQUIRED.txt present — hand-redact before returning."
echo ""
echo "RETURN ONLY: summary.txt, file-classification.tsv, sanitized-diff.patch, inventory-hashes.txt,"
echo "             and release-identity.txt. Do NOT return the archive or any raw tree."
echo "============================================================"
