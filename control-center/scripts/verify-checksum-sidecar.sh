#!/usr/bin/env bash
# Verify a single-entry checksum sidecar against the file it names.
#
# Usage: verify-checksum-sidecar.sh <sidecar-file> <expected-filename>
#
# The expected filename is REQUIRED and is checked against the sidecar's own entry, because a
# sidecar that verifies some other file correctly is not evidence about the file you meant.
#
# WHY THIS EXISTS, stated from measurement rather than folklore. `sha256sum --check` is stricter
# than it is often given credit for -- on GNU coreutils 9.4 it exits 1 for a CRLF line, an empty
# file, a malformed-only file and a missing referenced file. What it does NOT do is tell you
# HOW MANY entries it verified or WHICH file they were about:
#
#     one good line + one malformed line   -> exit 0 (warning only)
#     two entries                          -> exit 0
#
# So a caller that greps an upstream checksum list into a temporary file and runs `--check` on the
# result is trusting that the grep produced exactly the line it wanted. If the upstream format
# shifts, the grep can emit more than one line, or a line about a different asset, and the check
# still passes. This script closes that by deciding the shape itself and recomputing the digest
# rather than delegating the verdict.
#
# It deliberately does not call `sha256sum --check` at all: the verdict is ours, from a digest we
# computed, compared to a digest we parsed out of a line we validated.
set -uo pipefail

die(){ echo "CHECKSUM-GATE-FAIL: $*" >&2; exit 1; }

SIDECAR="${1:-}"
EXPECTED_NAME="${2:-}"
[ -n "$SIDECAR" ] || die "usage: verify-checksum-sidecar.sh <sidecar-file> <expected-filename>"
[ -n "$EXPECTED_NAME" ] || die "usage: verify-checksum-sidecar.sh <sidecar-file> <expected-filename>"
[ -f "$SIDECAR" ] || die "sidecar does not exist or is not a regular file: $SIDECAR"
[ -s "$SIDECAR" ] || die "sidecar is empty: $SIDECAR"

# Byte-level rejections, done by COUNTING BYTES rather than by grep.
#
# `grep -q $'\r'` was the obvious way to find carriage returns and it is wrong: an independent
# review ran the harness under Git Bash and the CRLF case PASSED, because that grep treats the
# file as text and never sees the CR. The guard against the very defect this gate exists for did
# not fire on one of the two shells it ships to. Deleting a byte and comparing lengths cannot be
# fooled by a text-mode reader.
#
# NUL is rejected for a sharper reason. `entry="$(head -n 1 ...)"` silently DISCARDS NUL bytes --
# bash warns "ignored null byte in input" and carries on -- so every check below would validate a
# string the file does not contain. Measured: a 76-byte sidecar became a 74-character entry, and
# a digest or filename with an embedded NUL was accepted as well-formed. That is a fail-open, and
# it is why this check comes before anything reads the line.
bytes_total="$(wc -c < "$SIDECAR")"
[ "$bytes_total" = "$(LC_ALL=C tr -d '\000' < "$SIDECAR" | wc -c)" ] \
  || die "sidecar contains NUL bytes, which shell reads silently discard: $SIDECAR"
[ "$bytes_total" = "$(LC_ALL=C tr -d '\r' < "$SIDECAR" | wc -c)" ] \
  || die "sidecar contains carriage-return bytes (CRLF); re-emit it with LF endings: $SIDECAR"

# Must end with exactly one LF. A missing terminator is how a last line gets silently dropped by
# line-based readers.
last_byte="$(tail -c 1 "$SIDECAR" | od -An -tx1 | tr -d ' \n')"
[ "$last_byte" = "0a" ] || die "sidecar does not end with a newline: $SIDECAR"

# Exactly one entry. Blank lines count as content here: a sidecar with padding is not the shape
# this gate accepts, and quietly ignoring them is how "extra junk is tolerated" starts.
line_count="$(wc -l < "$SIDECAR")"
line_count="${line_count// /}"
[ "$line_count" = "1" ] || die "expected exactly one checksum entry, found $line_count: $SIDECAR"

entry="$(head -n 1 "$SIDECAR")"

# GNU emits "<64 hex><space><space|*><name>"; the second character is a space for text mode and an
# asterisk for binary mode. Both are accepted, nothing else is.
if [[ "$entry" =~ ^([0-9a-fA-F]{64})\ ([\ \*])(.+)$ ]]; then
  recorded_digest="${BASH_REMATCH[1]}"
  recorded_name="${BASH_REMATCH[3]}"
else
  # Truncated: a malformed sidecar can be arbitrarily long, and a gate that echoes a megabyte into
  # a CI log to explain a one-line problem is its own small denial of service.
  die "malformed checksum line (want '<64 hex>  <filename>'): ${entry:0:120}"
fi

[ "$recorded_name" = "$EXPECTED_NAME" ] \
  || die "sidecar names '$recorded_name' but this gate was asked about '$EXPECTED_NAME'"

# Resolve the named file relative to the sidecar's own directory, which is how a sidecar is meant
# to be read and how `sha256sum -c` reads it when run from there.
sidecar_dir="$(cd "$(dirname "$SIDECAR")" && pwd -P)"
target="$sidecar_dir/$recorded_name"
[ -e "$target" ] || die "sidecar names a file that does not exist: $target"
[ -f "$target" ] || die "sidecar names something that is not a regular file: $target"
[ -r "$target" ] || die "sidecar names a file that cannot be read: $target"

# Hashed through STDIN, not by filename. GNU sha256sum escapes a filename containing a backslash
# or newline by prefixing the whole output line with "\", so `cut -d' ' -f1` would return
# "\<digest>" and every such file would read as a mismatch. Feeding the bytes in means there is no
# filename in the output to escape.
computed_digest="$(sha256sum < "$target" | cut -d' ' -f1)" \
  || die "could not compute a digest for $target"
[ -n "$computed_digest" ] || die "empty digest computed for $target"

# Compare case-insensitively: the hex is the value, its case is not.
if [ "$(printf '%s' "$recorded_digest" | tr 'A-F' 'a-f')" \
   != "$(printf '%s' "$computed_digest" | tr 'A-F' 'a-f')" ]; then
  die "digest mismatch for $recorded_name
  recorded: $recorded_digest
  computed: $computed_digest"
fi

echo "checksum sidecar verified: $recorded_name  $computed_digest"
