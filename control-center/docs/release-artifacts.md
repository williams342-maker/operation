# Deterministic deployment artifacts

The Control Center Release workflow packages future annotated semantic-version prerelease tags such as v0.10.0-beta.1. It never packages the mutable working tree and does not use GitHub's generated source archives as deployment artifacts.

The workflow:

1. checks out the exact annotated tag with complete tag history;
2. checksum-verifies Gitleaks 8.30.1 and scans the exact tracked tree with redacted output;
3. installs the locked dependency graph and runs the audit, tests, type checks, lint, and workspace builds;
4. creates the deployment bundle twice and requires byte-for-byte equality;
5. writes a commit- and tag-bound JSON manifest plus SHA256SUMS;
6. creates GitHub keyless build-provenance attestations for every published file;
7. uploads the files as workflow artifacts; and
8. creates a draft prerelease and attaches the reviewed files before a human publishes the immutable release.

The custom bundle contains only the tracked control-center path at the tagged commit, under a versioned top-level directory. Git archive supplies commit-stable metadata and gzip -n -9 removes variable gzip timestamps and names.

## Local reproducibility check

Run from control-center while HEAD is exactly an annotated prerelease tag:

    npm run release:verify

The command builds in two temporary directories, compares the bundles and manifests byte for byte, and verifies both checksums.

## Release review

Before publishing the draft:

- confirm the tag is annotated, immutable, and resolves to the intended validated commit;
- confirm the release workflow completed without skips;
- review SHA256SUMS and the manifest;
- verify the attestation and checksums:

      gh attestation verify opsworkbench-control-center-<version>.tar.gz --repo williams342-maker/operation
      sha256sum --check SHA256SUMS

- confirm the bundle contains no environment files, logs, caches, databases, dependency directories, local reports, or credentials; and
- publish only after release notes and staging restrictions are approved.

The release remains a deployment input, not deployment authorization. Production deployment requires a separate decision and evidence package.
