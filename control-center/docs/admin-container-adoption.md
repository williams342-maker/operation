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

`scripts/adopt-unmanaged-container.mjs` splits the destructive step into three verbs, so the container is
described before it is removed and can be put back if the deployment is abandoned.

```
node scripts/adopt-unmanaged-container.mjs capture <container> <record>
node scripts/adopt-unmanaged-container.mjs release <record>
node scripts/adopt-unmanaged-container.mjs restore <record>
```

`capture` writes a read-only, fsynced record holding the container's full id and a **typed description**
of it. It refuses a container Compose already owns, and refuses to overwrite an existing record, because
that record is the only description of what is about to be removed.

`release` is the only destructive verb. It addresses the container by its **immutable id** at every step,
never by name: inspecting by name and then removing by name is a race, and the removal could land on a
container nobody reviewed. It refuses unless the live container is still the captured one and still
unowned. If it stops the container but cannot remove it, it says so explicitly, because the port is then
free while the container still exists.

`restore` rebuilds the command from the description and refuses if anything already holds the name.

## The record is a description, never a command

An earlier version stored the `docker run` argv and passed it straight to Docker. That made the record
executable authority: anyone able to replace the file could make a root process run any Docker command,
with no shell injection involved. The record now carries typed fields, and every one is re-validated
before it reaches a command line. Both destructive verbs validate the description on load, so a record
this tool would refuse to restore is not one it will act on at all.

## What the record can and cannot reproduce

It reproduces the name, network, network aliases, restart policy, published ports, command, any
environment variable the original run **added** on top of the image's, and the image **by id** rather
than by tag. A tag is mutable; retagging between capture and restore would rebuild the container from a
different image while every name in the record still looked correct.

Refusal is the default. Every `HostConfig` and `Config` key is either reproduced, or required to hold a
value that came from the daemon or the image rather than from the original run. A key this tool has
never heard of is refused too, so a newer daemon that grows a setting demands a review instead of
silently dropping it. Capability changes, resource limits, sysctls, ulimits, devices, a logging driver,
custom DNS, tmpfs, a privileged or read-only root filesystem, a static address, a dynamic host port, a
second network, mounts, or a run-time override of the image's healthcheck, entrypoint, user, working
directory, stop signal or labels all refuse rather than restore something that looks identical and
behaves differently.

**It cannot restore state.** Removing a container destroys its writable layer. Nothing here captures
files written inside the container since it started. Confirm the container is stateless first; the admin
surface is, because it serves only what its image contains.

## Sequencing

`release` starts downtime for whatever that port serves, and it ends when the deployment creates the
Compose-managed service. Run them together. Do not run `release` and walk away.

If the deployment is abandoned after `release`, run `restore` with the same record to put the previous
container back. The image it names is retained on the host, so the restore rebuilds nothing.

## Precondition

The candidate and its rollback must both carry a Compose file this host can load. Releases cut before
the review gate was removed from `deploy/docker-compose.production.yml` do not, and the deployer's
pre-mutation rollback check refuses them.
