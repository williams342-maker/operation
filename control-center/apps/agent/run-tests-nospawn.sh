#!/bin/sh
# Execute the whole suite with NOTHING nesting a child process.
#
# `node --test` spawns one child per test file, and `tsx` spawns esbuild. In a sandbox that forbids a
# process from spawning children, both die before a single test body runs — which is why two review rounds
# of this workstream passed with nobody but the author having executed these tests.
#
# Here the SHELL launches one plain `node` per compiled file, and nothing nests.
set -e
cd "$(dirname "$0")"
npx tsc -p tsconfig.emit-tests.json

# Parsed without matching the reporter's leading symbol: it is multibyte, and whether `.` matches it
# depends on the locale the reviewer happens to have.
count() { printf '%s\n' "$1" | sed -n "s/.* $2 \([0-9][0-9]*\)\$/\1/p" | head -1; }
total=0; passed=0; failed=0; skipped=0
for f in build-tests/test/*.test.js; do
  out=$(node "$f" 2>&1 || true)
  t=$(count "$out" tests);   t=${t:-0}
  p=$(count "$out" pass);    p=${p:-0}
  x=$(count "$out" fail);    x=${x:-0}
  s=$(count "$out" skipped); s=${s:-0}
  printf '%-40s tests=%-4s pass=%-4s fail=%-3s skip=%s\n' "$(basename "$f")" "$t" "$p" "$x" "$s"
  [ "$x" = 0 ] || printf '%s\n' "$out" | grep -E '^  (Error|AssertionError)' | head -3
  total=$((total + t)); passed=$((passed + p)); failed=$((failed + x)); skipped=$((skipped + s))
done
echo
echo "TOTAL tests=$total pass=$passed fail=$failed skip=$skipped"
[ "$failed" -eq 0 ]
