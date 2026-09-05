# PR #66 — protocol and identity lifetime remediation

The follow-up review of `c144ca58` found two regressions: accepted uppercase HTTPS URLs bypassed the
owner-bound CA, and loopback HTTP skipped continuing host-identity validation after startup.

Every enforcing `reviewEnforcement()` invocation now calls `validateForgeRuntimeIdentity()`, including
the poll and effect paths. Only CA attachment depends on `new URL(url).protocol`. The gate client's
independent missing-CA refusal uses the parsed protocol too. Disabled enforcement is unchanged.

The fixed-path verifier remains the production loader. There is no new environment variable, loader
argument, fixture path or `NODE_ENV` branch in the production trust path. Provisioning valid signed
material before deploying the agent remains necessary; these changes do not provision or activate it.

## Test boundary

The executor choreography tests now use Node's test-runner module mocking to supply a fixture host
identity before the agent module is imported. They explicitly populate matching org/server identifiers
in the runtime config. They continue to use real gate/API requests, credentials, signatures, durable
enforcement, acquisition, execution and settlement. The fixture loader does not verify a real owner
signature or the host filesystem; those remain covered by the separate, unmocked security-identity suite.

`fixtureForgeSecurity.ts` is test-only. The test entry points explicitly enable
`--experimental-test-module-mocks`; production entry points do not. This is supported by Node 22's test
runner. It also allows choreography to run without an owner's offline private key in CI.

Two new tests verify repeated loading and failure propagation after an initially successful invocation,
and rejection of a changed org/server identity on loopback. Existing unmocked enforcement/client tests
now include uppercase, mixed-case and whitespace-normalized HTTPS spellings, and reject missing
loopback identity. The lifetime test supplies the verifier's expiry refusal through the test loader;
the real verifier's validity-window tests remain responsible for detecting expiry itself.

Expected counts increase by exactly two: agent 150→152, quick 436→438, full Linux 728→730. Skip
expectations do not change. Ordinary CI and deployment readiness remain separate verdicts.

Owner authorization to proceed and the waiver of an additional human security reviewer remain in force.
Neither is represented as an independent review of this new implementation.
