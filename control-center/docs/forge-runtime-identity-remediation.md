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

## 2. Repair 1 — the control plane's responses establish nothing

*Read this heading together with section 5. Poll responses establish neither identifier; enrolment still establishes
the server id once, and that residual is analysed there rather than hidden behind this heading.*

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
  group or other; not a symbolic link; and no directory above it writable by group or other unless it is
  sticky, nor belonging to an account that is not trusted, because a directory's owner may replace what
  is in it whatever the mode says and the sticky bit exempts the owner rather than binding them. A trust
  anchor any local user can rewrite afterwards is not one, and the earliest version happily preserved a
  mode of 0666. The agent applies the same rules when it loads, and reads through the descriptor it
  checked, so a replacement at the name cannot be handed back as the answer.
- **No component of the path may be a symbolic link.** This rule replaced two cleverer ones that were
  each defeated. Resolving the path and measuring the destination protects the inode and says nothing
  about who chose the inode: a review owned a directory, put a link in it, and swung that link between
  two configurations that were both beyond reproach, getting a different organisation each time. Walking
  the written path as well still missed a link in the MIDDLE of a chain, because resolution reports only
  the far end and `stat` follows the whole thing. A chain of lookups has as many chances to be redirected
  as it has links, and an endpoint check counts none of them. So there is no resolution: every component
  from the root down is measured as it is. On a host where a directory above the configuration is
  legitimately a link, this refuses, and the operator points it at the real path.
- **The path must end in a regular file, and that is checked before anything is opened.** Opening a FIFO
  for reading blocks until somebody writes to the other end, and a device can have effects merely from
  being opened, so nothing is opened until what is at the end of the path is known to be an ordinary
  file. **In the agent**, the order goes further: measure, open, then compare the device and inode numbers
  of the descriptor against what was measured, and read from that descriptor. Every directory above the
  file has just been shown to be trusted, so the argument that nobody untrusted could substitute it in
  between is sound; the comparison makes it a fact instead of an argument, in a place where the argument
  has already been wrong twice. **The tool does not do this** — it checks by path, then reads, writes a
  replacement and renames by path — and an earlier version of this bullet said it did. It takes the lock
  before it checks, and both it and the agent refuse a path with any untrusted component, but if you need
  a descriptor-bound guarantee it is the agent that gives you one.
- **Ownership is stated rather than guessed.** Without `--expect-owner` the file and its directories must
  belong to root or to whoever is running the tool. With it, the file must belong to the named account
  and a mismatch is a refusal, and that account is trusted for the directories too. The flag exists
  because the supported workflow is root provisioning a file the agent owns; a rule of "root or me"
  refuses precisely that case when "me" is root. It covers the tree as well as the file because
  `install.sh` creates the configuration directory with `install -d -m 0750 -o $AGENT_USER`, so on every
  host this repository builds, the directory belongs to the agent too.
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
- **One lock covers both verbs**, at `<config>.provisioning-lock`, taken before the configuration is
  checked and released however the process exits. A rollback cannot run inside a provisioning, and the
  agent's own enrolment takes the same lock.
- **Every file this writes beside the configuration is safe on its own.** The ancestor rule accepts a
  world-writable directory when it is sticky, because sticky stops anybody replacing the configuration —
  but it does not stop them creating files NEXT to it, and this design writes three: the backup, the
  pending replacement and the lock. A review demonstrated the hole end to end: an unprivileged user wrote
  the backup and the operator's own recovery step installed it, choosing both trust identifiers with the
  result passing every protection rule afterwards. The backup is now checked exactly as the configuration
  is and must parse as JSON before it can be restored, and both verbs create their pending replacement
  exclusively AND named from random bytes rather than the process id. Exclusivity alone turned the hole
  into a permanent denial of service: the pid range is small, a review covered all of it as an
  unprivileged user in under a second, and every provisioning, rollback and enrolment then failed for
  good — with the retry wedged on a second unhandled error, on the backup the tool calls the way out. An
  unguessable name has nothing to collide with. A planted lock file still blocks provisioning until
  somebody removes it; that is a refusal, and the message names the path.
- **Every refusal on this path explains itself, and no two of them form a loop.** A backup left by an
  earlier provisioning, a backup that is not a configuration, a backup you cannot read, a directory you
  cannot write, a mistyped `--config`, a full disk: each says what happened and what to do. The
  leftover-backup case is split in THREE on purpose, and the third one matters most: a backup this
  account cannot READ is not a backup that is unreadable. A review met the "not a configuration, remove
  it" message in the layout `install.sh` builds — an agent-owned directory holding a backup root had
  written minutes earlier — and following that instruction would have destroyed the only way back. An
  operating-system error carries a code and a parse failure does not, which is the whole difference.
  Before any of that, the branch proves what is AT the path: a review left a named pipe there and the
  tool hung forever holding the lock, which a kill does not release. And "parses as JSON" was never the
  question — `[]` parses, and restoring it leaves a host unable to start — so both this branch and the
  rollback ask whether the file is an object carrying a control-centre URL. The other two: A review followed the remedy the single message named
  and found the rollback refusing the same file for not parsing, leaving no way forward but to delete by
  hand the file that message had just called the way out. A backup that is not a configuration is not a
  way out, and now says so.
- **Nothing is orphaned on the way out.** Both verbs remove the replacement they were writing if anything
  after the open fails, and a half-written backup is removed rather than left for the next run to find
  and refuse. This matters more since the replacement was given a random name: a name derived from the
  process id littered at most one file per id and a later run would trip over it, while a random one
  mints a fresh name on every failure that nothing will ever reuse or list — and each one can hold the
  whole configuration, credential and private keys included.
- **The configuration must not be readable by group or other either.** It holds the enrolment credential
  and, on a v2 runtime, private keys; `install.sh` creates it 0600. An earlier version of this rule judged
  the file on write alone, which contradicted what the rest of the codebase says about the same file.

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

### A sequencing hazard the lock does not cover

`scripts/install-reviewed-agent.sh` also rewrites this file, and its rollback restores a snapshot taken at
activation time. If that snapshot predates a provisioning, rolling the agent release back removes the
organisation and the agent then refuses to start. **After any agent-release rollback, re-provision and
confirm the organisation before restarting the service.**

The installer takes no configuration lock, and this document does not claim it does. A lock would not fix
the hazard above, which is a matter of sequence rather than concurrency: the snapshot was already stale
when it was taken. The remaining concurrency gap is narrower — an activation running at the same moment as
a provisioning — and closing it means adding lock acquisition and release across four reassigned `trap`
handlers in a script that sits on the production activation path, where a leaked lock would block both the
provisioning tool and the agent's enrolment. That trade is not worth making silently, so it is written
down here instead and left as the owner's call.

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
- Independent review, round 4 of the remediation: NO-GO, three findings, all real and all fixed.
  - **High.** Resolving the path threw away the ancestry that SELECTS the destination. An attacker who
    owned a directory could put a link in it and swing it between two perfectly protected
    configurations, getting a different organisation and server id each time without touching anything
    the checks looked at. Both chains are walked now. This also corrected a claim: the remaining
    resolve-then-open window was described as denial of service only, and while the written path went
    unchecked that was wrong.
  - **Medium.** `--expect-owner` trusted the named account for the file but still demanded root for the
    directories above it, which refuses the layout `install.sh` produces on every host. The stated
    account is now trusted for the tree.
  - **Low.** The ceremony test put all four line terminators through the signer and only one through the
    builder, so deleting the separators from the builder alone passed. It tries all four on both now.
- Independent review, round 5 of the remediation: NO-GO, one finding, real and fixed. The two-chain walk
  was still an endpoint check. A link in a trusted directory pointing at a link in an untrusted one is
  invisible to both walks, because resolution reports only the far end and `stat` follows the chain, so
  the attacker's hop is never visited. Resolution is gone from the trust decision entirely: every
  component of the path is measured as it is, and a link anywhere is a refusal.
- Independent review, round 6: the previous reviewer's service refused the request at its own content
  filter, twice, on an existing thread and on a fresh session. That is a refusal to look, not a verdict.
  A different reviewer ran the round instead. **NO-GO**, two demonstrated findings and seven smaller ones,
  all addressed.
  - **Demonstrated.** Sticky ancestors are accepted, and sticky does not stop an untrusted user creating
    files beside the configuration. The backup was unchecked, so one could be planted and installed by
    the operator's own rollback; the pending replacement was opened with `w`, so a planted one could be
    renamed into place and the credential read out of it. Both closed. The production layout is 0750 and
    agent-owned, so no real host was exposed — the defect was that the rule declared a layout acceptable
    in which it was.
  - **Documentation claimed more than the code did**, in three places: the tool described as
    descriptor-bound when only the runtime is, a heading saying the control plane establishes nothing
    when enrolment still establishes the server id, and a guard comment describing a design that two
    repairs ago ceased to exist. All corrected.
  - **Smaller.** The protection check permitted a world-readable configuration while its own reasoning
    cited the credential inside it; the loader's control-character rule was laxer than the signer that
    claimed parity with it; an exported helper had no caller; and two tests asserted source text while
    standing between two mutations and a green suite. The inode comparison is now its own function with a
    behavioural test, and the one remaining source-text assertion says so in its name.
- Independent review, round 7: **NO-GO**, two findings, both introduced by the round-6 fixes and both in
  the fixes rather than around them.
  - **The exclusive-open fix relocated the sibling hole into a denial of service.** The pending file was
    still named from the process id, and making a collision fatal made the whole small range worth
    covering: 0.6 seconds of unprivileged work stopped provisioning, rollback and enrolment permanently,
    and the documented retry died on a second unhandled error. Named from random bytes now, with every
    refusal on the operator path given a reason and a remedy.
  - **The signer reorder deleted the only coverage the digest-shape rules had.** Moving the patterns
    after the control-character sweep let the sweep's own message satisfy the test that used to reach
    them, so deleting all three passed the suite — and a signature over a document the loader's schema
    will refuse is exactly what the signer exists to prevent. Covered directly now, with strings that are
    well formed and the wrong shape, which only the pattern can refuse.
  - Three smaller ones: a banner that contradicted the change that introduced it, a source-text test
    wearing a behavioural name next to the twin renamed for that very reason, and the note that the
    development fallback configuration is now refused by the read rule. All addressed.
  - The reviewer withdrew the previous round's finding about the activation script and agreed the lock
    would be the wrong trade. Its suggestion is taken: that script's rollback now prints the
    re-provisioning reminder itself, where the operator is actually looking.
- Independent review, round 8: **NO-GO**, narrow. No trust-boundary defect remained; three demonstrated
  defects did, all in what the previous round had changed.
  - **A test that did not measure its own name.** The agent-side flood planted process ids 1 to 300 while
    the process doing the saving had an id in the thousands, so the defect it existed to catch could be
    put straight back and only the structural assertion objected. It plants its own id first now, which
    for an in-process save is a certainty rather than a guess.
  - **The random name made the leak unbounded.** Neither verb removed the replacement it was writing when
    anything after the open failed. Fixed in both, along with the half-written backup.
  - **Two correct messages that formed a loop.** See the runbook above.
  - Two smaller ones: the two remaining unwrapped writes, and a message with no test. Both closed, and
    reaching the second honestly needed a second account and the layout where it is genuinely reachable —
    a directory the agent owns, holding a backup root wrote.
- Independent review, round 9: **NO-GO**. The security posture was found unchanged and the cleanup logic
  correct; the findings were in the newest code and in how it was tested.
  - **A message that would have destroyed the way back.** The leftover-backup branch inferred "this is
    not a configuration" from any failed read, including one that failed because the operator could not
    read it — and then told them to delete it. Corrected above.
  - **A test of mine that reported as a pass while doing nothing.** It opened with a bare `return` when
    not root, which the count and skip gates cannot see, leaving two of the previous round's fixes
    unexercised on the job that gates the merge. Every rule is now reached without privilege: a directory
    its owner cannot write, and a backup at mode 0200, need no second account. A privileged run only ever
    adds to that. **The rule this establishes, and the one to hold future rounds to: no rule may depend
    on a privileged run to be tested at all.**
  - Three write-failure explanations and one more unwrapped read had no coverage; the reads are covered
    behaviourally and the writes structurally, by their catch shape and by count, because a mutation that
    keeps the message and disables the branch passed the first two attempts at that assertion.
- Independent review, round 10: **NO-GO**, two findings, and the reviewer confirmed no other test in the
  suite passes by doing nothing.
  - **A fourth case in the branch I had just split three ways.** The classifier read the backup without
    establishing what was at that path, so a named pipe planted by an unprivileged user hung the tool
    forever holding the lock — and a kill does not run the handler that releases it, so the orphaned lock
    then blocked the rollback verb and the agent's own enrolment until a human intervened. The rollback
    verb had always been safe because it proves what is there first; the classifier now does the same.
  - **"Parses as JSON" is not "is a configuration".** `[]`, `null` and `123` all parse. A review restored
    `[]` over a working configuration end to end, through the very check added to prevent a host being
    left unable to start. Both the classifier and the rollback now require an object carrying a
    control-centre URL.
- Independent review, round 11: **GO**. No functional defect in the security path, and no rule the suite
  cannot distinguish. One should-fix, now closed: the tool applied its "is this a configuration" bar to
  the backup but not to the file it was about to provision, so it would write into `{}` or `[]`, report
  success, and then refuse to roll itself back. Nothing was destroyed — the original bytes were in the
  backup — but only a hand copy could undo it, and that is the opposite of the rule this tool states
  about itself. The reviewer also confirmed the two things I asked about: applying the protection check
  to the backup refuses no layout the runbook describes, and `controlCenterUrl` is required with no
  default by the schema and emitted by every producer of a configuration in the repository.
- **130 mutations were run across rounds 6 to 11 and 129 were caught by a named test.** The survivor is a
  redundant internal assertion whose outcome another mutation covers.

## 8. What this GO is and is not

It is an independent reviewer finding no defect it can demonstrate, after eleven rounds in which it
demonstrated eighteen. It is not the human security review. **That NO-GO stands until the human reviewer
lifts it**, and nothing here should be read as replacing it — the independent rounds exist to make the
human's re-review worth their time, not to substitute for it.

Still owner-only, unchanged by any of this: the Sigstore trusted root and the review-gate CA must be
chosen before anything is signed, the key ceremony is the owner's, and the review-gate executor decision
remains downstream of all of it. Production has not been touched at any point.
- The human reviewer's NO-GO stands until they say otherwise. An independent GO does not lift it.
