# Forge activation ceremony

This document exists to discharge **condition 1** of the security review's CONDITIONAL GO on
`9b063f12`. The reviewer offered two routes for the activation/configuration race and this is route B:
an operational ceremony that makes concurrent mutation unreachable for the whole activation
transaction, with before and after verification, and a rollback that verifies the restored identity
rather than trusting a snapshot.

Route A, threading lock acquisition through the activation script, was declined on the reviewer's own
earlier reasoning: a leaked lock on that path would block both the provisioning tool and the agent's
enrolment, and the script reassigns its `trap` handler four times. The reviewer withdrew that finding
when it was put to them.

**Nothing in this document has been performed. Production remains on `v0.1.15-operate` with the July
agent.**

## 1. What the race actually is

Three things write `/etc/opsworkbench-agent/agent.json`:

| writer | when | what it writes |
|---|---|---|
| the agent itself | enrolment only, when `agentId` and `agentSecret` are empty | credential, server id, poll interval |
| `scripts/provision-agent-organisation.mjs` | the ceremony | the organisation, and nothing else |
| `scripts/install-reviewed-agent.sh` | activation and rollback | version and digest, or a restored snapshot |

The first two share a lock. The third does not, and threading one through it is the trade that was
declined. There is also a second problem that no lock can fix: the activation snapshot is taken **at
activation time**, so it is stale about the organisation the moment the organisation is provisioned
afterwards. A rollback restoring that snapshot removes the organisation.

**These are two different problems and they need two different answers.** The sequencing problem is
answered in code, in section 4. The concurrency problem is answered by this ceremony.

## 2. The invariant

> For the whole activation transaction, `agent.json` has exactly one writer, and it is the operator.

That is achieved by removing the other two writers rather than by coordinating with them. The agent is
stopped, so it cannot enrol. The provisioning tool and the activation script are run by one operator, in
sequence, in one session, and each completes before the next begins. Neither the tool nor the agent can
be running when the activation script is.

If you find yourself needing two terminals, stop. The ceremony has gone wrong.

## 3. The sequence

Every step is run as root on the target host, in one session, in this order.

**Before you start**, confirm the path the service actually uses. It is not `agent.local.json`; that is
the development fallback.

```
systemctl show opsworkbench-agent -p Environment
```

**Step 0 — record the before-state.** Keep this output; it is what the after-state is compared against.

```
systemctl is-active opsworkbench-agent
sha256sum /etc/opsworkbench-agent/agent.json
node -e 'const c=require("/etc/opsworkbench-agent/agent.json");console.log(c.orgId||"(none)",c.serverId||"(none)",c.agentVersion)'
ls -la /etc/opsworkbench-agent/
```

The listing matters. Any `.provisioning-lock`, `.before-organisation`, `.pending-*` or
`.identity-pending` sibling means a previous run did not finish. **Resolve that before going further**;
the provisioning tool's own messages say how, and it will refuse rather than write over the way out.

**Step 1 — stop the agent.** This is what makes the race unreachable rather than unlikely. A stopped
agent cannot enrol, and enrolment is its only write.

```
systemctl stop opsworkbench-agent
systemctl is-active opsworkbench-agent    # expect: inactive
```

**Step 2 — install the Forge material.** Root-owned, directory 0755, files 0444, no symlinks, no bind
mounts. The agent's loader enforces all of that and will refuse anything else.

**Step 3 — provision the organisation.** As root over an agent-owned configuration, name the account:

```
node scripts/provision-agent-organisation.mjs \
  --config /etc/opsworkbench-agent/agent.json \
  --org <24-hex organisation id> \
  --expect-owner <the account in the unit's User=>
```

Record the output. It prints the backup path, the resulting mode and owner, and the digest before and
after. That is the evidence the step happened, and the backup is the way out.

**Step 4 — verify before starting anything.** The organisation is written, the credential is intact, the
mode and owner are unchanged, and no lock remains.

```
node -e 'const c=require("/etc/opsworkbench-agent/agent.json");console.log(c.orgId,c.serverId,!!c.agentSecret)'
stat -c '%a %U:%G' /etc/opsworkbench-agent/agent.json
ls -la /etc/opsworkbench-agent/
```

**Step 5 — start the agent, and watch it.** A wrong or missing identifier is a refusal to start with a
message that says which.

```
systemctl start opsworkbench-agent
systemctl is-active opsworkbench-agent
journalctl -u opsworkbench-agent -n 50 --no-pager
```

**Step 6 — record the after-state**, in the same shape as step 0, and keep both.

## 4. Rollback, and why it no longer loses the organisation

`install-reviewed-agent.sh rollback` now reads the live identity **before** the snapshot lands on top of
it, and reconciles afterwards:

- an identifier that is live survives the rollback, because a release rollback is about the release;
- one that was never set is not invented;
- a disagreement resolves in favour of what was live, because the snapshot is not current truth;
- the file keeps its own owner and mode, and the write is atomic;
- all of it runs **before** the service is restarted, so a host that cannot be made whole fails there
  rather than looking activated and refusing to start.

The reconciliation is also a verb, `reconcile-identity`, placed above the root check so it can be run
and tested on its own. That is the same reason `probe-credentials` exists: the rollback path needs root
and systemd, and a rule nothing can execute is a rule nobody has checked. One function, two callers.
Held by `apps/agent/test/agent-rollback-identity.test.ts`.

## 5. If a step fails

**Provisioning refused.** Read the message; every refusal on that path names what happened and what to
do. It will not overwrite the way out, and it will not delete a backup it cannot read. Nothing has been
changed when it refuses.

**The agent will not start after step 5.** Roll the organisation back and take the host back to a known
state before investigating:

```
node scripts/provision-agent-organisation.mjs \
  --config /etc/opsworkbench-agent/agent.json --rollback
systemctl start opsworkbench-agent
```

**The agent release itself needs rolling back.** Use the installer's own rollback. It will tell you
whether it carried an identifier forward, and it verifies before it restarts.

## 6. What this ceremony does not cover

- **It does not defend against root.** Nothing in the agent does. An operator with root can set the
  hostname, rewrite the machine id, or replace the verifier.
- **It does not make the activation script concurrency-safe in general.** It makes the race unreachable
  *for a ceremony performed this way*. Anyone running the activation script while the agent is running,
  or in parallel with a provisioning, is outside this document.
- **It does not authorise anything.** The trusted root and the Review Gate CA are owner decisions that
  come before any signing, and the review-gate executor remains a separate decision downstream of all of
  it.
