# Forge runtime identity: the remediation, the runbooks, and the residual

Branch `feat/forge-ceremony-kit` (PR #82). This document exists because a human security review returned
NO-GO on the runtime identity check and required three repairs. It records what each repair changed, how
to run the two operator procedures the repair introduced, and the one trust dependency that was
deliberately left in place with the reviewer's agreement.

**Production was not modified by any of this.** The production host remains on v0.1.15-operate with the
July agent, which contains none of this code. Nothing here has been applied to a production
configuration, and no Forge material has been minted.

## 1. What was wrong

The runtime identity check compared an owner-signed Forge identity document against the organisation and
server this agent belongs to. The problem was where those two values came from.

- **The control plane supplied them.** The agent learned `orgId` and `serverId` from poll responses and
  wrote them to its configuration. Whoever controls the control plane therefore chooses which
  owner-signed identity a host will accept, which makes the owner's signature decorative.
- **The signed document supplied them.** Where the control plane had not, the agent adopted the values
  out of the identity document it was about to validate. A document that supplies the value it is then
  compared against is a check comparing a thing to itself.

Both paths were mine, added to make the check satisfiable on a host that had never been provisioned. They
made it satisfiable by removing what it was checking.

## 2. Repair 1 — the control plane establishes nothing

`learnRuntimeIdentity`, `adoptRuntimeIdentity`, `establishRuntimeIdentity` and `startupIdentity` are gone
from `apps/agent/src/agent.ts`. The poll response type no longer carries an identity field, and the API's
poll handler in `apps/api/src/routes.ts` no longer sends `orgId`; a comment there forbids the field
regrowing. `main()` now calls `validateForgeRuntimeIdentity(config)` and nothing else.

The check fails closed. An absent or empty `orgId` or `serverId` is a refusal to start, with a message
that distinguishes "never provisioned" from "handed somebody else's document", because those need
different actions at the ceremony.

Held by `apps/agent/test/runtimeIdentity.test.ts` and `apps/agent/test/pollIdentity.test.ts`. The second
drives the real `pollOnce()` against a mocked client and asserts the configuration **file** is unchanged
afterwards, rather than asserting on an in-memory object the implementation could bypass.

## 3. Repair 2 — the organisation is provisioned, not bootstrapped

`orgId` now has exactly one source: an operator writing it into the protected local agent configuration,
once, with the ceremony's other evidence in front of them. The tool is
`scripts/provision-agent-organisation.mjs`. It does not sign, install or read Forge material, and it does
not contact the control plane.

### Provisioning runbook

**Confirm the path first.** The service is started with `CONTROL_CENTER_AGENT_CONFIG`, and on a host built
by this repository's own tooling that is `/etc/opsworkbench-agent/agent.json`. An earlier draft of this
document said `agent.local.json`, which is only the development fallback used when the variable is unset:
following it would have refused on a correctly built host, or, where both files existed, provisioned the
one the agent does not read. Ask the unit rather than this page, with `systemctl show opsworkbench-agent
-p Environment`, and use what comes back.

As root over a configuration the agent account owns, which is the usual case, add `--expect-owner` naming
the account in the unit's `User=`. Without it the tool accepts only a file owned by root or by whoever is
running, and refuses the very case the ownership restoration exists for.

```
node scripts/provision-agent-organisation.mjs \
  --config /etc/opsworkbench-agent/agent.json \
  --org <24-hex organisation id>
```

It prints the path, the organisation, the backup path, the resulting mode and owner, and the SHA-256 of
the configuration before and after. Record that output; it is the evidence the step happened.

Behaviour worth knowing before you run it:

- **The configuration must already be protected, and provisioning refuses if it is not.** Not writable by
  group or other; not a symbolic link; no directory above it writable by group or other unless it is
  sticky, and none of them belonging to a third account, because a directory's owner may replace what is
  in it whatever the mode says and the sticky bit exempts the owner rather than binding them. The tree
  that gets checked is the file's real one, since a link in the middle of a path hides the ancestry that
  matters. A trust anchor any local user can rewrite afterwards is not one, and the earliest version
  happily preserved a mode of 0666. The agent applies the same rules when it loads, and reads through the
  descriptor it checked, so a replacement at the name cannot be handed back as the answer.
- **Ownership is stated rather than guessed.** Without `--expect-owner` the file must belong to root or to
  whoever is running the tool. With it, the file must belong to the named account, and a mismatch is a
  refusal. The flag exists because the supported workflow is root provisioning a file the agent owns, and
  a rule of "root or me" refuses precisely that case when "me" is root.
- **The backup is written and flushed before the configuration is touched.** The way out exists before
  the way in.
- **Owner and mode are carried over from the file being replaced.** A replacement is a new inode. Run as
  root over an agent-owned configuration without this, provisioning produces a root-owned file the
  service cannot read: an outage dressed as a provisioning step. A `chown` that cannot be performed is a
  loud failure, not a shrug.
- **Only the organisation changes.** After the write, every other field is compared against what was
  there and the field count is checked. The other trust identifier lives in this same file.
- **An organisation already set is not silently replaced.** Pass `--replacing <current value>` to state
  that you mean it. Re-provisioning the same value is a no-op and does not write a second backup.
- **One lock covers both verbs**, at `<config>.provisioning-lock`, released however the process exits. A
  rollback cannot run inside a provisioning.

### Exact rollback

```
node scripts/provision-agent-organisation.mjs \
  --config /etc/opsworkbench-agent/agent.json \
  --rollback
```

This restores the exact bytes of the backup, with the file's owner and mode, and prints their SHA-256. It
never reconstructs a configuration from what it thinks it knows: if the backup is missing it refuses.
Restart the agent afterwards; the configuration is read at startup.

Held by `apps/agent/test/organisationProvisioning.test.ts`.

## 4. Repair 3 — the signing tool rejects control characters

`scripts/sign-forge-security-identity.mjs` validates **type first, then content**, for every field of the
unsigned document:

- a field that is not a string is refused before anything else looks at it;
- a field containing a control character is refused;
- an empty field is refused.

Type first because the statement is built by joining the fields with newlines. A field that is an array
or an object stringifies on the way in, so a string-only sweep let one past and produced a
cryptographically valid signature over a statement carrying an injected newline. The loader would have
refused that document, but a signer that signs it is a signer that lies.

`scripts/build-forge-security-identity.mjs` applies the same rules when assembling the unsigned document,
so a malformed field is caught before a key is ever unlocked.

Held by `apps/agent/test/forgeCeremony.test.ts`, which runs an end-to-end ceremony with a throwaway key.

## 5. The residual: enrolment supplies the server id

The server id still arrives from enrolment, which is a control-plane interaction. The human security
reviewer decided not to require its removal in this repair, and asked for the dependency to be analysed,
documented and classified. This is that record.

**Classification: a denial-of-service trust dependency. Not a path to unauthorized identity acceptance.**

The analysis. Suppose a hostile or compromised control plane returns a server id of its choosing at
enrolment. The value lands in the agent's configuration and is compared, by equality, against the server
id in the owner-signed identity document on disk.

- If the values differ, `validateForgeRuntimeIdentity` throws and the agent refuses to start. That is the
  whole effect: the attacker can stop this host working. They cannot make it accept anything.
- The attacker cannot instead choose a value that matches some *other* host's document, because the
  document is not theirs to place. Forge material lives at `/etc/opsworkbench-forge`, root-owned, mode
  0444, no symlinks and no bind mounts, and `loadForgeSecurityMaterial` enforces that. An attacker who
  can write there already has root on the host and does not need this path.
- The substituted document would also have to satisfy two bindings the control plane has no influence
  over: the identity binds the host's hostname and the SHA-256 of its machine id, and both are checked
  against the running host before the organisation and server are compared at all. It binds the digests
  of the Sigstore trusted root and the review-gate CA too, and carries a validity window. Those bindings
  raise the cost for an attacker who is not root. They are **not** a defence against root. An earlier
  draft of this section said "even with root", which was simply wrong: root can set the hostname, rewrite
  the machine id, or replace the verifier outright. Nothing in the agent defends against root, and this
  document should not have implied otherwise.
- Enrolment now **establishes but never replaces**. A host that already has a server id and is handed a
  different one at enrolment refuses, loudly, rather than silently pointing itself at another server. So
  the window in which the control plane has any influence is one enrolment, on a host that has never had
  a server id.

Two tests hold this. The runtime identity suite proves a mismatched server id causes a refusal rather
than a substitution or an acceptance. The enrolment path throws on a conflicting value, with a message
telling the operator to provision deliberately if the host really has moved.

**Open to the independent reviewer.** If a path is found from enrolment's server id to *acceptance* of an
identity the owner did not intend for this host, this classification is wrong and the server id should be
provisioned the same way the organisation now is. The provisioning tool would need one more flag; nothing
else in the design would have to move.

## 6. What is still owner-only, before any of this can be used

None of the following has been done, and none of it can be done without the owner:

1. **Choose the Sigstore trusted root and the review-gate CA.** The identity binds both digests, so both
   must be decided before anything is signed. Signing first and choosing after means signing again.
2. **The key ceremony itself.** The owner holds the Forge owner private key offline. The pinned public
   key must be the one that key produces.
3. **Installing material on a host**, and provisioning the organisation into that host's agent
   configuration.
4. **Review-gate executor activation**, which remains a separate owner decision and is recommended
   inactive until an agent carrying the enforcement code is actually running. The July agent in
   production carries none of it.

## 7. Review history

- Human security review: NO-GO on 8d8e49fb, three required repairs. Those are sections 2, 3 and 4 above.
- Independent review, round 1 of the remediation: NO-GO, five findings. Signer validation bypassable by a
  non-string field; provisioning did not restore ownership; the lock did not cover both verbs; enrolment
  overwrote an established server id; two tests asserted less than they claimed. All five are fixed in
  34e93050.
- Independent review, round 2 of the remediation: NO-GO, five findings, all real and all fixed.
  - **High.** Nothing enforced the protected half of "independently protected local input". Provisioning
    preserved a mode of 0666 and loading never looked, so any local user rewrote both identifiers and the
    agent accepted them, defeating the repair without forging anything. Both the tool and `loadConfig`
    now require the file and its ancestry to be closed to other writers.
  - **Medium.** Enrolment read the configuration, awaited the network, and saved that stale snapshot. A
    provisioning landing inside the await was erased, so a control plane choosing when to answer chose
    whether provisioning survived. The read-modify-write now happens inside the provisioning tool's own
    lock.
  - **Medium.** The ownership test could not fail: fixture and replacement were owned by the same
    account, so deleting the restoration entirely left every provisioning test green. A umask fixture now
    discriminates the mode half without root. The ownership half does not skip: given root it hands the
    fixture to another account and asks the real question, and given an unprivileged runner it degrades
    to "the owner did not change". An earlier version of this line claimed a skipping test existed, which
    was wrong, and was the wrong thing to want.
  - **Medium.** The enrolment guard had no test. Removing it and writing the returned server id straight
    through left every runtime-identity and poll-identity test green.
  - **Low.** The control-character predicate stopped at U+007F, so U+0085 NEXT LINE signed cleanly. It
    now covers the C1 range and the Unicode line and paragraph separators.
- Independent review, round 3 of the remediation: NO-GO, four findings, all real and all fixed.
  - **High.** The protection check could still be walked around three ways: ancestor OWNERSHIP was never
    checked, so an attacker-owned 0755 directory passed although its owner may replace what is in it; the
    path was measured as written, so a configuration reached through a symlink hid the ancestry that
    mattered; and the check and the read were two separate lookups, so a replacement in between was
    handed back as the answer. The path is now resolved, a symlinked configuration is refused, ancestors
    are checked for owner as well as mode, and the file is opened once with every question after that
    asked of the descriptor.
  - **Medium.** The first ownership rule locked the tool out of its own supported workflow: root
    provisioning an agent-owned file failed, which is exactly the case the ownership restoration exists
    for. `--expect-owner` now lets the operator state the account.
  - **Medium.** Both runbook commands named `agent.local.json`, which is the development fallback. The
    service is started on `agent.json`. Corrected, with an instruction to ask the unit rather than this
    page.
  - **Low.** "Even with root" overstated the hostname and machine-id bindings. Corrected above.
- Independent review, round 4: in progress.
- The human reviewer's NO-GO stands until they say otherwise. An independent GO does not lift it.
