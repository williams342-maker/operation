# The host-verified rollback

## What it is for

The deployer normally requires the rollback target to be an attested release: its bundle verified, its
images pulled from the registry with their own attestations, a Forge build document binding both, and a
schema rehearsal that exercised the exact candidate-and-rollback pair.

The first deployment onto a host whose current release predates all of that cannot satisfy any of it.
On this target the live release:

- **cannot be rebuilt** — `apps/web/Dockerfile.admin` entered the repository only on 2026-09-04, so no
  rehearsal can produce it and no rehearsal can name it;
- **has no agent artifact** — its manifest predates the field entirely, and its `SHA256SUMS` covers two
  files rather than three;
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

One thing, and it is measured rather than declared: **the rollback target is the set of artefacts that
were serving.** The plan does not name any rollback image; the images come from the host.

The plan does, however, name the **adoption records** — the files written when a person stopped an
unmanaged container — and those records select which container on a published port counts as the
predecessor. So this is not "a plan can name nothing"; it is **operator-authorised predecessor
identity**. Those records are read the way the other trusted inputs are: through a file descriptor,
with the bytes confirmed to come from the file that was inspected, refused if a symlink or not owned by
the caller, and required to sit inside the same protected location as the plan and the evidence.

| Established | How |
|---|---|
| the rollback release tree is what its attested bundle says | compared in place against the bundle, which is attested even for this release |
| the predecessor images are the ones that were serving | read from the containers themselves |
| a Compose-labelled predecessor is the live one | it must be RUNNING and not a one-off; labels outlive every container Compose ever made, `compose run` produces containers carrying them, and this host keeps 97 releases of history |
| a predecessor found by its port is one a person stopped | its id must be named by an adoption record, since the unmanaged container is stopped by then and state cannot tell it from a stale one |
| each service resolves to exactly one predecessor | zero or several is a refusal, never a guess |
| the predecessor is not already the candidate | compared as local image ids, which is what both sides actually are |
| the rollback bundle is whole | checksums, attestation, manifest commit and archive digest, all still required; only the **agent artifact** is optional |

The agent artifact is the one bundle field a host-verified rollback may omit. The agent a deployment
installs is always the **candidate's** — nothing reads a rollback bundle's — so requiring one of a
rollback was a check on a field that is never used. It stays required for every candidate and for an
attested rollback, and an agent artifact that IS declared is still verified, so the option cannot be
used to smuggle in an artifact nothing checks.

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

One thing an independent review named that this does not fix, recorded rather than closed. The other --
that the predecessor was identified by uniqueness rather than identity -- is now closed: a Compose-label
match must also be RUNNING, and a match by published port must be named by an adoption record.

**The rollback restores images, not a runtime.** It runs the candidate's Compose file, which supplies
the candidate's environment, mounts, healthchecks and edge configuration to the predecessor's images.
Where those differ, the rollback can fail for reasons that have nothing to do with the images. The
`edge` service is not measured at all: both directions use the plan's edge image, so the predecessor
edge is not restored.

**One operational limitation that follows.** A service with no published port whose container is stopped
for some unrelated reason cannot be measured: the label path requires running, and the port path has
nothing to match on. That is a refusal rather than a wrong answer, but it is a refusal that will look
surprising, so it is written here rather than discovered at the moment of deployment.

**Attendance does not close this.** Someone watching cannot supply configuration the predecessor images
need and the candidate's Compose file does not provide. The way to close it is to demonstrate that the
recovery configuration actually starts the retained local images -- which does not require rebuilding
anything, only running what is already on the host -- or to provide a separately validated fallback that
restores the previous runtime rather than the previous images. Until one of those exists, this is an
unproven recovery path, not a proven one operated carefully.

## When not to use it

Once the host is running an attested release with registry images and a production Compose file of its
own — which is true immediately after the first successful deployment — use `"attested"`. There is no
default: a plan has to say which mode it is, because defaulting would silently pick one, and the one it
picked would be the weaker of the two on any plan that forgot to say.
