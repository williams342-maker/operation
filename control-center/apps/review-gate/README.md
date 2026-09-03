# Review gate service

**This gate is ADVISORY until the enforcement point is wired and activated.** It records and enforces the
review lifecycle for callers that use it. It prevents nothing for a caller that does not.

That sentence is required to stay here, in `docs/REVIEW_GATE_OPTION_B_DESIGN.md`, and in the `/healthz`
response body until §2.7 activation ships and has been independently reviewed. It is here because ten
rounds of review found this workstream repeatedly describing advisory mechanisms as boundaries.

## What this is

The authority over review records and release attestations, running as its own process with its own
database. The control-center is a client with no privilege beyond its credential: it cannot approve
anything, cannot write authoritative state, and cannot reach this database.

The design, and the six review rounds that shaped it, are in
[`../../docs/REVIEW_GATE_OPTION_B_DESIGN.md`](../../docs/REVIEW_GATE_OPTION_B_DESIGN.md).

## Requirements

- **MongoDB as a replica set.** The gate commits multi-document transactions; a standalone server cannot
  satisfy the invariants in design §8.3. This is a deployment constraint, not a preference.
- Database credentials **exclusive to the gate**. Sharing a user with the control-center would put the
  authority's storage inside the boundary it exists to draw.

## Not in this service

- **No credentials are created by this code.** Principals are provisioned by an operator CLI the owner
  runs, which prints a credential once.
- **The offline owner signing key is untouched.** This gate is a third authorization layer alongside the
  transport envelope and the owner signature; it replaces neither.
