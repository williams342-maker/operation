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
  // The restart policy is removed BEFORE the stop. Docker sets the manual-stop marker that keeps an
  // unless-stopped container down only when it stops a container that is still running, and between the
  // inspect and the stop it can exit on its own -- leaving it stopped now and eligible to come back
  // after a reboot. Taking the policy away first removes the dependency on that marker entirely.
  assert.deepEqual(calls, [
    ["inspect", "--type", "container", containerId],
    ["update", "--restart=no", containerId],
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
  assert.throws(() => stop(file, { docker: dockerFor(liveAdmin()) }), /did not report a stopped state/);
  assert.throws(() => stop(file, { docker: dockerFor(liveAdmin()) }), /ports may not be free/);
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
    ["update", "--restart=unless-stopped", containerId],
  ], "and the recorded restart policy is put back, but only once it is genuinely running");
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

test("stop disarms the restart policy first, and start reinstates exactly what was recorded", () => {
  const root = workspace();
  // on-failure carries a retry count, which has to survive the round trip or the restored container
  // retries forever instead of five times.
  const onFailure = liveAdmin(); onFailure.HostConfig.RestartPolicy = { Name: "on-failure", MaximumRetryCount: 5 };
  const file = path.join(root, "onfailure.json");
  const record = capture("opsworkbench-admin-web-1", file, { docker: dockerFor(onFailure) });
  assert.deepEqual(record.restartPolicy, { name: "on-failure", maximumRetryCount: 5 });
  const calls = [];
  start(file, { docker: dockerFor([{ ...onFailure, State: { Running: false, Status: "exited" } }, onFailure], calls) });
  assert.deepEqual(calls.at(-1), ["update", "--restart=on-failure:5", containerId]);

  // A start that did not bring the container up must NOT reinstate the policy: handing `always` back to
  // a container that will not run turns a clear failure into a restart loop.
  const failedStart = [];
  assert.throws(() => start(file, { docker: dockerFor({ ...onFailure, State: { Running: false, Status: "exited" } }, failedStart) }), /exited/);
  assert.equal(failedStart.some((call) => call[0] === "update"), false);

  // A record whose policy this tool would refuse to reinstate is refused on LOAD, before the container
  // is touched at all -- not after it has already been stopped.
  const bad = path.join(root, "bad.json");
  const copy = JSON.parse(fs.readFileSync(file, "utf8"));
  copy.restartPolicy = { name: "sometimes", maximumRetryCount: 0 };
  fs.writeFileSync(bad, JSON.stringify(copy));
  const untouched = [];
  assert.throws(() => stop(bad, { docker: dockerFor(onFailure, untouched) }), /restart policy is not recognised/);
  assert.throws(() => start(bad, { docker: dockerFor(onFailure, untouched) }), /restart policy is not recognised/);
  assert.deepEqual(untouched, []);
});

test("a container that would be destroyed or resurrected by stopping is refused", () => {
  const root = workspace();
  // `--rm` means the daemon removes the container when it stops. Stopping it would destroy the very
  // backup this design depends on, and the post-stop inspect would only find that it had vanished.
  const autoRemove = liveAdmin(); autoRemove.HostConfig.AutoRemove = true;
  assert.throws(() => capture("opsworkbench-admin-web-1", path.join(root, "a.json"), { docker: dockerFor(autoRemove) }), /auto-remove/);
  // `restart: always` outranks a manual stop after a daemon restart, so the container could come back
  // and retake the port mid-deployment. `unless-stopped`, which the target runs, does not.
  const always = liveAdmin(); always.HostConfig.RestartPolicy = { Name: "always", MaximumRetryCount: 0 };
  assert.throws(() => capture("opsworkbench-admin-web-1", path.join(root, "b.json"), { docker: dockerFor(always) }), /always/);
  // The same settings are refused at action time too, not only at capture: they can be changed with
  // `docker update` after the record was written.
  const file = path.join(root, "c.json");
  captureAdmin(file);
  for (const verb of [stop, start]) {
    assert.throws(() => verb(file, { docker: dockerFor(autoRemove) }), /auto-remove/);
    assert.throws(() => verb(file, { docker: dockerFor(always) }), /always/);
  }
});

test("a container that exited on its own between the inspect and the stop still cannot come back", () => {
  // The race that made the previous approach unsound: the container exits by itself after the inspect,
  // so Docker treats the stop as a no-op and never sets the manual-stop marker, leaving it eligible to
  // restart after a reboot. Disarming the policy first means there is no policy to restart it under,
  // whichever way the race goes -- so stopping an already-exited container is now safe rather than
  // refused, and the disarm still happens.
  const root = workspace(); const file = path.join(root, "admin.json");
  captureAdmin(file);
  const calls = [];
  const result = stop(file, { docker: dockerFor(stopped(), calls) });
  assert.equal(result.status, "exited");
  assert.deepEqual(calls[1], ["update", "--restart=no", containerId], "the policy is removed before the stop is attempted");
  assert.equal(calls.findIndex((call) => call[0] === "update") < calls.findIndex((call) => call[0] === "stop"), true);
});

test("stop requires an explicitly stopped state afterwards, not merely the absence of one", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  captureAdmin(file);
  // A response carrying no State block tells us nothing. Reading nothing as success is how a port that
  // is still held gets reported as free.
  const stateless = liveAdmin(); delete stateless.State;
  assert.throws(() => stop(file, { docker: dockerFor([liveAdmin(), stateless]) }), /did not report a stopped state/);
});

test("start refuses paused and restart-looping containers, which both report Running", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  captureAdmin(file);
  const paused = liveAdmin({ Running: true, Paused: true, Status: "paused" });
  const restarting = liveAdmin({ Running: true, Restarting: true, Status: "restarting" });
  assert.throws(() => start(file, { docker: dockerFor([stopped(), paused]) }), /paused/);
  assert.throws(() => start(file, { docker: dockerFor([stopped(), restarting]) }), /restarting/);
});

test("start reports the observed state, not the exit code of the start command", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  captureAdmin(file);
  // Symmetric with stop: a start that errors may still have started it, and what matters is whether the
  // container came back. Only stop was covered before, so throwing the command error early survived.
  let seen = 0;
  const erroringButStarted = (args) => {
    if (args[0] === "inspect") return JSON.stringify([seen++ === 0 ? stopped() : liveAdmin()]);
    if (args[0] === "start") throw new Error("daemon connection reset");
    return "";
  };
  assert.equal(start(file, { docker: erroringButStarted }).status, "running");
});

test("a record owned by someone else is refused before any container is touched", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  captureAdmin(file);
  const calls = [];
  // The uid is injected so this runs everywhere. On Windows process.getuid does not exist, so without
  // the injection the check would be skipped locally and only ever exercised in CI.
  const mine = fs.statSync(file).uid;
  for (const verb of [stop, start]) {
    assert.throws(() => verb(file, { docker: dockerFor(liveAdmin(), calls), uid: mine + 1 }), /not owned by this user/);
  }
  assert.deepEqual(calls, [], "a record this tool will not accept never reaches Docker");
  assert.equal(stop(file, { docker: dockerFor([liveAdmin(), stopped()]), uid: mine }).status, "exited");
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
  catch (cause) {
    // Skip ONLY where symlinks genuinely cannot be created: Windows without developer mode. Returning
    // on any error would turn a Linux CI setup failure into a passing test, which is the failure this
    // whole file exists to avoid.
    //
    // Note for anyone mutation-testing this: deleting the `isSymbolicLink()` term alone does NOT break
    // this test on any platform, and that is correct rather than a coverage gap. `lstat` reports a
    // symlink as not a regular file, so the `isFile()` term already rejects it, and `O_NOFOLLOW` on the
    // open is a third guard. The term is kept because it names the intent at the point of the check.
    if (process.platform === "win32" && (cause.code === "EPERM" || cause.code === "EACCES")) return;
    throw cause;
  }
  const calls = [];
  assert.throws(() => stop(link, { docker: dockerFor(liveAdmin(), calls) }), /not a regular file/);
  assert.throws(() => start(link, { docker: dockerFor(liveAdmin(), calls) }), /not a regular file/);
  assert.deepEqual(calls, []);
});
