#!/usr/bin/env bash
# Exercise verify-checksum-sidecar.sh.
#
# The cases that matter are the refusals. A checksum gate that accepts everything is worse than no
# gate, because it produces evidence of verification that never happened -- so most of what is
# below constructs a sidecar that is wrong in one specific way and requires the gate to say so.
#
# Two are the defects that prompted the gate and are called out by name: a CRLF-terminated sidecar
# (real, found in a release-candidate evidence bundle) and a sidecar naming a file that is not
# there. Both must FAIL.
#
# Runs anywhere with bash and coreutils: no network, no repo state, no privileges.
set -uo pipefail

GATE="$(cd "$(dirname "$0")" && pwd -P)/verify-checksum-sidecar.sh"
[ -x "$GATE" ] || { echo "FAIL: gate is not executable: $GATE"; exit 1; }

pass=0; fail=0
T="$(mktemp -d)" || exit 1
trap 'rm -rf "$T"' EXIT

# chk <name> <expect: pass|fail> <expected-text-in-output> <sidecar> <expected-name>
chk(){
  local name="$1" want="$2" text="$3" sidecar="$4" expected="$5"
  [ -n "$text" ] || { echo "FAIL[$name]: empty expectation asserts nothing"; fail=$((fail+1)); return; }
  local out rc
  out="$("$GATE" "$sidecar" "$expected" 2>&1)"; rc=$?
  if [ "$want" = "pass" ] && [ "$rc" -ne 0 ]; then
    echo "FAIL[$name]: expected success, got exit $rc"; echo "  $out"; fail=$((fail+1)); return
  fi
  if [ "$want" = "fail" ] && [ "$rc" -eq 0 ]; then
    echo "FAIL[$name]: expected refusal, got exit 0"; echo "  $out"; fail=$((fail+1)); return
  fi
  if ! printf '%s' "$out" | grep -q -- "$text"; then
    echo "FAIL[$name]: output did not contain: $text"; echo "  $out"; fail=$((fail+1)); return
  fi
  echo "ok[$name]"; pass=$((pass+1))
}

ARCHIVE="artifact.tar.gz"
printf 'pretend archive contents\n' > "$T/$ARCHIVE"
DIGEST="$(sha256sum "$T/$ARCHIVE" | cut -d' ' -f1)"
OTHER="$(printf 'something else\n' | sha256sum | cut -d' ' -f1)"

# --- the good case ---------------------------------------------------------------------
printf '%s  %s\n' "$DIGEST" "$ARCHIVE" > "$T/good.sha256"
chk "a correct sidecar verifies" pass "checksum sidecar verified" "$T/good.sha256" "$ARCHIVE"

# GNU binary-mode marker is legitimate.
printf '%s *%s\n' "$DIGEST" "$ARCHIVE" > "$T/binmode.sha256"
chk "binary-mode marker is accepted" pass "verified" "$T/binmode.sha256" "$ARCHIVE"

# Hex case is not part of the value.
printf '%s  %s\n' "$(printf '%s' "$DIGEST" | tr 'a-f' 'A-F')" "$ARCHIVE" > "$T/upper.sha256"
chk "uppercase digest is accepted" pass "verified" "$T/upper.sha256" "$ARCHIVE"

# --- THE TWO DEFECTS THAT PROMPTED THIS GATE -------------------------------------------
# A real CRLF sidecar shipped in a release-candidate evidence bundle.
printf '%s  %s\r\n' "$DIGEST" "$ARCHIVE" > "$T/crlf.sha256"
chk "CRLF sidecar is refused" fail "carriage-return" "$T/crlf.sha256" "$ARCHIVE"

# The file the sidecar names is not there.
printf '%s  %s\n' "$DIGEST" "absent.tar.gz" > "$T/missing.sha256"
chk "a sidecar naming a missing file is refused" fail "does not exist" "$T/missing.sha256" "absent.tar.gz"

# --- shape ------------------------------------------------------------------------------
: > "$T/empty.sha256"
chk "an empty sidecar is refused" fail "empty" "$T/empty.sha256" "$ARCHIVE"

printf '%s  %s\n%s  %s\n' "$DIGEST" "$ARCHIVE" "$DIGEST" "$ARCHIVE" > "$T/two.sha256"
chk "two entries are refused" fail "exactly one checksum entry" "$T/two.sha256" "$ARCHIVE"

# `sha256sum -c` passes this one: one good line plus junk is only a warning to it.
printf '%s  %s\ngarbage\n' "$DIGEST" "$ARCHIVE" > "$T/mixed.sha256"
chk "a good line plus a junk line is refused" fail "exactly one checksum entry" "$T/mixed.sha256" "$ARCHIVE"

printf '%s  %s' "$DIGEST" "$ARCHIVE" > "$T/noeol.sha256"
chk "a missing trailing newline is refused" fail "does not end with a newline" "$T/noeol.sha256" "$ARCHIVE"

printf 'not a checksum line\n' > "$T/malformed.sha256"
chk "a malformed line is refused" fail "malformed checksum line" "$T/malformed.sha256" "$ARCHIVE"

printf '%s  %s\n' "${DIGEST:0:63}" "$ARCHIVE" > "$T/short.sha256"
chk "a truncated digest is refused" fail "malformed checksum line" "$T/short.sha256" "$ARCHIVE"

chk "a nonexistent sidecar is refused" fail "does not exist" "$T/nope.sha256" "$ARCHIVE"

# --- REVIEW round 1: three defects an independent review found by RUNNING this ------------
# All three were fail-open or false-fail, and not one was caught by the assertions above.

# NUL. `entry="$(head -n 1 ...)"` silently DISCARDS NUL bytes -- bash warns "ignored null byte
# in input" and carries on -- so every check below it validated a string the file did not
# contain. Measured: a 76-byte sidecar became a 74-character entry, and a digest with an
# embedded NUL was ACCEPTED as well formed.
printf '%s\000  %s\n' "${DIGEST:0:63}" "$ARCHIVE" > "$T/nul-digest.sha256"
chk "a NUL inside the digest is refused" fail "NUL bytes" "$T/nul-digest.sha256" "$ARCHIVE"

printf '%s  arti\000fact\n' "$DIGEST" > "$T/nul-name.sha256"
chk "a NUL inside the filename is refused" fail "NUL bytes" "$T/nul-name.sha256" "$ARCHIVE"

printf '%s  %s\000\n' "$DIGEST" "$ARCHIVE" > "$T/nul-tail.sha256"
chk "a NUL after the filename is refused" fail "NUL bytes" "$T/nul-tail.sha256" "$ARCHIVE"

# CRLF detection must not depend on which shell runs it. The original guard was
# `grep -q $'\r'`, which Git Bash reads in text mode and never matches -- so under Git Bash the
# CRLF case PASSED, on precisely the defect this gate exists for. Byte counting cannot be fooled
# by a text-mode reader. The plain CRLF case above covers the behaviour; this pins the mechanism.
printf '%s  %s\r\n' "$DIGEST" "$ARCHIVE" > "$T/crlf-mechanism.sha256"
chk "CRLF is refused by byte count, not by grep" fail "carriage-return" "$T/crlf-mechanism.sha256" "$ARCHIVE"

# Backslash in the path. GNU sha256sum escapes such filenames by prefixing its whole output line
# with a backslash, so a digest read with `cut -d' ' -f1` came back as "\<digest>" and the file
# read as a mismatch -- a false FAILURE rather than a false pass, but wrong either way. Fixed by
# hashing through stdin, where there is no filename in the output to escape.
BS_DIR="$T/back\\slash"
mkdir -p "$BS_DIR"
printf 'pretend archive contents\n' > "$BS_DIR/$ARCHIVE"
printf '%s  %s\n' "$DIGEST" "$ARCHIVE" > "$BS_DIR/ok.sha256"
chk "a backslash in the path still verifies" pass "checksum sidecar verified" "$BS_DIR/ok.sha256" "$ARCHIVE"

# --- identity ----------------------------------------------------------------------------
# THE DISCRIMINATING CASE. Everything above still passes if the gate never compares the recorded
# name to the expected one: the sidecar is well-formed, the file it names exists, and its digest
# is correct. It is simply about a different file than the caller asked about.
printf 'a decoy\n' > "$T/decoy.tar.gz"
printf '%s  %s\n' "$(sha256sum "$T/decoy.tar.gz" | cut -d' ' -f1)" "decoy.tar.gz" > "$T/decoy.sha256"
chk "a valid sidecar for the WRONG file is refused" fail "was asked about" "$T/decoy.sha256" "$ARCHIVE"

# Content changed after the sidecar was written.
printf '%s  %s\n' "$OTHER" "$ARCHIVE" > "$T/mismatch.sha256"
chk "a digest mismatch is refused" fail "digest mismatch" "$T/mismatch.sha256" "$ARCHIVE"

# A directory is not an archive.
mkdir -p "$T/adir.tar.gz"
printf '%s  %s\n' "$DIGEST" "adir.tar.gz" > "$T/dir.sha256"
chk "a directory in place of the file is refused" fail "not a regular file" "$T/dir.sha256" "adir.tar.gz"

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ] || exit 1
echo "PASS verify-checksum-sidecar.sh"
