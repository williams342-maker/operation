/* global process */
/**
 * Decide the dependency-audit gate from an `npm audit --json` report.
 *
 * WHY THIS EXISTS RATHER THAN `npm audit --audit-level=high`.
 *
 * That command conflates two outcomes that must never be confused:
 *
 *   1. the audit ran and found a high or critical advisory  -> the gate should be RED;
 *   2. the audit could not run at all                       -> the gate should be red for a DIFFERENT
 *                                                              reason, and say so.
 *
 * Both exited 1, with the second's explanation buried in an `npm warn` line. On 2026-09-03 that cost a
 * real diagnosis: `verify` went red on `main` at a commit that had passed an hour earlier, and the
 * failure read like a dependency regression. It was `400 Bad Request` from
 * `/-/npm/v1/security/audits/quick` -- the endpoint npm 10 uses and npm is retiring. npm 11 queries
 * `/-/npm/v1/security/advisories/bulk` instead, which is why the same tree audits cleanly under it.
 *
 * A 503 from the registry produced the same red. So the gate's colour depended on a third-party
 * service's availability -- the same defect class as a test suite pointed at someone else's deployment,
 * and it deserves the same answer: the gate reports what it actually established.
 *
 * WHAT THIS DOES NOT DO: it never passes when the audit did not run. "Could not reach the registry" is a
 * refusal, not a pass. A missing result is not zero -- the backend quarantine gate learned that the
 * expensive way, and the rule is the same here.
 */

/** @typedef {{ ok: boolean, outcome: "clean" | "vulnerable" | "did-not-run", summary: string }} Decision */

const BLOCKING = ["critical", "high"];

/**
 * @param {unknown} report Parsed `npm audit --json` output.
 * @returns {Decision}
 */
export function decide(report) {
  if (report === null || typeof report !== "object") {
    return { ok: false, outcome: "did-not-run", summary: "the audit produced no parseable report" };
  }
  const counts = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, any>} */ (report).metadata?.vulnerabilities);

  // A transport failure yields `{ message, error }` and no `metadata`. Treating that as "no
  // vulnerabilities found" is the one outcome that would make this gate worse than useless.
  if (counts === undefined || counts === null || typeof counts !== "object") {
    const message = typeof (/** @type {Record<string, any>} */ (report).message) === "string"
      ? /** @type {Record<string, any>} */ (report).message
      : "no vulnerability counts in the report";
    return { ok: false, outcome: "did-not-run", summary: `the audit did not run: ${message}` };
  }

  const blocking = [];
  for (const severity of BLOCKING) {
    const n = Number(/** @type {Record<string, unknown>} */ (counts)[severity] ?? 0);
    if (!Number.isFinite(n)) {
      return { ok: false, outcome: "did-not-run", summary: `unreadable ${severity} count` };
    }
    if (n > 0) blocking.push(`${n} ${severity}`);
  }
  if (blocking.length > 0) {
    return { ok: false, outcome: "vulnerable", summary: `blocking advisories: ${blocking.join(", ")}` };
  }

  const reported = Object.entries(/** @type {Record<string, unknown>} */ (counts))
    .filter(([name, n]) => name !== "total" && Number(n) > 0)
    .map(([name, n]) => `${n} ${name}`)
    .join(", ");
  return {
    ok: true,
    outcome: "clean",
    summary: reported ? `no high or critical advisories (${reported})` : "no advisories",
  };
}

// CLI: `node audit-gate.mjs <report.json>`. Exits 0 only on a report that ran and was clean.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const { readFileSync } = await import("node:fs");
  const path = process.argv[2];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    // Left undefined deliberately: `decide` treats anything unparseable as did-not-run, which is the
    // same refusal an unreachable registry produces, and for the same reason.
    process.stderr.write(`could not read ${path}: ${(error && error.message) || error}\n`);
  }
  const decision = decide(parsed ?? null);
  process.stdout.write(`${decision.outcome.toUpperCase()}: ${decision.summary}\n`);
  // Distinct exit codes so the caller retries only the failure worth retrying. A registry outage is
  // transient; a high advisory is not, and retrying it only delays the same answer.
  //   0 clean   1 vulnerable   2 did not run
  process.exit(decision.outcome === "clean" ? 0 : decision.outcome === "vulnerable" ? 1 : 2);
}
