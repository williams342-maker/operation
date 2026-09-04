# Forge chain — parked status, 2026-09-01

**The Forge authority chain is DISABLED, UNCERTIFIED, and parked for human review.** Nothing in it is
enabled, nothing is deployed, and no part of it should be turned on. This document records exactly what
is proven, what is broken, and what has never run — so the next person does not have to re-derive it.

Parked at `a5137860d3f5ab7b0cd582e3b5eb92f3614b812f` (branch `review/forge-chain-20260901`, PR #33).

## Why it is parked

Three independent certification rounds, each returning NO-GO. Every round found an authority hole, and
**each hole was a relocation of the previous one** rather than a new mistake:

| Round | The hole |
|---|---|
| 1 | The operator supplied `verified: true` in an evidence file, and it was believed. |
| 2 | Real cryptography — but the operator supplied both trust anchors as input **paths**. |
| 3 | Anchors came from `loadConfig()`, whose path is `$CONTROL_CENTER_AGENT_CONFIG` or `process.cwd()`. Both belong to the caller. |

Each fix was locally correct and globally insufficient. That track record, rather than any individual
defect, is the reason work stopped here. The remaining items are known and written down below; what is
not known is whether a fourth pass by the same author would introduce a fourth relocation.

**The recommendation is a human security reviewer before any further remediation.**

## What is proven

Verified by test, and independently confirmed across rounds:

- **Canonicalization.** Flat documents with an explicit ordered-field-join digest. Held in all three
  rounds. The `JSON.stringify` replacer idiom used elsewhere in the repo silently drops nested keys —
  two documents differing only in a nested target digest identically — and a regression test reproduces
  that collision before asserting the forge documents avoid it.
- **Sigstore verification against real material.** `apps/agent/test/forgeAttestation.test.ts` runs
  against the genuine published `v0.1.2-operate` bundle, a genuinely signed document, and the real
  Sigstore trusted root. Not fixtures written by the test.
- **The subject binding the library does not make.** `Verifier.verify()` proves the *statement* was
  signed; it does not compare any artifact to it. Corrupted bytes against the real bundle still returned
  success. `subjectCoversDocument()` is the only thing standing between "signed" and "signed **this**",
  and a test named THE TRAP holds it there.
- **Exact SAN matching.** `@sigstore/verify` matches a string policy as an *unanchored regular
  expression*; the policy is now anchored and escaped and the returned identity re-compared for equality.
- **Fixture byte-stability.** `.gitattributes` marks the signed fixtures `-text`; `core.autocrlf`
  had rewritten one and broken verification, which was the verifier working correctly.
- **Replay-marker semantics.** Atomic claim by exclusive creation; only markers created by the current
  invocation are ever released.

## What is broken or unproven

Ordered by what would bite first.

1. ~~**The producer's happy path is probably non-functional.**~~ **FIXED 2026-09-03.** The
   `forge-build-v1` document records the *tag's* commit, while GitHub's SLSA predicate records the
   *dispatch* commit (`github.sha`, usually `main`) -- `actions/checkout` with `ref: <tag>` changes the
   working tree and nothing the attestation will say. A dispatch from `main` with a tag input therefore
   failed `source-commit-mismatch`, fail-closed and correct, which is why the producer had never
   completed a real run.

   Of the two fixes offered, only the first is available: the predicate cannot be told to record the
   checkout. **The `source` step now requires `$GITHUB_SHA` to equal the tag's commit** and refuses
   otherwise, before anything is built or published, naming the failure it prevents and printing the
   correct dispatch command. A regression test asserts the guard and the document's tag-derived commit
   together, since either half alone is useless; it is mutation-tested.

   **This has still never been executed.** The guard makes a successful run *possible*; it does not
   demonstrate one. Running the producer means publishing images, which remains owner-gated.
2. ~~**The evidence package is incomplete.**~~ **FIXED 2026-09-03.** The step named "document and its
   bundle" uploaded only the JSON. The cause was one line: the attest step had **no `id`**, so its
   `bundle-path` output was unreachable and nothing could consume it. A step name is not a guarantee.

   The attest step is now `id: attest_document`, and a collection step copies the bundle to
   `forge-build.attestation.json` beside the document; both are uploaded. The collection step **fails the
   run** if `bundle-path` is empty, missing, or not a parseable Sigstore bundle -- deliberately not
   "upload whatever exists", because a document without its bundle looks like evidence and proves
   nothing, and a truncated bundle would surface on the host as an unexplained verification refusal.
   The check accepts both shapes the agent accepts (a bare bundle and a `{bundle: …}` envelope) and was
   verified against both, plus a non-bundle and an empty file.

   Two regression tests, mutation-tested: removing either the `id` or the bundle from the upload fails
   them. **Still never executed** -- publishing remains owner-gated.
3. **`config.orgId` is empty until enrollment populates it.** Forge evidence therefore fails closed on
   every host today. Correct direction; also means the gate cannot pass anywhere yet.
4. **The human publish gate is unproven.** The workflow names an `image-publish` environment, but
   required reviewers are repository settings. YAML cannot certify a human gate.
5. **Strict inertness is partial.** With no Forge paths supplied the preflight still loads root-owned
   identity and emits `forge: {state: "absent"}` in the report. The mandatory-rollback-override
   regression is fixed; exact `origin/main` behaviour is not restored.
6. **Reports are not literally value-free.** They carry paths, image references, host and database
   names, commands, and nonce values. This predates Forge, but the claim was overstated.

## What has never run

Stated plainly, because a green test suite hides this:

- **The container images have never been built.** No Docker daemon was available. The provenance labels
  are verified by static assertion and by direct shell testing of the guard, not by an actual build.
- **The producer has never executed.** Running it means publishing images, which is owner-gated and
  deliberately not done.
- **The integrated happy path has never completed end to end**, in CI or on a host. Every passing
  integration test injects verified evidence through a test seam; only the *cryptographic* layer has been
  exercised against genuine material.
- **No agent has ever consumed a Forge manifest**, because none exists to consume.

## Where the authority boundary actually lives

For whoever picks this up: the recurring failure was never in the cryptography. It was in *where the
inputs come from*. The rule that finally has to hold, without exception:

> Evidence is input. Trust is not. Every trust anchor and every measured identity must come from a fixed,
> root-owned path — never from the operator-supplied file, never from an environment variable, never
> relative to the working directory, and never through a general-purpose helper that honours any of those.

`loadConfig()` is a correct helper for the agent daemon and was the wrong one here. That distinction is
the whole lesson.

## Related

- Specification: [forge-manifest-spec.md](forge-manifest-spec.md)
- Preflight gate: [beta-deployment-preflight.md](beta-deployment-preflight.md)
- Work order: [handoff-work-order-20260901.md](handoff-work-order-20260901.md) — items W1, W2, W7, W8
  remain open and are independent of this chain.
