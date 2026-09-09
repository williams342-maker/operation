import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture, start, stop } from "../../scripts/adopt-unmanaged-container.mjs";

// The container measured on the target with `docker inspect`: started with a bare `docker run`, no
// compose labels, one loopback publication, restart policy unless-stopped.
const containerId = "1e3455dd1929".padEnd(64, "a");
const imageId = `sha256:${"4e2a4c4d".padEnd(64, "b")}`;
const liveAdmin = (state = { Running: true, Status: "running" }) => ({
  Id: containerId,
  Name: "/opsworkbench-admin-web-1",
  Image: imageId,
  State: state,
  Config: {
    Image: "control-center-admin-web:4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b",
    Labels: { maintainer: "NGINX Docker Maintainers", "org.opencontainers.image.revision": "4c47c7b1" },
  },
  HostConfig: {
    PortBindings: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] },
    RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
  },
});
const stopped = () => liveAdmin({ Running: false, Status: "exited" });
const workspace = () => fs.mkdtempSync(path.join(os.tmpdir(), "adopt-"));

// `states` is consumed one inspect at a time, so a test can say "running, then stopped" and exercise
// the confirmation that follows the command rather than assuming the command worked.
const dockerFor = (states, calls = []) => {
  const queue = Array.isArray(states) ? [...states] : [states];
  return (args) => {
    calls.push(args);
    if (args[0] === "inspect") {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (!next) throw new Error("No such object");
      return JSON.stringify([next]);
    }
    return "";
  };
};

const captureAdmin = (file, container = liveAdmin()) => capture("opsworkbench-admin-web-1", file, { docker: dockerFor(container) });

test("capture records the container id and what it holds, and refuses one compose already owns", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  const record = captureAdmin(file);
  assert.equal(record.containerId, containerId);
  assert.equal(record.name, "opsworkbench-admin-web-1");
  assert.equal(record.schemaVersion, "opsworkbench-container-adoption-v3");
  assert.deepEqual(record.publishedPorts, ["127.0.0.1:18081->8080/tcp"]);
  assert.equal(record.imageId, imageId);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).containerId, containerId);
  // Overwriting the record would lose the only note of which container was stopped.
  assert.throws(() => captureAdmin(file), /exist/i);
  const owned = liveAdmin(); owned.Config.Labels["com.docker.compose.project"] = "opsworkbench";
  assert.throws(() => capture("x", path.join(root, "other.json"), { docker: dockerFor(owned) }), /already belongs to compose project/);
});

test("stop addresses the container by immutable id and confirms it is no longer running", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  captureAdmin(file);
  const calls = [];
  const result = stop(file, { docker: dockerFor([liveAdmin(), stopped()], calls) });
  assert.equal(result.status, "exited");
  // The TARGET of every call, not just the verb. Inspecting by name and then stopping by name is a
  // race: another actor can put a different container under that name in between. Asserting only the
  // verbs lets a mutation that stops something else pass.
  assert.deepEqual(calls, [
    ["inspect", "--type", "container", containerId],
    ["stop", containerId],
    ["inspect", "--type", "container", containerId],
  ]);
});

test("stop reports the observed state, not the exit code of the stop command", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  captureAdmin(file);
  // A stop that errors may still have stopped the container. What matters is whether the port is free.
  const erroringButStopped = (args) => {
    if (args[0] === "inspect") return JSON.stringify([erroringButStopped.first ? stopped() : (erroringButStopped.first = true, liveAdmin())]);
    if (args[0] === "stop") throw new Error("daemon connection reset");
    return "";
  };
  assert.equal(stop(file, { docker: erroringButStopped }).status, "exited");
  // A stop that returns cleanly but leaves it running must not be reported as success.
  assert.throws(() => stop(file, { docker: dockerFor(liveAdmin()) }), /still running/);
  assert.throws(() => stop(file, { docker: dockerFor(liveAdmin()) }), /ports are not free/);
});

test("start brings back the same container object and confirms it is running", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  captureAdmin(file);
  const calls = [];
  assert.equal(start(file, { docker: dockerFor([stopped(), liveAdmin()], calls) }).status, "running");
  assert.deepEqual(calls, [
    ["inspect", "--type", "container", containerId],
    ["start", containerId],
    ["inspect", "--type", "container", containerId],
  ]);
  // Nothing is rebuilt, so there is no command to get wrong: no `run`, no image argument, no flags.
  assert.equal(calls.some((call) => call[0] === "run"), false);
  // A start that does not result in a running container is a failure, however the command exited.
  assert.throws(() => start(file, { docker: dockerFor(stopped()) }), /exited/);
});

test("both verbs refuse a container that is no longer the captured one", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  captureAdmin(file);
  const renamed = liveAdmin(); renamed.Name = "/something-else";
  const adopted = liveAdmin(); adopted.Config.Labels["com.docker.compose.project"] = "opsworkbench";
  const different = liveAdmin(); different.Id = "9".repeat(64);
  for (const verb of [stop, start]) {
    assert.throws(() => verb(file, { docker: dockerFor(renamed) }), /renamed/);
    assert.throws(() => verb(file, { docker: dockerFor(adopted) }), /belongs to a compose project/);
    assert.throws(() => verb(file, { docker: dockerFor(different) }), /not the one that was captured/);
    assert.throws(() => verb(file, { docker: dockerFor(null) }), /No such object/);
  }
});

test("a malformed, foreign or tampered record is refused before any container is touched", () => {
  const root = workspace();
  const write = (body) => { const file = path.join(root, `r${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body)); return file; };
  const calls = [];
  const docker = dockerFor(liveAdmin(), calls);
  const cases = [
    write({ schemaVersion: "opsworkbench-container-adoption-v2", containerId, name: "opsworkbench-admin-web-1" }),
    write({ schemaVersion: "opsworkbench-container-adoption-v3", containerId: "short", name: "opsworkbench-admin-web-1" }),
    write({ schemaVersion: "opsworkbench-container-adoption-v3", containerId, name: "--privileged" }),
    write({ schemaVersion: "opsworkbench-container-adoption-v3", containerId, name: "" }),
  ];
  for (const file of cases) {
    assert.throws(() => stop(file, { docker }), /malformed/);
    assert.throws(() => start(file, { docker }), /malformed/);
  }
  assert.deepEqual(calls, [], "a record this tool will not accept never reaches Docker at all");
  assert.throws(() => stop(write("{ not json"), { docker }), /JSON/i);
});

test("a symlinked record is refused, because the file that decides which container to stop must be the file that was stat-ed", () => {
  const root = workspace(); const real = path.join(root, "admin.json");
  captureAdmin(real);
  const link = path.join(root, "link.json");
  try { fs.symlinkSync(real, link, "file"); }
  catch { return; } // Windows without developer mode cannot create symlinks; the check is Linux-facing.
  const calls = [];
  assert.throws(() => stop(link, { docker: dockerFor(liveAdmin(), calls) }), /not a regular file/);
  assert.throws(() => start(link, { docker: dockerFor(liveAdmin(), calls) }), /not a regular file/);
  assert.deepEqual(calls, []);
});
