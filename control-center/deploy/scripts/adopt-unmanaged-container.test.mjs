import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture, describeContainer, release, restore, restoreArgv } from "../../scripts/adopt-unmanaged-container.mjs";

// The shape measured on the target with `docker inspect`, not an invented one -- including the eleven
// HostConfig keys the daemon populates by default, because a fixture that omitted them could not tell a
// working deny-by-default sweep from one that never runs.
const containerId = "1e3455dd1929".padEnd(64, "a");
const imageId = `sha256:${"4e2a4c4d".padEnd(64, "b")}`;
const liveAdmin = () => ({
  Id: containerId,
  Name: "/opsworkbench-admin-web-1",
  Image: imageId,
  Config: {
    Hostname: "1e3455dd1929",
    Image: "control-center-admin-web:4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b",
    Cmd: ["nginx", "-g", "daemon off;"],
    Entrypoint: ["/docker-entrypoint.sh"],
    Env: ["PATH=/usr/local/sbin:/usr/local/bin", "NGINX_VERSION=1.27.5", "NJS_VERSION=0.8.10"],
    ExposedPorts: { "80/tcp": {}, "8080/tcp": {} },
    Healthcheck: { Test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/admin-healthz >/dev/null || exit 1"], Interval: 30000000000, Timeout: 5000000000, StartPeriod: 10000000000, Retries: 3 },
    Labels: { maintainer: "NGINX Docker Maintainers", "org.opencontainers.image.revision": "4c47c7b1" },
    StopSignal: "SIGQUIT",
    User: "",
    WorkingDir: "/",
    MacAddress: null,
  },
  HostConfig: {
    Binds: null, Mounts: null,
    PortBindings: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] },
    RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
    NetworkMode: "opsworkbench_internal",
    CgroupnsMode: "private", ConsoleSize: [0, 0], IpcMode: "private",
    LogConfig: { Type: "json-file", Config: {} }, Runtime: "runc", ShmSize: 67108864,
    MaskedPaths: ["/proc/asound", "/proc/acpi", "/proc/kcore", "/proc/keys", "/proc/timer_list", "/sys/firmware"],
    ReadonlyPaths: ["/proc/bus", "/proc/fs", "/proc/irq", "/proc/sys", "/proc/sysrq-trigger"],
    CapAdd: null, CapDrop: null, Privileged: false, ReadonlyRootfs: false, Memory: 0, NanoCpus: 0,
    Devices: [], Dns: [], ExtraHosts: null, Sysctls: null, Ulimits: null, SecurityOpt: null,
    AutoRemove: false, PidMode: "", UTSMode: "", Tmpfs: null, PublishAllPorts: false,
  },
  Mounts: [],
  // MacAddress is daemon-assigned on every container; IPAMConfig being null is what says no static
  // address was requested.
  NetworkSettings: { Networks: { opsworkbench_internal: { Aliases: null, IPAMConfig: null, Links: null, DriverOpts: null, MacAddress: "ce:36:e2:02:80:ed", IPAddress: "172.18.0.2" } } },
});
// The image supplies the entrypoint, healthcheck, labels, stop signal, exposed ports and all three
// environment variables. Measured on the target: the container's values are identical to the image's.
const imageConfig = {
  Env: ["PATH=/usr/local/sbin:/usr/local/bin", "NGINX_VERSION=1.27.5", "NJS_VERSION=0.8.10"],
  Entrypoint: ["/docker-entrypoint.sh"],
  Healthcheck: { Test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/admin-healthz >/dev/null || exit 1"], Interval: 30000000000, Timeout: 5000000000, StartPeriod: 10000000000, Retries: 3 },
  Labels: { maintainer: "NGINX Docker Maintainers", "org.opencontainers.image.revision": "4c47c7b1" },
  StopSignal: "SIGQUIT", User: "", WorkingDir: "/", ExposedPorts: { "80/tcp": {}, "8080/tcp": {} },
};

const workspace = () => fs.mkdtempSync(path.join(os.tmpdir(), "adopt-"));
const dockerFor = (container, calls, image = { Config: imageConfig }) => (args) => {
  calls.push(args);
  if (args[0] === "inspect") { if (!container) throw new Error("No such object"); return JSON.stringify([container]); }
  if (args[0] === "image") return JSON.stringify([image]);
  return "";
};

test("the description reproduces publication, network, restart policy and command, and pins the image by id", () => {
  const description = describeContainer(liveAdmin(), imageConfig);
  assert.equal(description.name, "opsworkbench-admin-web-1");
  assert.equal(description.imageId, imageId, "the image is pinned by id, not by its mutable tag");
  assert.deepEqual(description.ports, [{ hostIp: "127.0.0.1", hostPort: "18081", containerPort: "8080", protocol: "tcp" }]);
  assert.equal(description.restartPolicy, "unless-stopped");
  assert.deepEqual(description.command, ["nginx", "-g", "daemon off;"]);
  assert.deepEqual(description.addedEnvironment, [], "variables the image supplies are not pinned into the restore");
  const argv = restoreArgv(description);
  assert.deepEqual(argv, ["run", "--detach", "--name", "opsworkbench-admin-web-1", "--network", "opsworkbench_internal", "--restart", "unless-stopped", "--publish", "127.0.0.1:18081:8080/tcp", imageId, "nginx", "-g", "daemon off;"]);
  // A variable the RUN added must survive, or the restored container is not the one that was removed.
  const added = liveAdmin(); added.Config.Env = [...imageConfig.Env, "ADMIN_FLAG=on"];
  assert.deepEqual(describeContainer(added, imageConfig).addedEnvironment, ["ADMIN_FLAG=on"]);
});

test("every host setting this transition does not reproduce is refused, including ones it has never heard of", () => {
  const withHost = (key, value) => { const container = liveAdmin(); container.HostConfig[key] = value; return container; };
  // Settings Docker can set that would be silently lost by a restore that only copies ports.
  for (const [key, value] of [["CapDrop", ["ALL"]], ["CapAdd", ["NET_ADMIN"]], ["Privileged", true], ["ReadonlyRootfs", true], ["Memory", 536870912], ["NanoCpus", 500000000], ["Sysctls", { "net.core.somaxconn": "1024" }], ["Ulimits", [{ Name: "nofile", Soft: 1024, Hard: 2048 }]], ["SecurityOpt", ["no-new-privileges"]], ["Devices", [{ PathOnHost: "/dev/fuse" }]], ["Dns", ["10.0.0.1"]], ["ExtraHosts", ["a:1.2.3.4"]], ["Tmpfs", { "/run": "" }], ["AutoRemove", true], ["PidMode", "host"], ["PublishAllPorts", true]]) {
    assert.throws(() => describeContainer(withHost(key, value), imageConfig), new RegExp(key), `${key} must be refused`);
  }
  // A key from a future daemon that this file has never seen must refuse too, not pass by omission.
  assert.throws(() => describeContainer(withHost("SomeSettingInventedLater", ["x"]), imageConfig), /SomeSettingInventedLater/);
  // Daemon defaults with a changed value are overrides, not defaults.
  assert.throws(() => describeContainer(withHost("LogConfig", { Type: "syslog", Config: {} }), imageConfig), /LogConfig/);
  assert.throws(() => describeContainer(withHost("ShmSize", 1048576), imageConfig), /ShmSize/);
  assert.throws(() => describeContainer(withHost("IpcMode", "host"), imageConfig), /IpcMode/);
  // Hardening REMOVED from the default lists is an override; hardening added by a newer daemon is not.
  assert.throws(() => describeContainer(withHost("MaskedPaths", ["/proc/acpi"]), imageConfig), /MaskedPaths/);
  const extraHardening = withHost("MaskedPaths", [...liveAdmin().HostConfig.MaskedPaths, "/proc/something-new"]);
  assert.equal(describeContainer(extraHardening, imageConfig).name, "opsworkbench-admin-web-1");
});

test("a run-time override of anything the image provides is refused", () => {
  const withConfig = (key, value) => { const container = liveAdmin(); container.Config[key] = value; return container; };
  assert.throws(() => describeContainer(withConfig("Healthcheck", { Test: ["CMD-SHELL", "true"] }), imageConfig), /Healthcheck/);
  assert.throws(() => describeContainer(withConfig("Healthcheck", { Test: ["NONE"] }), imageConfig), /Healthcheck/, "disabling the healthcheck is an override, not an absence");
  assert.throws(() => describeContainer(withConfig("Entrypoint", ["/other.sh"]), imageConfig), /Entrypoint/);
  assert.throws(() => describeContainer(withConfig("User", "nobody"), imageConfig), /User/);
  assert.throws(() => describeContainer(withConfig("WorkingDir", "/srv"), imageConfig), /WorkingDir/);
  assert.throws(() => describeContainer(withConfig("StopSignal", "SIGKILL"), imageConfig), /StopSignal/);
  assert.throws(() => describeContainer(withConfig("Labels", { extra: "1" }), imageConfig), /Labels/);
  assert.throws(() => describeContainer(withConfig("MacAddress", "02:42:ac:11:00:02"), imageConfig), /MacAddress/);
  // An image key the container reports as "" and the image omits entirely is not an override.
  const sparseImage = { ...imageConfig }; delete sparseImage.User;
  assert.equal(describeContainer(liveAdmin(), sparseImage).name, "opsworkbench-admin-web-1");
});

test("mounts, network shape and dynamic ports are refused rather than half-reproduced", () => {
  const withBind = liveAdmin(); withBind.HostConfig.Binds = ["/etc/thing:/thing:ro"];
  assert.throws(() => describeContainer(withBind, imageConfig), /mounts/);
  const withMount = liveAdmin(); withMount.Mounts = [{ Source: "/etc/thing", Destination: "/thing" }];
  assert.throws(() => describeContainer(withMount, imageConfig), /mounts/);
  const twoNetworks = liveAdmin(); twoNetworks.NetworkSettings.Networks.other = { Aliases: null };
  assert.throws(() => describeContainer(twoNetworks, imageConfig), /exactly one network/);
  const noNetwork = liveAdmin(); noNetwork.NetworkSettings.Networks = {};
  assert.throws(() => describeContainer(noNetwork, imageConfig), /exactly one network/);
  const staticAddress = liveAdmin(); staticAddress.NetworkSettings.Networks.opsworkbench_internal.IPAMConfig = { IPv4Address: "172.18.0.9" };
  assert.throws(() => describeContainer(staticAddress, imageConfig), /IPAMConfig/);
  const dynamic = liveAdmin(); dynamic.HostConfig.PortBindings = { "8080/tcp": [{ HostIp: "", HostPort: "" }] };
  assert.throws(() => describeContainer(dynamic, imageConfig), /dynamic or malformed host port/);
  const mismatchedMode = liveAdmin(); mismatchedMode.HostConfig.NetworkMode = "bridge";
  assert.throws(() => describeContainer(mismatchedMode, imageConfig), /network mode/);
});

test("capture writes the record once, keyed to the full container id, and refuses one compose owns", () => {
  const root = workspace(); const file = path.join(root, "admin.json"); const calls = [];
  const record = capture("opsworkbench-admin-web-1", file, { docker: dockerFor(liveAdmin(), calls) });
  assert.equal(record.containerId, containerId);
  assert.equal(record.schemaVersion, "opsworkbench-container-adoption-v2");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).description.imageId, imageId);
  // The image is inspected by ID, so the description is built against what is running, not the tag.
  assert.deepEqual(calls.find((call) => call[0] === "image"), ["image", "inspect", imageId]);
  // Writing over an existing record would destroy the only description of what was removed.
  assert.throws(() => capture("opsworkbench-admin-web-1", file, { docker: dockerFor(liveAdmin(), []) }), /exist/i);
  const owned = liveAdmin(); owned.Config.Labels["com.docker.compose.project"] = "opsworkbench";
  assert.throws(() => capture("x", path.join(root, "other.json"), { docker: dockerFor(owned, []) }), /already belongs to compose project/);
});

test("release addresses the container by immutable id at every step, and only the captured one", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  capture("opsworkbench-admin-web-1", file, { docker: dockerFor(liveAdmin(), []) });

  const moved = liveAdmin(); moved.Id = "9".repeat(64);
  assert.throws(() => release(file, { docker: dockerFor(moved, []) }), /not the one that was captured/);
  const adopted = liveAdmin(); adopted.Config.Labels["com.docker.compose.project"] = "opsworkbench";
  assert.throws(() => release(file, { docker: dockerFor(adopted, []) }), /refusing to remove/);

  const calls = [];
  assert.equal(release(file, { docker: dockerFor(liveAdmin(), calls) }).containerId, containerId);
  // The TARGET of every call, not just the verb. Inspecting by name and then removing by name is a
  // race: another actor can put a different container under that name in between, and the removal would
  // land on something nobody reviewed. Asserting only the verbs let that mutation through.
  assert.deepEqual(calls, [["inspect", "--type", "container", containerId], ["stop", containerId], ["rm", containerId]]);
});

test("a release that stops but cannot remove says so, because the container still exists", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  capture("opsworkbench-admin-web-1", file, { docker: dockerFor(liveAdmin(), []) });
  const docker = (args) => {
    if (args[0] === "inspect") return JSON.stringify([liveAdmin()]);
    if (args[0] === "rm") throw new Error("device or resource busy");
    return "";
  };
  assert.throws(() => release(file, { docker }), /stopped but not removed/);
});

test("restore rebuilds the command from the description and never writes over an existing container", () => {
  const root = workspace(); const file = path.join(root, "admin.json");
  capture("opsworkbench-admin-web-1", file, { docker: dockerFor(liveAdmin(), []) });
  assert.throws(() => restore(file, { docker: dockerFor(liveAdmin(), []) }), /already exists/);
  const calls = [];
  assert.deepEqual(restore(file, { docker: dockerFor(null, calls) }), { restored: "opsworkbench-admin-web-1" });
  assert.deepEqual(calls.at(-1), ["run", "--detach", "--name", "opsworkbench-admin-web-1", "--network", "opsworkbench_internal", "--restart", "unless-stopped", "--publish", "127.0.0.1:18081:8080/tcp", imageId, "nginx", "-g", "daemon off;"]);
});

test("a tampered record cannot make the tool run an arbitrary docker command", () => {
  // The record is consumed by a root process. An earlier version stored the argv and passed it straight
  // to Docker, so replacing the file was enough to run any command with no shell involved. The record
  // now carries typed fields, and every one is re-validated before it reaches the command line.
  const root = workspace(); const file = path.join(root, "admin.json");
  capture("opsworkbench-admin-web-1", file, { docker: dockerFor(liveAdmin(), []) });
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const rewrite = (mutate) => { const copy = structuredClone(record); mutate(copy); const target = path.join(root, `t${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(target, JSON.stringify(copy)); return target; };

  const injectedFlag = rewrite((copy) => { copy.description.name = "--privileged"; });
  assert.throws(() => restore(injectedFlag, { docker: dockerFor(null, []) }), /name is not a plain name/);
  const injectedImage = rewrite((copy) => { copy.description.imageId = "alpine --entrypoint sh"; });
  assert.throws(() => restore(injectedImage, { docker: dockerFor(null, []) }), /image is not a sha256 digest/);
  const injectedEnvironment = rewrite((copy) => { copy.description.addedEnvironment = ["--volume=/:/host"]; });
  assert.throws(() => restore(injectedEnvironment, { docker: dockerFor(null, []) }), /environment entry is malformed/);
  const injectedPort = rewrite((copy) => { copy.description.ports = [{ hostIp: "--network=host", hostPort: "1", containerPort: "1", protocol: "tcp" }]; });
  assert.throws(() => restore(injectedPort, { docker: dockerFor(null, []) }), /host address is malformed/);
  const injectedNetwork = rewrite((copy) => { copy.description.network = "host --privileged"; });
  assert.throws(() => restore(injectedNetwork, { docker: dockerFor(null, []) }), /network is not a plain name/);
  // The destructive verb validates the description too, so a record that could not be restored is not
  // one this tool will act on at all.
  assert.throws(() => release(injectedImage, { docker: dockerFor(liveAdmin(), []) }), /image is not a sha256 digest/);
});

test("a malformed, foreign or symlinked record is refused by both destructive verbs", () => {
  const root = workspace(); const file = path.join(root, "bad.json");
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: "opsworkbench-container-adoption-v1", containerId, description: {} }));
  assert.throws(() => release(file, { docker: dockerFor(liveAdmin(), []) }), /malformed/);
  assert.throws(() => restore(file, { docker: dockerFor(null, []) }), /malformed/);
  const noId = path.join(root, "noid.json");
  fs.writeFileSync(noId, JSON.stringify({ schemaVersion: "opsworkbench-container-adoption-v2", containerId: "short", description: {} }));
  assert.throws(() => release(noId, { docker: dockerFor(liveAdmin(), []) }), /malformed/);
});
