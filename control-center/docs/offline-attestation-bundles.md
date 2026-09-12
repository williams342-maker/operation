# Verifying attestations without a credential on the host

`gh attestation verify` fetches the attestation from the GitHub API by default, and that needs a token
even for a public repository. The deployment host would therefore have had to hold a GitHub credential
in order to verify the provenance of artifacts that anyone can read. That is the wrong trade for a
production box, so the deployer can instead verify against **attestation bundles staged beside the
release**.

## What the mode does and does not change

`--bundle` changes only where gh reads the attestation from. Everything it checks is the same: the
Sigstore signature, the certificate identity, the signer workflow, the source commit, the source ref,
and that the subject digest is the artifact in front of it.

Measured against gh 2.100.0 on the deployment host, with no token present, each of these exits
non-zero, and none of them falls back to the API:

| control | result |
| --- | --- |
| a bundle belonging to a different subject | refused |
| a garbage bundle | refused |
| an empty bundle | refused |
| a tampered artifact | refused |
| the wrong signer workflow | refused |
| the wrong source digest | refused |
| the wrong source ref | refused |

## How a bundle is chosen

By the **subject's own digest**, computed from the bytes being verified — never by a path a plan or a
manifest supplies. A bundle for the artifact whose sha256 is `<digest>` is looked up in the plan's
`attestationBundles` directory under the names `gh attestation download` itself writes, in this order:

| platform the bundle was downloaded on | filename |
| --- | --- |
| Linux, macOS | `sha256:<digest>.jsonl` |
| Windows, where a colon cannot appear in a filename | `sha256-<digest>.jsonl` |

Both are accepted, because the machine that holds a credential and the machine that deploys are
routinely different platforms. Accepting both widens nothing: each name encodes the same digest, and gh
still has to find that subject inside whichever file it is handed. A file that is present under one of
those names but is not a regular file is a refusal, not a reason to try the other spelling.

An absent bundle is an error. Falling back to the API would mean the mode that exists to avoid needing
a credential quietly requires one at the moment it is used.

## Producing the bundles

Run this where a GitHub credential already exists — a workstation or CI, never the deployment host —
once per release, for the three bundle files, the Forge build document, the rehearsal evidence, and each
of the four images:

```
gh attestation download <file> --repo williams342-maker/operation
gh attestation download oci://<image>@sha256:<digest> --repo williams342-maker/operation
```

Copy the resulting `sha256:*.jsonl` files (or `sha256-*.jsonl`, if they were downloaded on Windows)
into the plan's `attestationBundles` directory on the host, under the names gh gave them.

## Where they live

`attestationBundles` is optional. A plan without it behaves exactly as before and verifies against the
API. A production plan that has it must place it inside the deployer's trusted inbox, root-owned and
not writable by anyone else.

That location is defence in depth, and deliberately not the thing that makes bundles safe. A substituted
bundle cannot produce a false pass: it would have to carry a Sigstore signature over this subject digest
from this workflow at this commit. What the trusted location buys is that only root can cause a
*refusal*, so an unprivileged writer cannot deny a deployment by deleting a file.

## Release identity, and why a deployment is not verified by a 200

Readiness asks whether something answers. It cannot tell a new release from the one it replaced, so a
plan must also name an `identityEndpoint`, and the deployer requires the service there to report the
commit it just deployed, from a release manifest rather than from environment variables.

The manifest is installed beside the release tree and mounted read-only. The path travels in the
environment of each `up`, so a rollback mounts the PREDECESSOR's manifest: this target runs the
candidate's Compose file in both directions, and a release-relative mount would have made a rolled-back
service confidently report the version it had just failed to become.

A live rollback release is never written to. Its manifest must already be present and match the verified
bundle byte for byte, which is also what binds that directory to the release the plan says it is.

## Deploying without replacing the agent

A plan must say, in so many words, whether it installs the candidate's agent (`agent: "install"`) or
leaves the one already running alone (`agent: "unchanged"`). There is no default: whether a deployment
replaces the privileged component that executes tasks on this host is not something a plan should be
able to leave unsaid.

`unchanged` exists because the two lines are coupled only by this tool. Every agent built since Forge
landed calls `validateForgeRuntimeIdentity` at startup and refuses to run without owner-signed material
in `/etc/opsworkbench-forge`, which this target has never had. Activating it therefore turned each
control-center upgrade into a deployment that failed at the last step and rolled itself back, twice. The
api, web and admin services do not depend on that material.

Under `unchanged` the installer is not run at all — not even to take a snapshot, because a rollback
target recorded for a component nothing touches is a record that lies quietly. The rollback-ready record
carries an agent entry saying it was not installed, what is running instead, and the limit that follows:
the schema rehearsal exercises the application against the database, not an older agent against a newer
release.
