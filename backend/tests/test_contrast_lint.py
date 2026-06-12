"""iter390 — Contrast lint enforcement.

Runs the frontend contrast lint (scripts/lint-contrast.js) as part of the
backend test suite so the testing pipeline blocks any NEW light Tailwind
text shades (text-zinc-300, text-amber-200, …) on the light Aged Canvas
theme. See the script header for the rules + approved-dark whitelist.
"""
import subprocess


def test_contrast_lint_passes():
    r = subprocess.run(
        ["node", "/app/frontend/scripts/lint-contrast.js"],
        capture_output=True, text=True, timeout=60,
    )
    assert r.returncode == 0, f"Contrast lint failed:\n{r.stdout}\n{r.stderr}"
