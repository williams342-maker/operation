#!/usr/bin/env node
// Free the host port an unmanaged container holds, so the Compose project can take it over.
//
// A container started with `docker run` carries none of Compose's project/service labels, so Compose
// will neither reuse nor stop it -- it will try to bind the same host port a second time and fail part
// way through an `up`. A running container's labels cannot be changed, so it has to stop being the
// thing holding that port.
//
//   capture <name> <record>   record which container this is, and refuse if Compose already owns it
//   stop <record>             stop it, which releases its published ports
//   start <record>            start it again, if the deployment is abandoned
//
// WHY THIS STOPS RATHER THAN REMOVES. An earlier version removed the container and rebuilt it from a
// recorded `docker run` command. That cannot be made faithful. A container carries dozens of settings
// -- capabilities, resource limits, sysctls, logging, DNS, namespace modes, masked paths -- and a
// reconstruction either reproduces every one of them or silently produces a container that looks
// identical and behaves differently. The daemon's own defaults are not knowable from a single
// container's inspect output either, so "this value equals the default" was a guess. And the record
// became a command that a root process would execute, which is authority no unsigned file should carry.
//
// Stopping avoids all of it. A stopped container releases its port bindings, so Compose can bind. The
// container is its own backup: `start` restores the exact object, with its writable layer, its settings
// and its image, and nothing is reconstructed or inferred. `restart: unless-stopped` means a container
// stopped this way stays stopped across daemon restarts, so it will not come back and retake the port.
//
// REMOVAL IS DELIBERATELY NOT HERE. Once the deployment is confirmed and the Compose-managed service is
// serving, the old container can be removed by hand as a separate decision. Until then it costs some
// disk and buys an exact, complete rollback.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const schemaVersion = "opsworkbench-container-adoption-v3";
const composeProjectLabel = "com.docker.compose.project";
const namePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const containerIdPattern = /^[a-f0-9]{64}$/;

const defaultDocker = (args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function inspectContainer(reference, docker) {
  const parsed = JSON.parse(docker(["inspect", "--type", "container", reference]));
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error("inspect did not describe exactly one container");
  return parsed[0];
}

/**
 * Read the record through a file descriptor and confirm the bytes came from the file that was stat-ed,
 * refusing symlinks and anything not owned by the user running this. The record decides which container
 * a root process stops, so a file another account can replace decides that too.
 */
function loadRecord(recordPath, hooks = {}) {
  const resolved = path.resolve(recordPath);
  const before = fs.lstatSync(resolved);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("adoption record is not a regular file");
  const handle = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let body;
  try {
    const opened = fs.fstatSync(handle);
    if (before.dev !== opened.dev || before.ino !== opened.ino) throw new Error("adoption record changed while being read");
    const uid = hooks.uid ?? process.getuid?.();
    if (uid !== undefined && opened.uid !== uid) throw new Error("adoption record is not owned by this user");
    body = fs.readFileSync(handle, "utf8");
  } finally {
    fs.closeSync(handle);
  }
  const record = JSON.parse(body);
  if (record?.schemaVersion !== schemaVersion || !containerIdPattern.test(record?.containerId ?? "") || !namePattern.test(record?.name ?? "")) throw new Error("adoption record is missing or malformed");
  // Validated on load, not at the point of use: a policy this tool would refuse to reinstate must
  // not be discovered after the container has already been stopped.
  restartPolicyArgument(record.restartPolicy);
  return record;
}

const restartPolicies = new Set(["no", "always", "unless-stopped", "on-failure"]);

function restartPolicyOf(container) {
  const policy = container?.HostConfig?.RestartPolicy ?? {};
  const name = policy.Name || "no";
  if (!restartPolicies.has(name)) throw new Error(`unsupported restart policy: ${name}`);
  return { name, maximumRetryCount: Number(policy.MaximumRetryCount) || 0 };
}

/** The `--restart` argument that reinstates a recorded policy. */
function restartPolicyArgument(policy) {
  const name = policy?.name ?? "no";
  if (!restartPolicies.has(name)) throw new Error(`record restart policy is not recognised: ${name}`);
  const retries = Number(policy?.maximumRetryCount) || 0;
  if (!Number.isInteger(retries) || retries < 0 || retries > 1000) throw new Error("record restart retry count is malformed");
  return name === "on-failure" && retries ? `${name}:${retries}` : name;
}

/**
 * The two container settings that would break the promise this tool makes.
 *
 * Auto-remove means the daemon REMOVES the container when it stops, so stopping it destroys the backup
 * this whole design rests on, and the post-stop inspect would only report that the object had vanished
 * by which time it is already gone.
 *
 * A restart policy of always means the daemon starts it again after a daemon restart or a reboot even
 * though it was stopped by hand, so it could retake the port in the middle of a deployment. The
 * unless-stopped policy is the one that honours a manual stop, and it is what the target runs.
 */
function refusePreconditions(container) {
  // AutoRemove cannot be changed by `docker update`, so re-checking it before each action is belt and
  // braces rather than a race. The restart policy CAN be changed that way, so re-checking it is not.
  if (container?.HostConfig?.AutoRemove === true) throw new Error("container is set to auto-remove; stopping it would destroy it rather than preserve it");
  if ((container?.HostConfig?.RestartPolicy?.Name ?? "") === "always") throw new Error("container restart policy is always, so it would come back after a daemon restart; refusing to rely on stopping it");
}

/** The container the record names, confirmed to still be that container and still unowned. */
function confirmRecordedContainer(record, docker) {
  // Addressed by immutable id, never by name: inspecting by name and then acting by name is a race,
  // because another actor can put a different container under that name in between.
  const container = inspectContainer(record.containerId, docker);
  if (container?.Id !== record.containerId) throw new Error("the running container is not the one that was captured");
  if (String(container?.Name ?? "").replace(/^\//, "") !== record.name) throw new Error("the container has been renamed since it was captured");
  // Once Compose owns it, Compose is responsible for its lifecycle and this tool must not interfere.
  if (container?.Config?.Labels?.[composeProjectLabel]) throw new Error("the container now belongs to a compose project; refusing to touch it");
  refusePreconditions(container);
  return container;
}

export function capture(name, recordPath, hooks = {}) {
  const docker = hooks.docker ?? defaultDocker;
  const container = inspectContainer(name, docker);
  const labels = container?.Config?.Labels ?? {};
  if (labels[composeProjectLabel]) throw new Error(`container already belongs to compose project ${labels[composeProjectLabel]}; nothing to adopt`);
  const containerId = String(container.Id ?? "");
  const recordedName = String(container.Name ?? "").replace(/^\//, "");
  if (!containerIdPattern.test(containerId)) throw new Error("container id is not a full digest");
  if (!namePattern.test(recordedName)) throw new Error("container name is not a plain name");
  refusePreconditions(container);
  const publishedPorts = Object.entries(container?.HostConfig?.PortBindings ?? {}).flatMap(([port, bindings]) => (bindings ?? []).map((binding) => `${binding?.HostIp || "0.0.0.0"}:${binding?.HostPort}->${port}`));
  const record = {
    schemaVersion,
    capturedAt: new Date().toISOString(),
    containerId,
    name: recordedName,
    // Recorded so a person can see what was stopped and what it held. None of it is used to rebuild
    // anything: `start` restores the container object itself.
    imageReference: String(container?.Config?.Image ?? ""),
    imageId: String(container?.Image ?? ""),
    publishedPorts,
    // Recorded so `start` can put back what `stop` had to take away. See restartPolicyArgument.
    restartPolicy: restartPolicyOf(container),
  };
  const body = `${JSON.stringify(record, null, 2)}\n`;
  const handle = fs.openSync(recordPath, "wx", 0o600);
  try {
    fs.writeFileSync(handle, body);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  // The directory entry is fsynced too, or a crash can lose a file whose contents were already durable.
  try {
    const directory = fs.openSync(path.dirname(path.resolve(recordPath)), fs.constants.O_RDONLY);
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } catch (cause) {
    // Windows and some filesystems cannot fsync a directory at all, which is not a durability failure
    // worth refusing over. A real I/O error is, so only the "cannot do this here" codes are swallowed.
    // Catching everything would report success on a disk that is genuinely failing.
    if (!["EPERM", "EACCES", "EINVAL", "ENOTSUP", "EISDIR", "EBADF"].includes(cause?.code)) throw cause;
  }
  return record;
}

export function stop(recordPath, hooks = {}) {
  const docker = hooks.docker ?? defaultDocker;
  const record = loadRecord(recordPath, hooks);
  confirmRecordedContainer(record, docker);
  // A stop that reports an error may still have stopped the container, and a stop that returns cleanly
  // is still worth confirming, because the port is free only once it is genuinely not running. So the
  // observed state decides the outcome, not the command's exit code.
  // THE RESTART POLICY IS REMOVED BEFORE THE STOP, and this is the whole reason the design holds.
  //
  // Docker keeps an `unless-stopped` container down after a reboot by setting a manual-stop marker, but
  // it sets that marker only when it actually stops a RUNNING container. Between our inspect and our
  // stop the container can exit on its own -- a failed automatic restart, say -- and Docker then treats
  // our stop as a no-op and sets nothing. The container is stopped now and eligible to come back after
  // a daemon restart, which is exactly the thing that must not happen mid-deployment. That marker is
  // also not visible in `docker inspect`, so no amount of checking afterwards can tell us it was set.
  //
  // Setting the policy to `no` first removes the dependency on the marker altogether: whatever happens
  // in the race, the daemon has no policy under which to restart it. `start` puts the recorded policy
  // back. If this process dies in between, the container stays down, which is the safe direction.
  docker(["update", "--restart=no", record.containerId]);
  let failure;
  try { docker(["stop", record.containerId]); } catch (cause) { failure = cause; }
  const after = inspectContainer(record.containerId, docker);
  // Explicitly false, not merely "not true". A response carrying no State block tells us nothing, and
  // reading nothing as success is how a port that is still held gets reported as free.
  if (after?.State?.Running !== false) throw new Error(`container ${record.name} did not report a stopped state${failure ? ` and stop reported: ${failure.message}` : ""}; its ports may not be free`);
  return { stopped: record.name, containerId: record.containerId, status: after.State.Status ?? "unknown" };
}

export function start(recordPath, hooks = {}) {
  const docker = hooks.docker ?? defaultDocker;
  const record = loadRecord(recordPath, hooks);
  confirmRecordedContainer(record, docker);
  let failure;
  try { docker(["start", record.containerId]); } catch (cause) { failure = cause; }
  const after = inspectContainer(record.containerId, docker);
  // Docker reports Running true for a PAUSED container and for one in a restart loop, so Running alone
  // would call both a successful restore. Docker also refuses to start a paused container outright, and
  // swallowing that refusal and then reading Running would turn the refusal into a success.
  const state = after?.State ?? {};
  const restored = state.Running === true && state.Paused !== true && state.Restarting !== true;
  if (!restored) throw new Error(`container ${record.name} is ${state.Status ?? "in an unknown state"}${failure ? ` and start reported: ${failure.message}` : ""}`);
  // Put back the policy `stop` removed. Done only once it is genuinely running: restoring `always` to a
  // container that did not come up would hand the daemon a restart loop instead of a clear failure.
  const policy = restartPolicyArgument(record.restartPolicy);
  docker(["update", `--restart=${policy}`, record.containerId]);
  return { started: record.name, containerId: record.containerId, status: state.Status ?? "running", restartPolicy: policy };
}

const verbs = { capture: (args) => capture(args[0], args[1]), stop: (args) => stop(args[0]), start: (args) => start(args[0]) };

// Runs as a CLI, imports as a module for the tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [verb, ...args] = process.argv.slice(2);
  if (!verbs[verb] || !args.length) {
    process.stderr.write("usage: adopt-unmanaged-container.mjs capture <name> <record> | stop <record> | start <record>\n");
    process.exit(2);
  }
  try {
    process.stdout.write(`${JSON.stringify(verbs[verb](args), null, 2)}\n`);
  } catch (cause) {
    process.stderr.write(`${cause.message}\n`);
    process.exit(1);
  }
}
