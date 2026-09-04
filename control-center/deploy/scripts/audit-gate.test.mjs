import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "./audit-gate.mjs";

/** The shape npm 11 emits for a report that ran. */
const report = (over = {}) => ({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...over },
    dependencies: { prod: 100, dev: 200, total: 300 },
  },
});

test("a clean report passes, and says what it found", () => {
  const decision = decide(report());
  assert.equal(decision.ok, true);
  assert.equal(decision.outcome, "clean");
  assert.match(decision.summary, /no advisories/);
});

test("advisories below the threshold do not block, and are still reported", () => {
  // The tree currently carries three moderate advisories. They must not fail the gate, and they must
  // not vanish from the output either -- a gate that hides what it saw teaches people to ignore it.
  const decision = decide(report({ moderate: 3, total: 3 }));
  assert.equal(decision.ok, true);
  assert.match(decision.summary, /3 moderate/);
});

test("high and critical advisories block", () => {
  for (const over of [{ high: 1, total: 1 }, { critical: 1, total: 1 }, { high: 2, critical: 1, total: 3 }]) {
    const decision = decide(report(over));
    assert.equal(decision.ok, false, JSON.stringify(over));
    assert.equal(decision.outcome, "vulnerable");
  }
  assert.match(decide(report({ high: 2, critical: 1, total: 3 })).summary, /1 critical, 2 high/);
});

test("A TRANSPORT FAILURE IS NEVER A PASS, and is not reported as a vulnerability", () => {
  // The exact shape npm emits when the registry refuses or is unreachable. Reading this as "no
  // vulnerabilities found" is the single outcome that would make the gate worse than not having one.
  const transport = {
    message: "request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED",
    error: { summary: "", detail: "" },
  };
  const decision = decide(transport);
  assert.equal(decision.ok, false);
  assert.equal(decision.outcome, "did-not-run",
    "an unreachable registry must be distinguishable from a real finding");
  assert.match(decision.summary, /did not run/);
});

test("the retiring quick endpoint's 400 is also 'did not run'", () => {
  // What actually turned `verify` red on main: npm 10 posts to /security/audits/quick, which npm is
  // retiring, and the registry answered 400. It read like a dependency regression and was not one.
  const decision = decide({
    message: "400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick",
    error: { summary: "Invalid package tree", detail: "" },
  });
  assert.equal(decision.outcome, "did-not-run");
  assert.equal(decision.ok, false);
});

test("an unparseable or empty report is 'did not run', never a pass", () => {
  for (const bad of [null, undefined, "", 0, [], "not json"]) {
    const decision = decide(bad);
    assert.equal(decision.ok, false, JSON.stringify(bad));
    assert.equal(decision.outcome, "did-not-run");
  }
});

test("a report whose counts are unreadable does not pass", () => {
  // Defends the arithmetic itself: a malformed count must not coerce to zero and read as clean.
  const decision = decide({ metadata: { vulnerabilities: { high: "lots", critical: 0 } } });
  assert.equal(decision.ok, false);
  assert.equal(decision.outcome, "did-not-run");
});

test("metadata present but vulnerabilities missing is 'did not run'", () => {
  const decision = decide({ metadata: { dependencies: { total: 10 } } });
  assert.equal(decision.ok, false);
  assert.equal(decision.outcome, "did-not-run");
});
