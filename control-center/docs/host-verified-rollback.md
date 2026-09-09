# The host-verified rollback

## What it is for

The deployer normally requires the rollback target to be an attested release: its bundle verified, its
images pulled from the registry with their own attestations, a Forge build document binding both, and a
schema rehearsal that exercised the exact candidate-and-rollback pair.

The first deployment onto a host whose current release predates all of that cannot satisfy any of it.
On this target the live release:

- **cannot be rebuilt** — `apps/web/Dockerfile.admin` entered the repository only on 2026-09-04, so no
  rehearsal can produce it and no rehearsal can name it;
- **has no Forge build document** — it predates Forge entirely;
- **has images that were built on the box and never pushed**, so they carry no registry digest and no
  image attestation;
- **carries no production Compose file at all** — its tree has `docker-compose.staging.yml` and nothing
  else, so there is nothing in it to run a rollback from.

That is a deadlock, not a gap in diligence. The deployer also requires the plan's rollback to be the
release the `current` pointer already resolves to, so the rehearsable pair is not deployable until one
of its halves is already live, and it cannot become live without a deployment.

`rollback.evidence: "host-verified"` breaks the deadlock for that first deployment only. **Nothing on the
candidate side is relaxed.**

## What it establishes instead

One thing, and it is measured rather than declared: **the rollback target is the exact set of artefacts
that were serving.** The plan does not get to say what the rollback consists of, so there is nothing
there for a wrong or hostile plan to name.

| Established | How |
|---|---|
| the rollback release tree is what its attested bundle says | compared in place against the bundle, which is attested even for this release |
| the predecessor images are the ones that were serving | read from the containers themselves, by Compose label or by the published port they hold |
| each service resolves to exactly one predecessor | zero or several is a refusal, never a guess |
| the predecessor is not already the candidate | compared as local image ids, which is what both sides actually are |

The tree is **verified where it stands and never reinstalled**. Reinstalling it would rewrite the live
release directory during preparation, before any mutation is authorised, to make it match something it
is already expected to match. Two files that were written into production outside any release are
tolerated by exact path, because the running admin image is built from them; anything else that differs
is a refusal.

The predecessor measurement reads **stopped containers too**, and that is not an oversight. The unmanaged
admin container has to be stopped before this deployment can run at all, or it still holds the port the
admin service publishes and the conflict check refuses. So by the time the predecessor is measured, the
one container that can say what admin was running is already stopped.

## What it does not establish

These are written into the rollback-ready record rather than left to be inferred.

- **Not attested.** The rollback images were built on the host and never pushed. They have no registry
  digest, no image attestation, and no Forge document binding them to a source tree.
- **Not rehearsed.** The schema rehearsal covers the candidate against a rebuildable predecessor of its
  own lineage. It says nothing about the release actually being replaced.
- **Not its own Compose file.** The rollback runs the *candidate's* Compose file with the predecessor's
  images, because the rollback release carries none. That restores the code that was serving under the
  service definitions of the release being rolled back *from*, which is a real difference and the reason
  this mode is for a first deployment rather than a general capability.

## What is still unresolved

Two things an independent review named that this does not fix, recorded rather than closed.

**The predecessor is identified by uniqueness, not by identity.** A container is matched by Compose
label first and by published port second, and exactly one match is required. That rejects ambiguity
within the matching method; it does not prove the match is the container that was serving. A stopped
container from an older release carrying the same labels would win over the retained one. The stronger
binding available is the adoption record's immutable container id, which names the object a person
actually reviewed, and this does not yet use it.

**The rollback restores images, not a runtime.** It runs the candidate's Compose file, which supplies
the candidate's environment, mounts, healthchecks and edge configuration to the predecessor's images.
Where those differ, rollback can fail for reasons unrelated to the images. The `edge` service is not
measured at all: both directions use the plan's edge image, so the predecessor edge is not restored.

Neither is a reason the policy exception is wrong. Both are reasons to treat the first deployment as
attended, with someone watching, rather than as a routine one.

## When not to use it

Once the host is running an attested release with registry images and a production Compose file of its
own — which is true immediately after the first successful deployment — use `"attested"`. There is no
default: a plan has to say which mode it is, because defaulting would silently pick one, and the one it
picked would be the weaker of the two on any plan that forgot to say.
