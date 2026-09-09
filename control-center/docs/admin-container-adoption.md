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

`stop` stops the container, which releases its published ports so Compose can bind them. It addresses
the container by its **immutable id** at every step, never by name, because inspecting by name and then
acting by name is a race. It refuses if the container has been renamed, has become Compose-owned, or is
not the one that was captured. It then re-inspects and reports the **observed** state rather than the
exit code of the stop command, because a stop that errors may still have stopped the container and a
stop that succeeds is only useful if the port is genuinely free.

`start` brings the same container back and confirms it is running.

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

The record now decides only *which* container gets stopped, so it is read through a file descriptor,
refused if it is a symlink or not owned by the caller, and validated before any Docker call is made.

## Removal is a separate, later decision

This tool never removes anything. Once the deployment is confirmed and the Compose-managed service is
serving, the old container can be removed by hand. Until then it costs some disk and buys an exact,
complete rollback. Removing it earlier trades that rollback for nothing.

## Sequencing

`stop` begins downtime for whatever that port serves, and it ends when the deployment creates the
Compose-managed service. Run them together. Do not run `stop` and walk away.

If the deployment is abandoned, run `start` with the same record.

## Precondition

The candidate and its rollback must both carry a Compose file this host can load. Releases cut before
the review gate was removed from `deploy/docker-compose.production.yml` do not, and the deployer's
pre-mutation rollback check refuses them.
