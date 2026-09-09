#!/usr/bin/env node
// Hand an unmanaged container's host port over to the Compose project that should own it.
//
// A container started with `docker run` carries none of Compose's project/service labels, so Compose
// can neither adopt nor replace it -- it will try to bind the same host port a second time and fail
// part way through an `up`. There is no way to relabel a running container: the only transition is to
// remove it and let Compose create the service. That is destructive, so this does it in three explicit
// steps with a record in between, rather than as one irreversible command.
//
//   capture <name> <record>   write down exactly what is running, and how to put it back
//   release <record>          verify the live container still matches, then stop and remove it
//   restore <record>          recreate it from the record, if the deployment is abandoned
//
// `release` is the only destructive verb, and it refuses anything the record does not describe. The
// window between `release` and the deployment creating the service is downtime for whatever that port
// serves, so sequence them together rather than running `release` and walking away.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const composeProjectLabel = "com.docker.compose.project";
const containerName = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

const defaultDocker = (args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function inspectContainer(name, docker) {
  const parsed = JSON.parse(docker(["inspect", name]));
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error("inspect did not describe exactly one container");
  return parsed[0];
}

/**
 * The argv that recreates this container. Only the properties this transition is allowed to reproduce
 * are read; anything else present is a refusal rather than a silent partial restore, because a restore
 * that quietly drops a mount or an environment variable is worse than no restore at all.
 */
export function restoreCommand(container, imageConfig = {}) {
  const config = container?.Config ?? {}; const host = container?.HostConfig ?? {};
  const name = String(container?.Name ?? "").replace(/^\//, "");
  if (!containerName.test(name)) throw new Error("container name is not a plain name");
  if ((host.Binds ?? []).length || (container?.Mounts ?? []).length) throw new Error("container has mounts; this transition does not reproduce them");
  const networks = Object.entries(container?.NetworkSettings?.Networks ?? {});
  if (networks.length !== 1) throw new Error("container is not attached to exactly one network");
  const [networkName, network] = networks[0];
  const argv = ["run", "--detach", "--name", name, "--network", networkName];
  for (const alias of network?.Aliases ?? []) argv.push("--network-alias", alias);
  const policy = host?.RestartPolicy?.Name;
  if (policy && policy !== "no") argv.push("--restart", policy);
  for (const [port, bindings] of Object.entries(host?.PortBindings ?? {})) {
    for (const binding of bindings ?? []) argv.push("--publish", `${binding?.HostIp ? `${binding.HostIp}:` : ""}${binding?.HostPort}:${port.split("/")[0]}`);
  }
  // Everything below this point is the difference between the container and its image. Whatever the
  // image already provides needs no flag -- `docker run` supplies it again -- but whatever the ORIGINAL
  // run overrode has to be reproduced or refused. Silently dropping an override would restore a
  // container that looks right and behaves differently, which is worse than refusing to restore at all.
  //
  // Image-provided variables are re-supplied by the image, and pinning them here would freeze values
  // meant to move with it. Only variables the run ADDED are reproduced.
  const fromImage = new Set(imageConfig?.Env ?? []);
  for (const entry of config?.Env ?? []) if (!fromImage.has(entry)) argv.push("--env", entry);
  // These CAN be overridden at run time and this transition does not reproduce them, so an override is
  // a refusal. On the target they are all image-provided, which is why the transition is safe there.
  const same = (one, other) => JSON.stringify(one ?? null) === JSON.stringify(other ?? null);
  if (!same(config?.Healthcheck, imageConfig?.Healthcheck)) throw new Error("container overrides the image healthcheck; this transition does not reproduce it");
  if (!same(config?.Entrypoint, imageConfig?.Entrypoint)) throw new Error("container overrides the image entrypoint; this transition does not reproduce it");
  if (!same(config?.User ?? "", imageConfig?.User ?? "")) throw new Error("container overrides the image user; this transition does not reproduce it");
  if (!same(config?.WorkingDir ?? "", imageConfig?.WorkingDir ?? "")) throw new Error("container overrides the image working directory; this transition does not reproduce it");
  argv.push(config.Image);
  for (const argument of config?.Cmd ?? []) argv.push(argument);
  return argv;
}

export function capture(name, recordPath, hooks = {}) {
  const docker = hooks.docker ?? defaultDocker;
  const container = inspectContainer(name, docker);
  const labels = container?.Config?.Labels ?? {};
  if (labels[composeProjectLabel]) throw new Error(`container already belongs to compose project ${labels[composeProjectLabel]}; nothing to adopt`);
  const image = JSON.parse(docker(["image", "inspect", container.Config.Image]))[0];
  const record = {
    schemaVersion: "opsworkbench-container-adoption-v1",
    capturedAt: new Date().toISOString(),
    name: String(container.Name).replace(/^\//, ""),
    containerId: container.Id,
    imageReference: container.Config.Image,
    imageId: container.Image,
    restore: restoreCommand(container, image?.Config ?? {}),
  };
  const body = `${JSON.stringify(record, null, 2)}\n`;
  fs.writeFileSync(recordPath, body, { flag: "wx", mode: 0o400 });
  return { ...record, sha256: crypto.createHash("sha256").update(body).digest("hex") };
}

function loadRecord(recordPath) {
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  if (record?.schemaVersion !== "opsworkbench-container-adoption-v1" || !containerName.test(record?.name ?? "") || !Array.isArray(record?.restore)) throw new Error("adoption record is missing or malformed");
  return record;
}

export function release(recordPath, hooks = {}) {
  const docker = hooks.docker ?? defaultDocker;
  const record = loadRecord(recordPath);
  const container = inspectContainer(record.name, docker);
  // The record describes ONE container. If what is running now is a different one -- restarted from a
  // different image, or recreated by something else since capture -- this is not the transition that
  // was reviewed, and removing it would destroy something nobody looked at.
  if (container.Id !== record.containerId) throw new Error("the running container is not the one that was captured");
  if (container?.Config?.Labels?.[composeProjectLabel]) throw new Error("the container now belongs to a compose project; refusing to remove it");
  docker(["stop", record.name]);
  docker(["rm", record.name]);
  return { removed: record.name, containerId: record.containerId };
}

export function restore(recordPath, hooks = {}) {
  const docker = hooks.docker ?? defaultDocker;
  const record = loadRecord(recordPath);
  // Never restore over something occupying the name: that would either fail confusingly or, worse,
  // succeed against a container the deployment has since created and legitimately owns.
  let existing = null;
  try { existing = inspectContainer(record.name, docker); } catch { existing = null; }
  if (existing) throw new Error(`a container named ${record.name} already exists; remove it deliberately before restoring`);
  docker(record.restore);
  return { restored: record.name };
}

const verbs = { capture: (args) => capture(args[0], args[1]), release: (args) => release(args[0]), restore: (args) => restore(args[0]) };

// Run as a CLI, importable as a module by the tests. Comparing the resolved path avoids the
// file:// URL escaping differences between platforms.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [verb, ...args] = process.argv.slice(2);
  if (!verbs[verb] || !args.length) { process.stderr.write("usage: adopt-unmanaged-container.mjs capture <name> <record> | release <record> | restore <record>\n"); process.exit(2); }
  try { process.stdout.write(`${JSON.stringify(verbs[verb](args), null, 2)}\n`); }
  catch (cause) { process.stderr.write(`${cause.message}\n`); process.exit(1); }
}
