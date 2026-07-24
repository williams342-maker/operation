# Agent bootstrap release signing

The bootstrap release uses Ed25519 detached signatures. The private key is an owner-controlled offline secret and must never enter this repository, CI variables, the control-center database, artifact storage, or a target server. Targets receive only the independently provisioned public key. Its identifier is `ed25519-` followed by the first 24 hexadecimal characters of the SHA-256 digest of its DER-encoded SPKI public key.

## Owner signing ceremony

1. Review the clean source commit, proposed release descriptor, builder, installer, rollback script, SBOM, and validation results.
2. Build from a clean checkout at the reviewed commit with `npm run agent-bootstrap:build`.
3. In an offline signing environment, make the owner-managed Ed25519 private/public key files available by path and set an owner-approved HTTPS artifact URL. Do not paste key material into a command, environment value, terminal, ticket, or log.
4. Sign with file paths only:

   ```sh
   BOOTSTRAP_OUTPUT_DIR=/protected/release-output \
   BOOTSTRAP_SIGNING_PRIVATE_KEY_FILE=/protected/offline/agent-release-private.pem \
   BOOTSTRAP_SIGNING_PUBLIC_KEY_FILE=/protected/offline/agent-release-public.pem \
   BOOTSTRAP_ARTIFACT_URL=https://OWNER_APPROVED_HOST/OWNER_APPROVED_PATH/opsworkbench-agent-0.10.0-beta.1-linux-x64.tar.gz \
   BOOTSTRAP_PUBLICATION_STATUS=draft \
   npm run agent-bootstrap:sign
   ```

5. Verify on a separate machine with only the public key: `BOOTSTRAP_OUTPUT_DIR=/protected/release-output BOOTSTRAP_SIGNING_PUBLIC_KEY_FILE=/protected/offline/agent-release-public.pem npm run agent-bootstrap:verify`.
6. Compare `SHA256SUMS`, the manifest digest, source commit, key identifier, artifact URL, and SBOM to the approved review record. A draft is test-only. Re-sign a reviewed artifact set as `published` only after the Linux staging gates pass and owner approval is recorded.

The signing script refuses non-Ed25519 or mismatched keys and never copies the private key. Output logs contain only public identifiers and hashes. The disposable test key used by automated validation is generated outside Git and deleted; it is not valid publication authority.

## Public-key distribution, rotation, and revocation

Provision the reviewed public key to `/etc/opsworkbench-agent/trusted-release-keys/<key-id>.pem` through the approved secret/configuration mechanism before running bootstrap. Do not trust the public key downloaded beside the artifacts: that copy is informational and is verified against the already trusted key.

For routine rotation, distribute the new public key out of band, publish an overlap catalog signed by an already trusted key, confirm fleet trust inventory, then retire the old key. For compromise, mark affected releases revoked, remove publication, pause rollouts, distribute a replacement public key out of band, and require a new owner-approved release. Never silently reuse a key identifier or overwrite a release artifact in place.

## Publication gates

Publication requires all repository tests, reproducible-build comparison, signature/tamper checks, secret scan, disposable Debian/Ubuntu x86_64 systemd install, idempotent reinstall, reboot/reconnect, failure rollback, and owner review. On a Linux Docker host, run `npm run agent-bootstrap:test-linux`; the harness generates an ephemeral signing key outside its served artifact directory, deletes it after signing, installs only into a privileged throwaway Debian container, restarts that container, verifies idempotency, and exercises both explicit and validation-failure rollback. Set `BOOTSTRAP_OUTPUT_DIR` only when reusing an existing disposable signed output directory. This is test evidence only and cannot replace owner signing or artifact publication. Artifact hosting, Cloudflare machine-access policy, production signing-key custody, retention, monitoring, and any production/canary execution remain separate owner actions.
