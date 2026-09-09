# Handing the admin container over to Compose

## Why this exists

The admin surface runs in a container that was started with `docker run`, not by Compose. It carries no
`com.docker.compose.*` labels, is named by no Compose file, and is referenced by no script in this
repository. It publishes the same host port the `admin` service in
`deploy/docker-compose.production.yml` publishes.

Compose adopts a container only by its own project and service labels, and a running container's labels
cannot be changed. So Compose will not reuse it, will not stop it, and will try to bind the same host
port a second time. Docker refuses the bind, and because one `up` starts several services, the failure
lands **part way through** — with earlier services already recreated. The recovery path then issues
another `up` that hits the same held port.

The deployer refuses before any of that: `detectForeignPortConflicts` compares the resolved Compose
model's published ports against the ports held by containers the project does not own, and aborts before
the first runtime mutation. That refusal is the safe outcome, not the goal. The transition below is what
clears it.

## The transition

`scripts/adopt-unmanaged-container.mjs` has three verbs.

```
node scripts/adopt-unmanaged-container.mjs capture <container> <record>
node scripts/adopt-unmanaged-container.mjs stop <record>
node scripts/adopt-unmanaged-container.mjs start <record>
```

`capture` writes a record naming the container by its full id, along with the ports it holds, and
refuses a container Compose already owns. It will not overwrite an existing record.

`stop` removes the container's restart policy and then stops it, which releases its published ports so
Compose can bind them. The policy comes off first on purpose. Docker keeps an `unless-stopped` container
down after a reboot by setting a manual-stop marker, but it sets that marker only when it stops a
container that is still *running*. Between the inspect and the stop the container can exit on its own,
Docker then treats the stop as a no-op and sets nothing, and the container is left eligible to come back
mid-deployment. The marker is not visible in `docker inspect`, so no check afterwards can confirm it.
Taking the policy away first removes the dependency on it: whichever way the race goes, there is no
policy under which the daemon can restart it. `start` puts the recorded policy back. It addresses
the container by its **immutable id** at every step, never by name, because inspecting by name and then
acting by name is a race. It refuses if the container has been renamed, has become Compose-owned, or is
not the one that was captured. It then re-inspects and reports the **observed** state rather than the
exit code of the stop command, because a stop that errors may still have stopped the container and a
stop that succeeds is only useful if the port is genuinely free.

`start` brings the same container back, confirms it is genuinely running rather than paused or looping,
and only then reinstates the restart policy the record captured. Restoring the policy to a container
that did not come up would hand the daemon a restart loop instead of a clear failure.

## Why it stops rather than removes

An earlier version removed the container and rebuilt it from a recorded `docker run` command. That
cannot be made faithful, and an independent review is what established it.

A container carries dozens of settings — capabilities, resource limits, sysctls, logging driver, DNS,
namespace modes, masked paths, stop signal. A reconstruction either reproduces every one of them or
silently produces a container that looks identical and behaves differently. The daemon's own defaults
are not knowable from one container's inspect output either, so "this value equals the default" was a
guess that would be wrong on a differently configured daemon in both directions: silently dropping a
real override, or refusing a legitimate default. And the record became a command that a root process
would execute, which is authority no unsigned file should carry.

Stopping avoids all of it. **The container is its own backup.** `start` restores the exact object, with
its writable layer, its settings and its image. Nothing is reconstructed and nothing is inferred.
`restart: unless-stopped` means a container stopped this way stays stopped across daemon restarts, so it
will not come back and retake the port.

That is a **retained, restartable predecessor, not a snapshot of the service**. It does not reverse data
changes made anywhere else, does not preserve process state, does not guarantee the same container IP on
restart, and does not protect the stopped container from being pruned or removed by something else. It
is worth exactly what it says: the same object, startable again.

Two container settings would break even that, so both verbs refuse them. Auto-remove means the daemon
deletes the container when it stops, which would destroy the backup instead of preserving it. A restart
policy of `always` outranks a manual stop after a daemon restart, so the container could come back and
retake the port mid-deployment. The target runs `unless-stopped`, which honours a manual stop.

The record now decides only *which* container gets stopped, so it is read through a file descriptor,
refused if it is a symlink or not owned by the caller, and validated before any Docker call is made.

## Removal is a separate, later decision

This tool never removes anything. Once the deployment is confirmed and the Compose-managed service is
serving, the old container can be removed by hand. Until then it costs some disk and keeps the
predecessor startable. Removing it earlier trades that away for nothing.

## Sequencing

`stop` begins downtime for whatever that port serves, and it ends when the deployment creates the
Compose-managed service. Run them together. Do not run `stop` and walk away.

If the deployment is abandoned, **the port is probably not free any more**. The deployment, or its own
rollback, will have started a Compose-managed `admin` holding it, and `start` would simply fail to bind.
Stop that service first, then `start` the record, then check that the admin surface actually answers:

```
docker compose --project-name opsworkbench --file <release>/deploy/docker-compose.production.yml stop admin
node scripts/adopt-unmanaged-container.mjs start <record>
```

`start` confirms the container is running and refuses a paused or restart-looping one, but "running" is
not "serving". Check the admin endpoint itself before calling the abandonment complete.

## Precondition

The candidate and its rollback must both carry a Compose file this host can load. Releases cut before
the review gate was removed from `deploy/docker-compose.production.yml` do not, and the deployer's
pre-mutation rollback check refuses them.
