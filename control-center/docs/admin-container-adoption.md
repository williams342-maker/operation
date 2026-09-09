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

`capture` writes a read-only record holding the container's identity and the exact argv that recreates
it. It refuses a container Compose already owns. It refuses to overwrite an existing record, because
that record is the only description of what is about to be removed.

`release` is the only destructive verb. It re-inspects the live container and refuses unless it is the
same container that was captured, by id, and still unowned. Then it stops and removes it.

`restore` replays the recorded argv, and refuses if anything already holds the name.

## What the record can and cannot reproduce

The record reproduces the name, network, network aliases, restart policy, published ports, image
reference, command, and any environment variable the original run **added** on top of the image's own.

It refuses outright — rather than restoring something that looks right and behaves differently — when
the container has mounts, is attached to more or fewer than one network, or overrides the image's
healthcheck, entrypoint, user or working directory. On this target all of those come from the image, so
the transition is faithful here; the refusals exist so it cannot quietly stop being faithful elsewhere.

## Sequencing

`release` starts downtime for whatever that port serves, and it ends when the deployment creates the
Compose-managed service. Run them together. Do not run `release` and walk away.

If the deployment is abandoned after `release`, run `restore` with the same record to put the previous
container back. The image it names is retained on the host, so the restore rebuilds nothing.

## Precondition

The candidate and its rollback must both carry a Compose file this host can load. Releases cut before
the review gate was removed from `deploy/docker-compose.production.yml` do not, and the deployer's
pre-mutation rollback check refuses them.
