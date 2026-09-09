import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture, release, restore, restoreCommand } from "../../scripts/adopt-unmanaged-container.mjs";

// The shape measured on the target, not an invented one: a bare `docker run` container with no compose
// labels, no mounts, no added environment, one network, one loopback publication. A fixture that
// differed from the real container would let a broken restore command pass.
const liveAdmin = () => ({
  Id: "sha256container".padEnd(64, "0"),
  Name: "/opsworkbench-admin-web-1",
  Image: "sha256:4e2a4c4d4a2b75b78bb67081659dec13c77e505cafe9bae2619e639a79668683",
  Config: {
    Image: "control-center-admin-web:4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b",
    Cmd: ["nginx", "-g", "daemon off;"],
    Env: ["PATH=/usr/local/sbin:/usr/local/bin", "NGINX_VERSION=1.27.5", "NJS_VERSION=0.8.10"],
    Labels: { maintainer: "NGINX Docker Maintainers <docker-maint@nginx.com>", "org.opencontainers.image.revision": "4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b" },
    Healthcheck: { Test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/admin-healthz >/dev/null || exit 1"], Interval: 30000000000, Timeout: 5000000000, StartPeriod: 10000000000, Retries: 3 },
    Entrypoint: ["/docker-entrypoint.sh"], User: "", WorkingDir: "/",
  },
  HostConfig: { PortBindings: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] }, RestartPolicy: { Name: "unless-stopped" }, Binds: null },
  Mounts: [],
  NetworkSettings: { Networks: { opsworkbench_internal: { Aliases: null, IPAddress: "172.18.0.2" } } },
});
const imageEnv = ["PATH=/usr/local/sbin:/usr/local/bin", "NGINX_VERSION=1.27.5", "NJS_VERSION=0.8.10"];
// The real container's healthcheck, entrypoint, user and working directory all come from the image and
// are identical to it -- verified on the target. The fixture matches, so an override in a test is a
// deliberate difference rather than an artefact of a sloppy fixture.
const imageConfig = { Env: imageEnv, Healthcheck: { Test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/admin-healthz >/dev/null || exit 1"], Interval: 30000000000, Timeout: 5000000000, StartPeriod: 10000000000, Retries: 3 }, Entrypoint: ["/docker-entrypoint.sh"], User: "", WorkingDir: "/" };
const workspace = () => fs.mkdtempSync(path.join(os.tmpdir(), "adopt-"));
const dockerFor = (container, calls, image = { Config: imageConfig }) => (args) => {
  calls.push(args);
  if (args[0] === "inspect") { if (!container) throw new Error("No such object"); return JSON.stringify([container]); }
  if (args[0] === "image") return JSON.stringify([image]);
  return "";
};

test("the restore command reproduces the publication, network and restart policy, and no image environment", () => {
  const argv = restoreCommand(liveAdmin(), imageConfig);
  assert.deepEqual(argv, ["run", "--detach", "--name", "opsworkbench-admin-web-1", "--network", "opsworkbench_internal", "--restart", "unless-stopped", "--publish", "127.0.0.1:18081:8080", "control-center-admin-web:4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b", "nginx", "-g", "daemon off;"]);
  // Variables the image supplies must not be pinned into the restore: they are meant to move with it.
  assert.equal(argv.includes("--env"), false);
  // One the RUN added must be, or the restored container is not the one that was removed.
  const added = restoreCommand({ ...liveAdmin(), Config: { ...liveAdmin().Config, Env: [...imageEnv, "ADMIN_FLAG=on"] } }, imageConfig);
  assert.deepEqual(added.slice(added.indexOf("--env"), added.indexOf("--env") + 2), ["--env", "ADMIN_FLAG=on"]);
});

test("a container this transition cannot faithfully reproduce is refused rather than half-restored", () => {
  const withBind = liveAdmin(); withBind.HostConfig.Binds = ["/etc/thing:/thing:ro"];
  assert.throws(() => restoreCommand(withBind, imageConfig), /mounts/);
  const withMount = liveAdmin(); withMount.Mounts = [{ Source: "/etc/thing", Destination: "/thing" }];
  assert.throws(() => restoreCommand(withMount, imageConfig), /mounts/);
  const twoNetworks = liveAdmin(); twoNetworks.NetworkSettings.Networks.other = { Aliases: null };
  assert.throws(() => restoreCommand(twoNetworks, imageConfig), /exactly one network/);
  const noNetwork = liveAdmin(); noNetwork.NetworkSettings.Networks = {};
  assert.throws(() => restoreCommand(noNetwork, imageConfig), /exactly one network/);
});

test("a run-time override the restore command cannot reproduce is refused", () => {
  // All four of these are image-provided on the target, so the transition is faithful there. If a
  // container ever carries its own, restoring it from this record would produce something that looks
  // identical and behaves differently.
  const overridden = (field, value) => { const container = liveAdmin(); container.Config[field] = value; return container; };
  assert.throws(() => restoreCommand(overridden("Healthcheck", { Test: ["CMD-SHELL", "true"] }), imageConfig), /healthcheck/);
  assert.throws(() => restoreCommand(overridden("Entrypoint", ["/other-entrypoint.sh"]), imageConfig), /entrypoint/);
  assert.throws(() => restoreCommand(overridden("User", "nobody"), imageConfig), /user/);
  assert.throws(() => restoreCommand(overridden("WorkingDir", "/srv"), imageConfig), /working directory/);
  // Disabling the healthcheck entirely is an override too, not an absence.
  assert.throws(() => restoreCommand(overridden("Healthcheck", { Test: ["NONE"] }), imageConfig), /healthcheck/);
});

test("capture writes the record once and refuses a container compose already owns", () => {
  const root = workspace(); const file = path.join(root, "admin.json"); const calls = [];
  const record = capture("opsworkbench-admin-web-1", file, { docker: dockerFor(liveAdmin(), calls) });
  assert.equal(record.name, "opsworkbench-admin-web-1");
  assert.equal(record.schemaVersion, "opsworkbench-container-adoption-v1");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).restore, record.restore);
  // Writing over an existing record would destroy the only description of what was removed.
  assert.throws(() => capture("opsworkbench-admin-web-1", file, { docker: dockerFor(liveAdmin(), []) }), /exist/i);
  const owned = liveAdmin(); owned.Config.Labels["com.docker.compose.project"] = "opsworkbench";
  assert.throws(() => capture("x", path.join(root, "other.json"), { docker: dockerFor(owned, []) }), /already belongs to compose project/);
});

test("release stops then removes, and only the exact container that was captured", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  capture("opsworkbench-admin-web-1", file, { docker: dockerFor(liveAdmin(), []) });

  const moved = liveAdmin(); moved.Id = "sha256different".padEnd(64, "1");
  assert.throws(() => release(file, { docker: dockerFor(moved, []) }), /not the one that was captured/);

  const adopted = liveAdmin(); adopted.Config.Labels["com.docker.compose.project"] = "opsworkbench";
  assert.throws(() => release(file, { docker: dockerFor(adopted, []) }), /refusing to remove/);

  const calls = [];
  const result = release(file, { docker: dockerFor(liveAdmin(), calls) });
  assert.equal(result.removed, "opsworkbench-admin-web-1");
  assert.deepEqual(calls.map((call) => call[0]), ["inspect", "stop", "rm"], "stopped before removal, and only after inspection");
});

test("restore replays the recorded command and never writes over an existing container", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  const record = capture("opsworkbench-admin-web-1", file, { docker: dockerFor(liveAdmin(), []) });
  assert.throws(() => restore(file, { docker: dockerFor(liveAdmin(), []) }), /already exists/);
  const calls = [];
  assert.deepEqual(restore(file, { docker: dockerFor(null, calls) }), { restored: "opsworkbench-admin-web-1" });
  assert.deepEqual(calls.at(-1), record.restore, "the container is recreated from the record, not rebuilt from guesswork");
});

test("a malformed or foreign record is refused by both destructive verbs", () => {
  const root = workspace(); const file = path.join(root, "bad.json");
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: "something-else", name: "x", restore: [] }));
  assert.throws(() => release(file, { docker: dockerFor(liveAdmin(), []) }), /malformed/);
  assert.throws(() => restore(file, { docker: dockerFor(null, []) }), /malformed/);
});
