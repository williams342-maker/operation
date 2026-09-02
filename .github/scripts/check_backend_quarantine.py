"""Compare a pytest JUnit report against the backend quarantine baseline.

The backend gate is not "the suite is green" — it is not, and pretending otherwise would make the gate a
lie. It is "nothing got worse". Concretely:

    a non-passing test that is NOT in the baseline  -> exit 1. This is the regression signal.
    a baseline test that now passes                 -> reported, exit 0. The list should shrink.
    a baseline line matching no collected test      -> reported as stale, exit 0.

Unexpected passes deliberately do NOT fail the job. Five tests in the baseline are known to alternate
between runs, so failing on an unexpected pass would hand the gate a guaranteed false red roughly whenever
one of them flipped. They are reported loudly instead, every run, so the list cannot quietly rot.

Usage: check_backend_quarantine.py <junit.xml> <quarantine.txt>
"""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET


def node_id(case: ET.Element) -> str:
    classname = (case.get("classname") or "").strip()
    name = (case.get("name") or "").strip()
    return f"{classname}::{name}" if classname else name


def load_report(path: str) -> tuple[set[str], set[str], set[str]]:
    root = ET.parse(path).getroot()
    suite = root if root.tag == "testsuite" else root.find("testsuite")
    if suite is None:
        raise SystemExit("no <testsuite> in the JUnit report")
    collected, passing, non_passing = set(), set(), set()
    for case in suite.iter("testcase"):
        nid = node_id(case)
        collected.add(nid)
        if case.find("skipped") is not None:
            continue
        if case.find("failure") is not None or case.find("error") is not None:
            non_passing.add(nid)
        else:
            passing.add(nid)
    return collected, passing, non_passing


def load_baseline(path: str) -> set[str]:
    with open(path, encoding="utf-8") as handle:
        return {
            line.strip()
            for line in handle
            if line.strip() and not line.lstrip().startswith("#")
        }


def emit(lines: list[str]) -> None:
    text = "\n".join(lines)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(text + "\n")


def main() -> int:
    junit_path, baseline_path = sys.argv[1], sys.argv[2]
    collected, passing, non_passing = load_report(junit_path)
    baseline = load_baseline(baseline_path)

    regressions = sorted(non_passing - baseline)
    recovered = sorted(baseline & passing)
    stale = sorted(baseline - collected)

    out = [
        "### Backend gate",
        "",
        "| | count |",
        "| --- | --- |",
        f"| collected | {len(collected)} |",
        f"| passing | {len(passing)} |",
        f"| non-passing | {len(non_passing)} |",
        f"| quarantined (baseline) | {len(baseline)} |",
        f"| **NEW failures** | **{len(regressions)}** |",
        f"| now passing (prune these) | {len(recovered)} |",
        f"| stale baseline entries | {len(stale)} |",
        "",
    ]

    if regressions:
        out += [
            f"**FAILING: {len(regressions)} test(s) are failing that were not failing at the baseline.**",
            "",
            "Fix them, or — if the failure is genuinely pre-existing and understood — add the exact node id",
            "to `backend/tests/quarantine.txt` with a reason in the commit message.",
            "",
        ]
        out += [f"    {nid}" for nid in regressions[:50]]
        if len(regressions) > 50:
            out.append(f"    ... and {len(regressions) - 50} more")
        out.append("")

    if recovered:
        out += [
            f"{len(recovered)} quarantined test(s) now pass. Delete their lines so the baseline shrinks:",
            "",
        ]
        out += [f"    {nid}" for nid in recovered[:25]]
        if len(recovered) > 25:
            out.append(f"    ... and {len(recovered) - 25} more")
        out.append("")

    if stale:
        out += [
            f"{len(stale)} baseline entr(y/ies) match no collected test — renamed or deleted. Remove them:",
            "",
        ]
        out += [f"    {nid}" for nid in stale[:25]]
        if len(stale) > 25:
            out.append(f"    ... and {len(stale) - 25} more")
        out.append("")

    if not regressions:
        out.append("No new failures against the baseline.")

    emit(out)
    return 1 if regressions else 0


if __name__ == "__main__":
    raise SystemExit(main())
