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
manifest supplies. A bundle for the artifact whose sha256 is `<digest>` is the file
`sha256-<digest>.jsonl` in the plan's `attestationBundles` directory. That is the name
`gh attestation download` already writes, so the producing side needs no extra tooling.

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

Copy the resulting `sha256-*.jsonl` files into the plan's `attestationBundles` directory on the host.

## Where they live

`attestationBundles` is optional. A plan without it behaves exactly as before and verifies against the
API. A production plan that has it must place it inside the deployer's trusted inbox, root-owned and
not writable by anyone else.

That location is defence in depth, and deliberately not the thing that makes bundles safe. A substituted
bundle cannot produce a false pass: it would have to carry a Sigstore signature over this subject digest
from this workflow at this commit. What the trusted location buys is that only root can cause a
*refusal*, so an unprivileged writer cannot deny a deployment by deleting a file.
