import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const dockerfilePath = path.join(root, "apps", "web", "Dockerfile");
const apiDockerfilePath = path.join(root, "apps", "api", "Dockerfile");
const COMMIT = "4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b";
const TREE = "322b1275e498aa0d4c0c1cbb0a2f2ab5f4e6d7c8";
const provenanceArgs = ["--build-arg", `SOURCE_COMMIT=${COMMIT}`, "--build-arg", `SOURCE_TREE=${TREE}`, "--build-arg", "SOURCE_TAG=v0.0.0-test"];
const dockerignorePath = path.join(root, ".dockerignore");
const runDockerTests = process.env.CONTROL_CENTER_RUN_DOCKER_DEPLOYMENT_TESTS === "true" && process.platform !== "win32";

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { cwd: root, encoding: "utf8", timeout: 240_000, ...options });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

test("web Docker build preserves the canonical shared-before-web workspace order", () => {
  const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
  const shared = "RUN npm run build --workspace @control-center/shared";
  const web = "RUN npm run build --workspace @control-center/web";
  assert.ok(dockerfile.indexOf(shared) > dockerfile.indexOf("RUN npm ci"));
  assert.ok(dockerfile.indexOf(web) > dockerfile.indexOf(shared));
  assert.match(dockerfile, /COPY --from=build \/app\/apps\/web\/dist \/usr\/share\/nginx\/html/);

  const dockerignore = fs.readFileSync(dockerignorePath, "utf8");
  for (const entry of [".env", ".env.*", "deploy/env", "deploy/certs"]) assert.match(dockerignore, new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
});

test("production API and web images build from a clean context and contain only intended runtime artifacts", { skip: !runDockerTests, timeout: 600_000 }, () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const webImage = `opsworkbench-web-regression:${suffix}`;
  const apiImage = `opsworkbench-api-regression:${suffix}`;
  const environmentDirectory = path.join(root, "deploy", "env");
  const environmentFile = path.join(environmentDirectory, ".env.staging");
  const environmentDirectoryExisted = fs.existsSync(environmentDirectory);
  try {
    assert.equal(fs.existsSync(environmentFile), false, "Docker regression test refuses to overwrite an existing staging environment file");
    fs.mkdirSync(environmentDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(environmentFile, "NODE_ENV=production\n", { mode: 0o600 });
    docker(["compose", "--file", "deploy/docker-compose.staging.yml", "config", "--quiet"]);
    docker(["build", "--no-cache", "--build-arg", "VITE_API_URL=/api", ...provenanceArgs, "--file", "apps/web/Dockerfile", "--tag", webImage, "."]);
    docker(["build", "--no-cache", ...provenanceArgs, "--file", "apps/api/Dockerfile", "--tag", apiImage, "."]);

    const command = JSON.parse(docker(["image", "inspect", "--format", "{{json .Config.Cmd}}", webImage]));
    assert.deepEqual(command, ["nginx", "-g", "daemon off;"]);
    docker(["run", "--rm", "--entrypoint", "sh", webImage, "-c", "test -f /usr/share/nginx/html/index.html && find /usr/share/nginx/html/assets -type f -print -quit | grep -q . && ! find /usr/share/nginx/html -type f \\( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o -name '*backup*' -o -name '*triage-report*' \\) | grep -q ."]);
    const committedInstaller = spawnSync("git", ["cat-file", "blob", "HEAD:control-center/apps/web/public/install.sh"], { cwd: path.resolve(root, ".."), encoding: null });
    assert.equal(committedInstaller.status, 0, committedInstaller.stderr?.toString());
    const imageInstallerHash = docker(["run", "--rm", "--entrypoint", "sha256sum", webImage, "/usr/share/nginx/html/install.sh"]).split(/\s+/, 1)[0];
    assert.equal(imageInstallerHash, sha256(committedInstaller.stdout), "web image installer must match the exact Git blob");

    // Forge milestone 5: the image must be able to say what it was built from. This is the label the
    // deployment preflight reads and, before this existed, never compared against anything.
    for (const image of [webImage, apiImage]) {
      const labels = JSON.parse(docker(["image", "inspect", "--format", "{{json .Config.Labels}}", image]));
      assert.equal(labels["org.opencontainers.image.revision"], COMMIT, `${image} must carry the source commit`);
      assert.equal(labels["org.opsworkbench.source.tree"], TREE, `${image} must carry the source tree`);
      assert.equal(labels["org.opencontainers.image.version"], "v0.0.0-test");
      assert.match(labels["org.opencontainers.image.title"], /^opsworkbench-control-center-(api|web)$/);
    }
    // An image without provenance must not be buildable at all.
    const unprovenanced = spawnSync("docker", ["build", "--no-cache", "--file", "apps/api/Dockerfile", "--tag", `${apiImage}-noprov`, "."], { cwd: root, encoding: "utf8", timeout: 240_000 });
    assert.notEqual(unprovenanced.status, 0, "a build without SOURCE_COMMIT must fail");
    assert.match(`${unprovenanced.stderr}${unprovenanced.stdout}`, /SOURCE_COMMIT build-arg is required/);

    const history = docker(["image", "history", "--no-trunc", "--format", "{{.CreatedBy}}", webImage]);
    assert.doesNotMatch(history, /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY)=[^\s]+/i);
    assert.doesNotMatch(history, /(?:^|[\\/])\.env(?:\.|\s|$)/i);
  } finally {
    spawnSync("docker", ["image", "rm", "--force", webImage, apiImage], { cwd: root, encoding: "utf8" });
    fs.rmSync(environmentFile, { force: true });
    if (!environmentDirectoryExisted) fs.rmdirSync(environmentDirectory);
  }
});

test("both Dockerfiles require a source commit and label it where the preflight reads it", () => {
  for (const [name, file] of [["web", dockerfilePath], ["api", apiDockerfilePath]]) {
    const dockerfile = fs.readFileSync(file, "utf8");
    // The guard must be REQUIRED, not merely available: an optional provenance label is absent exactly
    // when it matters.
    assert.match(dockerfile, /RUN printf '%s' "\$SOURCE_COMMIT" \| grep -Eq '\^\[0-9a-f\]\{40\}\$'/, `${name} Dockerfile must validate SOURCE_COMMIT`);
    assert.match(dockerfile, /LABEL org\.opencontainers\.image\.revision="\$SOURCE_COMMIT"/, `${name} image must label the revision`);
    assert.match(dockerfile, /LABEL org\.opsworkbench\.source\.tree="\$SOURCE_TREE"/, `${name} image must label the source tree`);
    // The label must be applied in the RUNTIME stage; a label on a build stage does not survive.
    const runtimeIndex = dockerfile.indexOf("AS runtime");
    assert.ok(dockerfile.indexOf('LABEL org.opencontainers.image.revision') > runtimeIndex, `${name} revision label must be in the runtime stage`);
    // The ARG must not be declared before `npm ci`, or every commit invalidates the dependency layer.
    assert.ok(dockerfile.indexOf("ARG SOURCE_COMMIT") > dockerfile.indexOf("RUN npm ci"), `${name} SOURCE_COMMIT must not precede npm ci`);
  }
});

test("the image build workflow cannot publish without an explicit human decision", () => {
  const workflow = fs.readFileSync(path.join(root, "..", ".github", "workflows", "control-center-images.yml"), "utf8");
  // Dispatch-only: publishing container images is an outward action and must not fire on a tag push.
  // Scope this to the TRIGGER block — `push:` also appears as an input to the build action, and a blunt
  // match on it would be a false positive.
  const triggers = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"));
  assert.doesNotMatch(triggers, /^\s{2}push:/m, "image workflow must not trigger on push");
  assert.doesNotMatch(triggers, /^\s{2}(schedule|pull_request|release):/m, "image workflow must be dispatch-only");
  assert.match(triggers, /^\s{2}workflow_dispatch:/m);
  // The publish input must default to false, and every pushing/attesting step must be gated on it.
  assert.match(workflow, /publish:[\s\S]*?default:\s*false/);
  for (const gated of ["docker/login-action", "actions/attest-build-provenance"]) {
    const index = workflow.indexOf(gated);
    assert.ok(index > 0, `${gated} step expected`);
    const stepStart = workflow.lastIndexOf("      - name:", index);
    assert.match(workflow.slice(stepStart, index), /if:\s*inputs\.publish/, `${gated} must be gated on inputs.publish`);
  }
});
