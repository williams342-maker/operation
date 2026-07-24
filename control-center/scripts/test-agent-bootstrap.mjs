import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opsworkbench-bootstrap-test-"));
const output = path.join(temporary, "release");
const privateKeyFile = path.join(temporary, "test-private.pem");
const publicKeyFile = path.join(temporary, "test-public.pem");

try {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(privateKeyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.writeFileSync(publicKeyFile, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  const buildEnvironment = { ...process.env, BOOTSTRAP_OUTPUT_DIR: output };
  execFileSync(process.execPath, [path.join(root, "scripts", "build-agent-bootstrap.mjs")], { cwd: root, env: buildEnvironment, stdio: "pipe" });
  const signingEnvironment = {
    ...buildEnvironment,
    BOOTSTRAP_SIGNING_PRIVATE_KEY_FILE: privateKeyFile,
    BOOTSTRAP_SIGNING_PUBLIC_KEY_FILE: publicKeyFile,
    BOOTSTRAP_ARTIFACT_URL: "https://releases.example.test/opsworkbench-agent-test.tar.gz",
    BOOTSTRAP_PUBLICATION_STATUS: "draft"
  };
  execFileSync(process.execPath, [path.join(root, "scripts", "sign-agent-bootstrap.mjs")], { cwd: root, env: signingEnvironment, stdio: "pipe" });
  const verification = execFileSync(process.execPath, [path.join(root, "scripts", "verify-agent-bootstrap.mjs")], { cwd: root, env: signingEnvironment, encoding: "utf8" }).trim();
  const result = JSON.parse(verification);
  if (result.version !== "0.10.0-beta.1" || !/^ed25519-[a-f0-9]{24}$/.test(result.signingKeyId) || result.artifacts < 8) throw new Error("Bootstrap verification summary is incomplete");
  process.stdout.write(`Ephemeral signed bootstrap verification passed for ${result.version}\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
