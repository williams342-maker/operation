#!/bin/sh
# Execute the whole suite with NOTHING nesting a child process.
#
# `node --test` spawns one child per test file, and `tsx` spawns esbuild. In a sandbox that forbids a
# process from spawning children, both die before a single test body runs — which is why three review
# rounds of this workstream passed with nobody but the author having executed these tests.
#
# Here the SHELL launches one plain `node` per compiled file, and nothing nests.
#
# THIS SCRIPT IS A TEST HARNESS REPORTING ON TESTS, so the thing it must never do is look green when it
# did not verify anything. It has now had four defects of exactly that shape, three of them found by an
# independent reviewer, and each one is guarded below rather than merely fixed:
#
#   1. a file dying at import printed no totals, parsed as empty, and counted as zero tests
#   2. `|| true` discarded the exit status, so a file could print clean totals and then exit non-zero
#   3. nothing checked that tests = pass + fail + skipped + todo + cancelled, so truncated or
#      malformed output could total up to something that looked fine
#   4. `head -1` took the FIRST line resembling a totals line, so test output containing one could
#      shadow the real footer
set -e
cd "$(dirname "$0")"
npx tsc -p tsconfig.emit-tests.json

# Totals are parsed WITHOUT matching the reporter's leading glyph: it is multibyte, and whether `.`
# matches it depends on the reviewer's locale. `tail -1` takes the real footer rather than the first line
# that happens to look like one.
count() { printf '%s\n' "$1" | sed -n "s/.* $2 \([0-9][0-9]*\)\$/\1/p" | tail -1; }

files=0; total=0; passed=0; failed=0; skipped=0; rejected=0
for f in build-tests/test/*.test.js; do
  files=$((files + 1))
  name=$(basename "$f")

  # The exit STATUS is captured, not discarded. node:test exits non-zero when tests fail, so a non-zero
  # status alongside failures is expected — a non-zero status alongside NO failures is not, and that
  # combination is what a file crashing after its footer looks like.
  if out=$(node "$f" 2>&1); then status=0; else status=$?; fi

  t=$(count "$out" tests)
  if [ -z "$t" ]; then
    # NO TOTALS LINE AT ALL: the file died before the reporter ran — a missing dependency, an import-time
    # throw, or the very sandbox restriction this script exists to work around. Counting it as zero tests
    # is how an unexecuted suite comes to look like a passing one.
    rejected=$((rejected + 1))
    printf '%-40s NO RESULT — did not reach the reporter (exit %s)\n' "$name" "$status"
    printf '%s\n' "$out" | head -3 | sed 's/^/    /'
    continue
  fi
  p=$(count "$out" pass);      p=${p:-0}
  x=$(count "$out" fail);      x=${x:-0}
  s=$(count "$out" skipped);   s=${s:-0}
  d=$(count "$out" todo);      d=${d:-0}
  c=$(count "$out" cancelled); c=${c:-0}

  # The totals must ACCOUNT FOR THEMSELVES. Output that does not add up is output this script has no
  # business summarising.
  if [ "$t" -ne $((p + x + s + d + c)) ]; then
    rejected=$((rejected + 1))
    printf '%-40s INCONSISTENT — tests=%s but pass+fail+skip+todo+cancelled=%s\n' \
      "$name" "$t" "$((p + x + s + d + c))"
    continue
  fi

  # A clean report from a process that then failed is not a clean report.
  if [ "$status" -ne 0 ] && [ "$x" -eq 0 ]; then
    rejected=$((rejected + 1))
    printf '%-40s EXIT %s WITH NO REPORTED FAILURE — the process failed after reporting\n' "$name" "$status"
    printf '%s\n' "$out" | tail -3 | sed 's/^/    /'
    continue
  fi

  printf '%-40s tests=%-4s pass=%-4s fail=%-3s skip=%s\n' "$name" "$t" "$p" "$x" "$s"
  [ "$x" = 0 ] || printf '%s\n' "$out" | grep -E '^  (Error|AssertionError)' | head -3 | sed 's/^/    /'
  total=$((total + t)); passed=$((passed + p)); failed=$((failed + x)); skipped=$((skipped + s))
done

echo
if [ "$files" -eq 0 ]; then
  echo "NO TEST FILES MATCHED — the emit step produced nothing, so nothing was verified."
  exit 1
fi
echo "TOTAL files=$files tests=$total pass=$passed fail=$failed skip=$skipped rejected=$rejected"
[ "$failed" -eq 0 ] && [ "$rejected" -eq 0 ]
