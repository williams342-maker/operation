import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// A container healthcheck runs INSIDE the container, against 127.0.0.1, carrying no Host header that
// matches any `server_name`. So it lands in NGINX's default server block -- and a default block that
// exists to refuse unrecognised traffic will refuse the healthcheck too.
//
// That is not hypothetical. The admin service's healthcheck asked for `/`, the default block answers
// `location / { return 444; }`, and 444 closes the connection with no response, so `wget` exits 1 and
// the container never reports healthy. `compose up --wait` would have hung and then failed on the very
// first deployment, in both directions, because the same config ships in every image built from it.
// Reading the two files separately never showed it; running the healthcheck command did.
const here = path.dirname(fileURLToPath(import.meta.url));
const deploy = path.resolve(here, "..");
const compose = fs.readFileSync(path.join(deploy, "docker-compose.production.yml"), "utf8");

/** The healthcheck command of each service that declares one. */
function healthchecks(text) {
  const found = new Map();
  let service = null;
  for (const line of text.split(/\r?\n/)) {
    const declared = /^ {2}([a-z][a-z0-9_-]*):\s*$/.exec(line);
    if (declared) service = declared[1];
    const command = /^\s+test:\s*(\[.*\])\s*$/.exec(line);
    if (command && service) found.set(service, JSON.parse(command[1]).join(" "));
  }
  return found;
}

/** Paths the DEFAULT server block answers with a success status, and paths it refuses. */
function defaultServerPaths(conf) {
  const blocks = conf.split(/^server \{/m).slice(1);
  const fallback = blocks.find((block) => /listen\s+\d+\s+default_server/.test(block));
  if (!fallback) return null;
  const served = new Set();
  const refused = new Set();
  for (const match of fallback.matchAll(/location\s*(?:=\s*)?(\S+)\s*\{([^}]*)\}/g)) {
    const [, location, body] = match;
    if (/return\s+2\d\d/.test(body)) served.add(location);
    else if (/return\s+444/.test(body) || /return\s+[45]\d\d/.test(body)) refused.add(location);
  }
  return { served, refused };
}

test("every healthcheck asks for a path its own default server block will actually answer", () => {
  const checks = healthchecks(compose);
  assert.ok(checks.size >= 3, "the compose file should declare healthchecks to check");

  // Only the admin surface ships a config with a refusing default server. If another service grows one,
  // this test starts covering it too rather than needing to be remembered.
  const configs = { admin: path.join(deploy, "nginx", "admin-web.conf") };
  for (const [service, configPath] of Object.entries(configs)) {
    const command = checks.get(service);
    assert.ok(command, `${service} declares a healthcheck`);
    const requested = /https?:\/\/[^/\s]+(\/\S*?)(?:\s|$|>)/.exec(command);
    assert.ok(requested, `${service}'s healthcheck requests a URL path`);
    const paths = defaultServerPaths(fs.readFileSync(configPath, "utf8"));
    assert.ok(paths, `${configPath} declares a default server block`);
    assert.equal(paths.refused.has("/"), true, "the default block refuses / -- which is why this matters");
    assert.equal(
      paths.served.has(requested[1]),
      true,
      `${service} healthchecks ${requested[1]}, which its default server block does not answer with a success status; it serves ${[...paths.served].join(", ")}`,
    );
  }
});

test("the admin healthcheck specifically does not ask for a path the default block closes on", () => {
  const command = healthchecks(compose).get("admin");
  assert.match(command, /\/admin-healthz/, "the admin healthcheck uses the endpoint the default block serves");
  assert.doesNotMatch(command, /8080\/\s/, "and not a bare /, which returns 444 and no response at all");
});

// The deployer hands every `up` an OPSWORKBENCH_RELEASE_MANIFEST path, and that only means anything if
// the compose file mounts it and tells the API where it landed. Without both halves the API falls back
// to BUILD_VERSION out of the environment file and reports `source: "env"` -- which on the production
// host meant a service claiming `phase2-staging` while running something else entirely, through every
// readiness check ever run against it.
test("the api mounts the release manifest it is pointed at", () => {
  const api = compose.slice(compose.indexOf("  api:"), compose.indexOf("  web:"));
  assert.match(api, /CONTROL_CENTER_RELEASE_MANIFEST:\s*\/run\/opsworkbench-release\/manifest\.json/, "the api must be told where its manifest is");
  assert.match(api, /\$\{OPSWORKBENCH_RELEASE_MANIFEST:\?[^}]*\}:\/run\/opsworkbench-release\/manifest\.json:ro/, "and the path must come from the deployment, read-only, with no default that would silently mount the wrong release");
  // Required interpolation, not a default: an `up` that forgets the variable must fail rather than
  // quietly mount whatever a default names.
  assert.equal(/\$\{OPSWORKBENCH_RELEASE_MANIFEST:-/.test(api), false, "a default would let a deployment run without being told which release it is");
});
