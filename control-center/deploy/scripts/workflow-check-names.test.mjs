import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Status-check names must be unique across workflows.
//
// Branch protection requires a context by NAME. Two workflows here each had a job id `verify` and no
// explicit job name, so both emitted a check called `verify` while protection required the single
// context "verify" — two different pipelines answering to one required name. A pull request showed a
// passing `verify` beside a failing `verify` with nothing to distinguish them; the job log had to be
// opened to find out which pipeline had failed. That cost real time on #28 and again on #36.
//
// The check name is the job's `name` when set, and the job id otherwise. These assertions are over the
// workflow YAML, which is the honest limit: they prove the files declare distinct names, not that GitHub
// renders them distinctly.

const workflows = path.join(import.meta.dirname, "..", "..", "..", ".github", "workflows");

/** Check names a workflow will emit: each job's `name:` if present, else its id. */
function checkNames(file) {
  const text = fs.readFileSync(path.join(workflows, file), "utf8");
  const jobsAt = text.indexOf("\njobs:");
  assert.ok(jobsAt > 0, `${file} has no jobs block`);
  const body = text.slice(jobsAt);
  const names = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    // A job id is exactly two spaces of indent followed by `<id>:` — deeper indents are job properties.
    const job = lines[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (!job) continue;
    let name = job[1];
    for (let j = i + 1; j < lines.length && /^ {4}\S/.test(lines[j]); j += 1) {
      const explicit = lines[j].match(/^ {4}name:\s*(.+?)\s*$/);
      if (explicit) { name = explicit[1].replace(/^['"]|['"]$/g, ""); break; }
    }
    names.push(name);
  }
  return names;
}

const files = fs.readdirSync(workflows).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

test("every workflow declares at least one job", () => {
  assert.ok(files.length >= 2, "expected multiple workflow files");
  for (const file of files) assert.ok(checkNames(file).length > 0, `${file} declares no jobs`);
});

test("REGRESSION: no status-check name is emitted by two different workflows", () => {
  const owners = new Map();
  for (const file of files) {
    for (const name of checkNames(file)) {
      const existing = owners.get(name);
      assert.equal(existing, undefined, `check "${name}" is emitted by both ${existing} and ${file} — branch protection requires a context by NAME, so two pipelines would answer to one required check and a passing one would be indistinguishable from a failing one`);
      owners.set(name, file);
    }
  }
});

test("the comprehensive gate keeps the name branch protection requires", () => {
  // Protection requires the context "verify". It must resolve to the workflow that actually runs the
  // full gate — Gitleaks, the dependency audit, end-to-end tests and the integrity check — not to the
  // lighter subset. If this ever flips, the required check silently becomes weaker than it looks.
  assert.ok(checkNames("control-center-ci.yml").includes("verify"), "control-center-ci.yml must emit `verify`");
  assert.equal(checkNames("ci.yml").includes("verify"), false, "the lighter workflow must not also emit `verify`");
  const comprehensive = fs.readFileSync(path.join(workflows, "control-center-ci.yml"), "utf8");
  for (const marker of ["Gitleaks", "npm audit", "playwright", "Verify tracked repository integrity"]) {
    assert.ok(comprehensive.toLowerCase().includes(marker.toLowerCase()), `the workflow owning \`verify\` must still run ${marker}`);
  }
});
