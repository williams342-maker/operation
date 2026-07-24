import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(process.env.BOOTSTRAP_OUTPUT_DIR || "");
if (!process.env.BOOTSTRAP_OUTPUT_DIR) throw new Error("BOOTSTRAP_OUTPUT_DIR is required");
const keys = fs.mkdtempSync(path.join(os.tmpdir(), "opsworkbench-disposable-bootstrap-keys-"));
const privateKeyFile = path.join(keys, "private.pem");
const publicKeyFile = path.join(keys, "public.pem");
const environment = { ...process.env, BOOTSTRAP_OUTPUT_DIR: output, ALLOW_DIRTY_BOOTSTRAP_BUILD: "true" };

try {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(privateKeyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.writeFileSync(publicKeyFile, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  execFileSync(process.execPath, [path.join(root, "scripts", "build-agent-bootstrap.mjs")], { cwd: root, env: environment, stdio: "inherit" });
  const signingEnvironment = {
    ...environment,
    BOOTSTRAP_SIGNING_PRIVATE_KEY_FILE: privateKeyFile,
    BOOTSTRAP_SIGNING_PUBLIC_KEY_FILE: publicKeyFile,
    BOOTSTRAP_ARTIFACT_URL: "https://127.0.0.1:8443/opsworkbench-agent-0.10.0-beta.1-linux-x64.tar.gz",
    BOOTSTRAP_PUBLICATION_STATUS: "draft",
  };
  execFileSync(process.execPath, [path.join(root, "scripts", "sign-agent-bootstrap.mjs")], { cwd: root, env: signingEnvironment, stdio: "inherit" });
  execFileSync(process.execPath, [path.join(root, "scripts", "verify-agent-bootstrap.mjs")], { cwd: root, env: signingEnvironment, stdio: "inherit" });
  process.stdout.write(`Disposable signed bootstrap created at ${output}\n`);
} finally {
  fs.rmSync(keys, { recursive: true, force: true });
}
