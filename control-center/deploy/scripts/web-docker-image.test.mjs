import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const dockerfilePath = path.join(root, "apps", "web", "Dockerfile");
const dockerignorePath = path.join(root, ".dockerignore");
const runDockerTests = process.env.CONTROL_CENTER_RUN_DOCKER_DEPLOYMENT_TESTS === "true" && process.platform !== "win32";

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { cwd: root, encoding: "utf8", timeout: 240_000, ...options });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

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
    docker(["build", "--no-cache", "--build-arg", "VITE_API_URL=/api", "--file", "apps/web/Dockerfile", "--tag", webImage, "."]);
    docker(["build", "--no-cache", "--file", "apps/api/Dockerfile", "--tag", apiImage, "."]);

    const command = JSON.parse(docker(["image", "inspect", "--format", "{{json .Config.Cmd}}", webImage]));
    assert.deepEqual(command, ["nginx", "-g", "daemon off;"]);
    docker(["run", "--rm", "--entrypoint", "sh", webImage, "-c", "test -f /usr/share/nginx/html/index.html && find /usr/share/nginx/html/assets -type f -print -quit | grep -q . && ! find /usr/share/nginx/html -type f \\( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o -name '*backup*' -o -name '*triage-report*' \\) | grep -q ."]);

    const history = docker(["image", "history", "--no-trunc", "--format", "{{.CreatedBy}}", webImage]);
    assert.doesNotMatch(history, /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY)=[^\s]+/i);
    assert.doesNotMatch(history, /(?:^|[\\/])\.env(?:\.|\s|$)/i);
  } finally {
    spawnSync("docker", ["image", "rm", "--force", webImage, apiImage], { cwd: root, encoding: "utf8" });
    fs.rmSync(environmentFile, { force: true });
    if (!environmentDirectoryExisted) fs.rmdirSync(environmentDirectory);
  }
});
