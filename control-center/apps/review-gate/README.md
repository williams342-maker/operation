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

## Configuration

`REVIEW_GATE_MONGO_URL` and `REVIEW_GATE_DB_NAME` are required; `REVIEW_GATE_PORT` (3100) and
`REVIEW_GATE_BIND` (127.0.0.1 — this is not a public service) have defaults.

One optional knob is worth a paragraph rather than a line:

- **`REVIEW_GATE_INITIAL_EXECUTION_MS`** — the execution window `acquire` grants an attempt up front,
  in milliseconds. Default 10 minutes. Leave it unset unless a deployment genuinely needs a different
  one, and note that it is **not** the bound on how long an attempt may run: that is a separate,
  deliberately longer absolute cap of 30 minutes, which an executor reaches by *extending* while the
  effect is still going.

  The two must differ. If the initial window reaches the cap, an extension has no value it can legally
  request, so the whole extension path dies — silently, and visible only as `deadline_not_extended` at
  the far end of a real execution. An independent review found exactly that when the two were the same
  constant, so the service now **refuses to start** on a value at or above the cap rather than trusting
  the setting to be sane. The cap itself is not configurable: raising it would grant an attempt more
  cumulative time than the model was reviewed for.

  When it is set, the value is logged at start, because an unexpected window is the first thing worth
  knowing when extensions begin to be refused.

## Not in this service

- **No credentials are created by this code.** Principals are provisioned by an operator CLI the owner
  runs, which prints a credential once.
- **The offline owner signing key is untouched.** This gate is a third authorization layer alongside the
  transport envelope and the owner signature; it replaces neither.
