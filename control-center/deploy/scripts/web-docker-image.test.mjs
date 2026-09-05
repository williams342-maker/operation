import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const dockerfilePath = path.join(root, "apps", "web", "Dockerfile");
const adminDockerfilePath = path.join(root, "apps", "web", "Dockerfile.admin");
const reviewGateDockerfilePath = path.join(root, "apps", "review-gate", "Dockerfile");
const apiDockerfilePath = path.join(root, "apps", "api", "Dockerfile");
const COMMIT = "4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b";
const TREE = "322b1275e498aa0d4c0c1cbb0a2f2ab5f4e6d7c8";
const provenanceArgs = ["--build-arg", `SOURCE_COMMIT=${COMMIT}`, "--build-arg", `SOURCE_TREE=${TREE}`, "--build-arg", "SOURCE_TAG=v0.0.0-test"];
const dockerignorePath = path.join(root, ".dockerignore");
const runDockerTests = process.env.CONTROL_CENTER_RUN_DOCKER_DEPLOYMENT_TESTS === "true" && process.platform !== "win32";

// Two budgets, because one number cannot serve both. `docker image inspect` should answer in seconds;
// two `--no-cache` image builds each run a full `npm ci` against the registry and legitimately take
// minutes. One 240s cap covered both, inside a 600s test budget that could not even contain two builds
// at that cap -- so whichever limit expired first would decide the message.
//
// STATED PRECISELY, because I first concluded the cap WAS the failure and it was not: the observed CI
// failures exit 255, and a cap expiring yields `status: null`. So this is headroom and a clearer
// diagnosis, NOT a fix for the 255. That cause is still unidentified -- see the assertion below, which
// exists so the next occurrence carries the evidence this one did not.
const QUICK_COMMAND_MS = 120_000;
const BUILD_COMMAND_MS = 600_000;

function docker(args, options = {}) {
  const timeout = options.timeout ?? (args[0] === "build" ? BUILD_COMMAND_MS : QUICK_COMMAND_MS);
  const result = spawnSync("docker", args, { cwd: root, encoding: "utf8", ...options, timeout });

  // A TIMEOUT IS NOT A BUILD FAILURE, and must not be reported as one.
  //
  // On timeout `spawnSync` kills the child and reports `status: null, signal: SIGTERM,
  // error.code: ETIMEDOUT` -- verified, including when the child traps SIGTERM and exits with its own
  // code. Asserting `status === 0` turns all of that into "null !== 0" beside a partial build log,
  // which reads as though the image failed to build.
  if (result.error || result.signal) {
    assert.fail(
      `docker ${args[0]} did not complete: ${result.error?.code ?? "killed"}`
      + `${result.signal ? ` (signal ${result.signal})` : ""} after at most ${timeout / 1000}s. `
      + `This is NOT a build failure -- the last step shown is wherever it stopped, not the cause.` + "\n"
      + `--- last output ---\n${tail(result)}`,
    );
  }
  // On a real non-zero exit, show BOTH streams. BuildKit writes progress to stderr and errors can land
  // on either, so `stderr || stdout` can silently discard the half that explains it.
  assert.equal(result.status, 0,
    `docker ${args[0]} exited ${result.status}\n--- last output ---\n${tail(result)}`);
  return result.stdout.trim();
}

/** Both streams, tail-trimmed. Whichever one carries the explanation, it survives into the message. */
function tail(result, limit = 4000) {
  const parts = [];
  if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  const joined = parts.join("\n") || "(no output captured)";
  return joined.length > limit ? `…${joined.slice(-limit)}` : joined;
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

// The whole test must outlast the work it serialises: two builds at BUILD_COMMAND_MS plus the container
// runs and inspections afterwards. At 600s it could not even contain two builds at the old per-command
// cap, so whichever limit expired first decided the failure message.
test("all four production application images build cleanly with complete provenance", { skip: !runDockerTests, timeout: 2_700_000 }, () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const webImage = `opsworkbench-web-regression:${suffix}`;
  const apiImage = `opsworkbench-api-regression:${suffix}`;
  const adminImage = `opsworkbench-admin-regression:${suffix}`;
  const gateImage = `opsworkbench-review-gate-regression:${suffix}`;
  const environmentDirectory = path.join(root, "deploy", "env");
  const environmentFile = path.join(environmentDirectory, ".env.staging");
  const environmentDirectoryExisted = fs.existsSync(environmentDirectory);
  try {
    assert.equal(fs.existsSync(environmentFile), false, "Docker regression test refuses to overwrite an existing staging environment file");
    fs.mkdirSync(environmentDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(environmentFile, "NODE_ENV=production\n", { mode: 0o600 });
    docker(["compose", "--file", "deploy/docker-compose.staging.yml", "config", "--quiet"]);
    // `--progress=plain` is a DIAGNOSTIC REQUIREMENT here, not a preference. BuildKit's default `auto`
    // progress collapses each step to a status line and discards the command's own output, which is why
    // a failing build showed `RUN npm ci` followed by nothing -- npm's error never reached the log. With
    // plain progress the failing command's stderr is in the captured output.
    //
    // `provenanceArgs` is the Forge side: the build must stamp the provenance labels the deployment
    // preflight reads. The two are independent and both are required.
    docker(["build", "--progress=plain", "--no-cache", "--build-arg", "VITE_API_URL=/api", ...provenanceArgs, "--file", "apps/web/Dockerfile", "--tag", webImage, "."]);
    docker(["build", "--progress=plain", "--no-cache", ...provenanceArgs, "--file", "apps/api/Dockerfile", "--tag", apiImage, "."]);
    docker(["build", "--progress=plain", "--no-cache", "--build-arg", "VITE_API_URL=/api", ...provenanceArgs, "--file", "apps/web/Dockerfile.admin", "--tag", adminImage, "."]);
    docker(["build", "--progress=plain", "--no-cache", ...provenanceArgs, "--file", "apps/review-gate/Dockerfile", "--tag", gateImage, "."]);

    const command = JSON.parse(docker(["image", "inspect", "--format", "{{json .Config.Cmd}}", webImage]));
    assert.deepEqual(command, ["nginx", "-g", "daemon off;"]);
    docker(["run", "--rm", "--entrypoint", "sh", webImage, "-c", "test -f /usr/share/nginx/html/index.html && find /usr/share/nginx/html/assets -type f -print -quit | grep -q . && ! find /usr/share/nginx/html -type f \\( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o -name '*backup*' -o -name '*triage-report*' \\) | grep -q ."]);
    const committedInstaller = spawnSync("git", ["cat-file", "blob", "HEAD:control-center/apps/web/public/install.sh"], { cwd: path.resolve(root, ".."), encoding: null });
    assert.equal(committedInstaller.status, 0, committedInstaller.stderr?.toString());
    const imageInstallerHash = docker(["run", "--rm", "--entrypoint", "sha256sum", webImage, "/usr/share/nginx/html/install.sh"]).split(/\s+/, 1)[0];
    assert.equal(imageInstallerHash, sha256(committedInstaller.stdout), "web image installer must match the exact Git blob");

    // Forge milestone 5: the image must be able to say what it was built from. This is the label the
    // deployment preflight reads and, before this existed, never compared against anything.
    for (const image of [webImage, apiImage, adminImage, gateImage]) {
      const labels = JSON.parse(docker(["image", "inspect", "--format", "{{json .Config.Labels}}", image]));
      assert.equal(labels["org.opencontainers.image.revision"], COMMIT, `${image} must carry the source commit`);
      assert.equal(labels["org.opsworkbench.source.tree"], TREE, `${image} must carry the source tree`);
      assert.equal(labels["org.opencontainers.image.version"], "v0.0.0-test");
      assert.match(labels["org.opencontainers.image.title"], /^opsworkbench-(control-center-(api|web|admin-web)|review-gate)$/);
    }
    // An image without provenance must not be buildable at all.
    const unprovenanced = spawnSync("docker", ["build", "--no-cache", "--file", "apps/api/Dockerfile", "--tag", `${apiImage}-noprov`, "."], { cwd: root, encoding: "utf8", timeout: 240_000 });
    assert.notEqual(unprovenanced.status, 0, "a build without SOURCE_COMMIT must fail");
    assert.match(`${unprovenanced.stderr}${unprovenanced.stdout}`, /SOURCE_COMMIT build-arg is required/);

    const history = docker(["image", "history", "--no-trunc", "--format", "{{.CreatedBy}}", webImage]);
    assert.doesNotMatch(history, /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY)=[^\s]+/i);
    assert.doesNotMatch(history, /(?:^|[\\/])\.env(?:\.|\s|$)/i);
  } finally {
    spawnSync("docker", ["image", "rm", "--force", webImage, apiImage, adminImage, gateImage], { cwd: root, encoding: "utf8" });
    fs.rmSync(environmentFile, { force: true });
    if (!environmentDirectoryExisted) fs.rmdirSync(environmentDirectory);
  }
});

test("all application Dockerfiles require a source commit and label it where the preflight reads it", () => {
  for (const [name, file] of [["web", dockerfilePath], ["admin", adminDockerfilePath], ["api", apiDockerfilePath], ["review-gate", reviewGateDockerfilePath]]) {
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
  // EVERY such step, and only real steps.
  //
  // This matched a bare substring and checked only the FIRST occurrence. Two problems: prose mentioning
  // `actions/attest-build-provenance` in a comment was indistinguishable from a step using it -- which
  // is how this test started failing on a comment that explains what the action does -- and the
  // workflow has THREE attest steps, so the second and third could have been ungated without notice.
  //
  // `uses:` is what makes it a step. Every match is checked, and the count is asserted so that a step
  // silently disappearing is a failure rather than a smaller green loop.
  for (const [action, expected] of [["docker/login-action", 1], ["actions/attest-build-provenance", 5]]) {
    const needle = `uses: ${action}`;
    const found = [];
    for (let i = workflow.indexOf(needle); i > 0; i = workflow.indexOf(needle, i + 1)) found.push(i);
    assert.equal(found.length, expected, `expected ${expected} ${action} step(s), found ${found.length}`);
    for (const index of found) {
      const stepStart = workflow.lastIndexOf("      - name:", index);
      assert.ok(stepStart > 0, `${action} at ${index} is not inside a named step`);
      assert.match(workflow.slice(stepStart, index), /if:\s*inputs\.publish/,
        `every ${action} step must be gated on inputs.publish`);
    }
  }
});
