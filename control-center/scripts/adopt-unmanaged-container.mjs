#!/usr/bin/env node
// Hand an unmanaged container's host port over to the Compose project that should own it.
//
// A container started with `docker run` carries none of Compose's project/service labels, so Compose
// can neither adopt nor replace it -- it will try to bind the same host port a second time and fail
// part way through an `up`. A running container's labels cannot be changed, so the only transition is
// to remove it and let Compose create the service. That is destructive, so it happens in three explicit
// steps with a record in between:
//
//   capture <name> <record>   describe exactly what is running, in typed fields
//   release <record>          verify the live container is still that one, then stop and remove it
//   restore <record>          recreate it from the description, if the deployment is abandoned
//
// TWO PROPERTIES THIS DESIGN DEPENDS ON.
//
// The record holds a DESCRIPTION, never a command. An earlier version stored the argv and handed it
// straight to Docker, which made the record executable authority: anyone able to replace the file could
// make a root process run any Docker command, with no shell injection needed. The record now carries
// typed fields that are re-validated on load and turned into a command by this file.
//
// Refusal is the default. Every HostConfig and Config key is either reproduced, or required to hold a
// value that came from the daemon or the image rather than from the original `docker run`. A key this
// file does not know about is a refusal, so a newer daemon that grows a setting demands a review rather
// than silently dropping it. A restore that quietly loses a capability drop, a resource limit or a
// logging driver produces a container that looks identical and behaves differently.
//
// WHAT IT STILL CANNOT DO. Removing a container destroys its writable layer. Nothing here captures or
// restores files written inside the container since it started; restore reproduces the image plus the
// settings below, not the filesystem. Confirm the container is stateless before relying on this.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const schemaVersion = "opsworkbench-container-adoption-v2";
const composeProjectLabel = "com.docker.compose.project";
const namePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const imageIdPattern = /^sha256:[a-f0-9]{64}$/;
const restartPolicies = new Set(["no", "always", "unless-stopped", "on-failure"]);
const protocols = new Set(["tcp", "udp", "sctp"]);

const defaultDocker = (args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const isEmpty = (value) => value === null || value === undefined || value === "" || value === 0 || value === false || (Array.isArray(value) && !value.length) || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length);
const same = (one, other) => JSON.stringify(one ?? null) === JSON.stringify(other ?? null);
// Docker reports "no value" three ways depending on the field and the API version -- absent, null, or
// an empty string -- and an image config often omits a key the container reports as "". Comparing those
// literally makes every container look like it overrides the image, so emptiness is normalised first.
const sameUnlessSet = (one, other) => (isEmpty(one) && isEmpty(other)) || same(one, other);

function supersetOf(value, required) {
  if (!Array.isArray(value)) return false;
  const present = new Set(value);
  return required.every((entry) => present.has(entry));
}

// Keys this transition reproduces or reads directly. Everything else in HostConfig must be empty, or
// must match a daemon default below; a key in neither group is refused outright.
const reproducedHostKeys = new Set(["PortBindings", "RestartPolicy", "NetworkMode", "Binds", "Mounts"]);

// Values the DAEMON sets on every container. A different value came from the original run, and this
// file does not reproduce it, so it is a refusal rather than a silent loss. The masked and read-only
// path lists are checked as SUPERSETS of the default hardening: a daemon that adds to them is fine, a
// run that removed one is not.
const daemonDefaults = {
  CgroupnsMode: (value) => isEmpty(value) || value === "private" || value === "host",
  ConsoleSize: (value) => isEmpty(value) || same(value, [0, 0]),
  IpcMode: (value) => isEmpty(value) || value === "private" || value === "shareable",
  LogConfig: (value) => isEmpty(value) || (value?.Type === "json-file" && isEmpty(value?.Config)),
  Runtime: (value) => isEmpty(value) || value === "runc",
  ShmSize: (value) => isEmpty(value) || value === 67108864,
  MaskedPaths: (value) => supersetOf(value, ["/proc/asound", "/proc/acpi", "/proc/kcore", "/proc/keys", "/proc/timer_list", "/sys/firmware"]),
  ReadonlyPaths: (value) => supersetOf(value, ["/proc/bus", "/proc/fs", "/proc/irq", "/proc/sys", "/proc/sysrq-trigger"]),
};

// Config keys the IMAGE supplies. Each is compared against the image, so a run-time override is a
// refusal. The generated set is exempt because Docker or this transition produces it: Hostname is
// derived from the container id, and Image, Cmd and Env are reproduced explicitly.
const imageProvidedConfigKeys = ["Entrypoint", "Healthcheck", "User", "WorkingDir", "StopSignal", "StopTimeout", "Labels", "ExposedPorts", "Volumes", "OnBuild", "Shell", "ArgsEscaped"];
const generatedConfigKeys = new Set(["Hostname", "Image", "Cmd", "Env", "AttachStdin", "AttachStdout", "AttachStderr", "Tty", "OpenStdin", "StdinOnce", "Domainname"]);

function refuseUnreproducibleHostConfig(host) {
  for (const [key, value] of Object.entries(host ?? {})) {
    if (reproducedHostKeys.has(key)) continue;
    const accepted = daemonDefaults[key];
    if (accepted) {
      if (!accepted(value)) throw new Error(`container overrides ${key}; this transition does not reproduce it`);
      continue;
    }
    if (!isEmpty(value)) throw new Error(`container sets ${key}, which this transition does not reproduce`);
  }
}

function refuseUnreproducibleConfig(config, imageConfig) {
  for (const key of imageProvidedConfigKeys) {
    if (!sameUnlessSet(config?.[key], imageConfig?.[key])) throw new Error(`container overrides the image ${key}; this transition does not reproduce it`);
  }
  for (const key of Object.keys(config ?? {})) {
    if (generatedConfigKeys.has(key) || imageProvidedConfigKeys.includes(key)) continue;
    if (!isEmpty(config[key])) throw new Error(`container sets ${key}, which this transition does not reproduce`);
  }
}

/** A typed description of the container: everything restore needs, and nothing that is a command. */
export function describeContainer(container, imageConfig = {}) {
  const config = container?.Config ?? {};
  const host = container?.HostConfig ?? {};
  const name = String(container?.Name ?? "").replace(/^\//, "");
  if (!namePattern.test(name)) throw new Error("container name is not a plain name");
  if ((host.Binds ?? []).length || (container?.Mounts ?? []).length) throw new Error("container has mounts; this transition does not reproduce them");
  refuseUnreproducibleHostConfig(host);
  refuseUnreproducibleConfig(config, imageConfig);

  const networks = Object.entries(container?.NetworkSettings?.Networks ?? {});
  if (networks.length !== 1) throw new Error("container is not attached to exactly one network");
  const [networkName, network] = networks[0];
  if (!namePattern.test(networkName)) throw new Error("network name is not a plain name");
  // A pinned address, driver option or link would not survive the rebuild, so refuse rather than move
  // the container silently. The endpoint's MacAddress is NOT checked here: the daemon assigns one to
  // every container, so it is always set and means nothing. A user-supplied `--mac-address` lands in
  // Config.MacAddress instead, and the Config sweep above refuses that.
  for (const field of ["IPAMConfig", "Links", "DriverOpts"]) {
    if (!isEmpty(network?.[field])) throw new Error(`container pins ${field} on its network; this transition does not reproduce it`);
  }
  if (host.NetworkMode && host.NetworkMode !== networkName) throw new Error("network mode does not name the attached network");

  const ports = [];
  for (const [port, bindings] of Object.entries(host?.PortBindings ?? {})) {
    const [containerPort, protocol = "tcp"] = String(port).split("/");
    if (!/^[0-9]{1,5}$/.test(containerPort) || !protocols.has(protocol)) throw new Error(`unsupported port specification: ${port}`);
    for (const binding of bindings ?? []) {
      const hostPort = String(binding?.HostPort ?? "");
      // An empty or zero host port is a dynamic allocation. The number Docker actually chose is not in
      // this field, so reproducing it would silently move the published port to a different one.
      if (!/^[0-9]{1,5}$/.test(hostPort) || hostPort === "0") throw new Error("container uses a dynamic or malformed host port; this transition does not reproduce it");
      ports.push({ hostIp: String(binding?.HostIp ?? ""), hostPort, containerPort, protocol });
    }
  }

  const policy = host?.RestartPolicy ?? {};
  const policyName = policy.Name || "no";
  if (!restartPolicies.has(policyName)) throw new Error(`unsupported restart policy: ${policyName}`);
  if (policyName !== "on-failure" && policy.MaximumRetryCount) throw new Error("restart policy carries a retry count it cannot use");

  const fromImage = new Set(imageConfig?.Env ?? []);
  // The image ID, not the tag. A tag is mutable: retagging between capture and restore would rebuild
  // the container from a different image while every name in the record still looked correct.
  const imageId = String(container?.Image ?? "");
  if (!imageIdPattern.test(imageId)) throw new Error("container image id is not a sha256 digest");
  return {
    name,
    imageId,
    imageReference: String(config.Image ?? ""),
    network: networkName,
    networkAliases: [...(network?.Aliases ?? [])],
    restartPolicy: policyName,
    restartMaximumRetryCount: policy.MaximumRetryCount || 0,
    ports,
    addedEnvironment: (config?.Env ?? []).filter((entry) => !fromImage.has(entry)),
    command: [...(config?.Cmd ?? [])],
  };
}

/** Build the run command from the typed description, re-validating every field it puts on the line. */
export function restoreArgv(description) {
  if (!namePattern.test(description?.name ?? "")) throw new Error("record name is not a plain name");
  if (!namePattern.test(description?.network ?? "")) throw new Error("record network is not a plain name");
  if (!imageIdPattern.test(description?.imageId ?? "")) throw new Error("record image is not a sha256 digest");
  if (!restartPolicies.has(description?.restartPolicy ?? "")) throw new Error("record restart policy is not recognised");
  const argv = ["run", "--detach", "--name", description.name, "--network", description.network];
  for (const alias of description.networkAliases ?? []) {
    if (!namePattern.test(alias ?? "")) throw new Error("record network alias is not a plain name");
    argv.push("--network-alias", alias);
  }
  if (description.restartPolicy !== "no") {
    const retries = Number(description.restartMaximumRetryCount ?? 0);
    if (!Number.isInteger(retries) || retries < 0 || retries > 1000) throw new Error("record restart retry count is malformed");
    argv.push("--restart", description.restartPolicy === "on-failure" && retries ? `on-failure:${retries}` : description.restartPolicy);
  }
  for (const entry of description.ports ?? []) {
    if (!/^[0-9]{1,5}$/.test(String(entry?.hostPort)) || !/^[0-9]{1,5}$/.test(String(entry?.containerPort)) || !protocols.has(entry?.protocol)) throw new Error("record port entry is malformed");
    if (entry.hostIp && !/^[0-9a-fA-F.:]{1,45}$/.test(entry.hostIp)) throw new Error("record host address is malformed");
    const address = entry.hostIp ? (entry.hostIp.includes(":") ? `[${entry.hostIp}]:` : `${entry.hostIp}:`) : "";
    argv.push("--publish", `${address}${entry.hostPort}:${entry.containerPort}/${entry.protocol}`);
  }
  for (const entry of description.addedEnvironment ?? []) {
    if (typeof entry !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*=/.test(entry)) throw new Error("record environment entry is malformed");
    argv.push("--env", entry);
  }
  argv.push(description.imageId);
  for (const argument of description.command ?? []) {
    if (typeof argument !== "string") throw new Error("record command is malformed");
    argv.push(argument);
  }
  return argv;
}

function inspectContainer(reference, docker) {
  const parsed = JSON.parse(docker(["inspect", "--type", "container", reference]));
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error("inspect did not describe exactly one container");
  return parsed[0];
}

export function capture(name, recordPath, hooks = {}) {
  const docker = hooks.docker ?? defaultDocker;
  const container = inspectContainer(name, docker);
  const labels = container?.Config?.Labels ?? {};
  if (labels[composeProjectLabel]) throw new Error(`container already belongs to compose project ${labels[composeProjectLabel]}; nothing to adopt`);
  // The image is inspected by ID, so the description is built against the image this container is
  // actually running rather than whatever the tag happens to point at now.
  const image = JSON.parse(docker(["image", "inspect", container.Image]))[0];
  const containerId = String(container.Id ?? "");
  if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("container id is not a full digest");
  const record = { schemaVersion, capturedAt: new Date().toISOString(), containerId, description: describeContainer(container, image?.Config ?? {}) };
  const body = `${JSON.stringify(record, null, 2)}\n`;
  // Written and fsynced before anything is removed: this is the only description of what is about to
  // stop existing, so a crash between capture and release must not lose it.
  const handle = fs.openSync(recordPath, "wx", 0o400);
  try {
    fs.writeFileSync(handle, body);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  return { ...record, sha256: crypto.createHash("sha256").update(body).digest("hex") };
}

function loadRecord(recordPath) {
  const stat = fs.lstatSync(recordPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("adoption record is not a regular file");
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  if (record?.schemaVersion !== schemaVersion || !/^[a-f0-9]{64}$/.test(record?.containerId ?? "")) throw new Error("adoption record is missing or malformed");
  // Rebuilding the command from the description proves the record still describes something this file
  // is willing to create, before either destructive verb runs.
  restoreArgv(record.description);
  return record;
}

export function release(recordPath, hooks = {}) {
  const docker = hooks.docker ?? defaultDocker;
  const record = loadRecord(recordPath);
  // Everything below addresses the container by its immutable ID, never by name. Inspecting by name and
  // then removing by name is a race: another actor can rename the inspected container away and put a
  // different one under that name in between, and the removal lands on a container nobody reviewed.
  const container = inspectContainer(record.containerId, docker);
  if (container.Id !== record.containerId) throw new Error("the running container is not the one that was captured");
  if (container?.Config?.Labels?.[composeProjectLabel]) throw new Error("the container now belongs to a compose project; refusing to remove it");
  docker(["stop", record.containerId]);
  try {
    docker(["rm", record.containerId]);
  } catch (cause) {
    // Stopped but not removed: the port is free, the container still exists, and `restore` would refuse
    // because the name still resolves. Say that plainly rather than leaving it to be inferred.
    throw new Error(`container ${record.description.name} was stopped but not removed; it still exists and must be removed or restarted deliberately: ${cause.message}`, { cause });
  }
  return { removed: record.description.name, containerId: record.containerId };
}

export function restore(recordPath, hooks = {}) {
  const docker = hooks.docker ?? defaultDocker;
  const record = loadRecord(recordPath);
  // Never restore over something holding the name: it would either fail confusingly or land on a
  // container the deployment has since created and legitimately owns.
  let existing;
  try { existing = inspectContainer(record.description.name, docker); } catch { existing = undefined; }
  if (existing) throw new Error(`a container named ${record.description.name} already exists; remove it deliberately before restoring`);
  docker(restoreArgv(record.description));
  return { restored: record.description.name };
}

const verbs = { capture: (args) => capture(args[0], args[1]), release: (args) => release(args[0]), restore: (args) => restore(args[0]) };

// Runs as a CLI, imports as a module for the tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [verb, ...args] = process.argv.slice(2);
  if (!verbs[verb] || !args.length) {
    process.stderr.write("usage: adopt-unmanaged-container.mjs capture <name> <record> | release <record> | restore <record>\n");
    process.exit(2);
  }
  try {
    process.stdout.write(`${JSON.stringify(verbs[verb](args), null, 2)}\n`);
  } catch (cause) {
    process.stderr.write(`${cause.message}\n`);
    process.exit(1);
  }
}
