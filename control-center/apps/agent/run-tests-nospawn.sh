#!/bin/sh
# Execute the whole suite with NOTHING nesting a child process.
#
# `node --test` spawns one child per test file, and `tsx` spawns esbuild. In a sandbox that forbids a
# process from spawning children, both die before a single test body runs — which is why three review
# rounds of this workstream passed with nobody but the author having executed these tests.
#
# Here the SHELL launches one plain `node` per compiled file, and nothing nests.
set -e
cd "$(dirname "$0")"
npx tsc -p tsconfig.emit-tests.json

# Totals are parsed WITHOUT matching the reporter's leading glyph: it is multibyte, and whether `.`
# matches it depends on the reviewer's locale. A runner that silently counted zero would be worse than
# one that fails.
count() { printf '%s\n' "$1" | sed -n "s/.* $2 \([0-9][0-9]*\)\$/\1/p" | head -1; }

files=0; total=0; passed=0; failed=0; skipped=0; unreported=0
for f in build-tests/test/*.test.js; do
  files=$((files + 1))
  out=$(node "$f" 2>&1 || true)
  t=$(count "$out" tests)
  if [ -z "$t" ]; then
    # NO TOTALS LINE AT ALL. The file died before the reporter ran — a missing dependency, an import-time
    # throw, or the very sandbox restriction this script exists to work around. Counting it as zero tests
    # is how an unexecuted suite comes to look like a passing one, so it is counted as a failure instead.
    unreported=$((unreported + 1))
    printf '%-40s NO RESULT — did not reach the reporter\n' "$(basename "$f")"
    printf '%s\n' "$out" | head -3 | sed 's/^/    /'
    continue
  fi
  p=$(count "$out" pass);    p=${p:-0}
  x=$(count "$out" fail);    x=${x:-0}
  s=$(count "$out" skipped); s=${s:-0}
  printf '%-40s tests=%-4s pass=%-4s fail=%-3s skip=%s\n' "$(basename "$f")" "$t" "$p" "$x" "$s"
  [ "$x" = 0 ] || printf '%s\n' "$out" | grep -E '^  (Error|AssertionError)' | head -3 | sed 's/^/    /'
  total=$((total + t)); passed=$((passed + p)); failed=$((failed + x)); skipped=$((skipped + s))
done

echo
if [ "$files" -eq 0 ]; then
  echo "NO TEST FILES MATCHED — the emit step produced nothing, so nothing was verified."
  exit 1
fi
echo "TOTAL files=$files tests=$total pass=$passed fail=$failed skip=$skipped unreported=$unreported"
[ "$failed" -eq 0 ] && [ "$unreported" -eq 0 ]
