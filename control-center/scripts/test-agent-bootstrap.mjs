import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opsworkbench-bootstrap-test-"));
const outputs = [path.join(temporary, "release-a"), path.join(temporary, "release-b")];
const privateKeyFile = path.join(temporary, "test-private.pem");
const publicKeyFile = path.join(temporary, "test-public.pem");
const unrelatedPublicKeyFile = path.join(temporary, "unrelated-public.pem");

try {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const { publicKey: unrelatedPublicKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(privateKeyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.writeFileSync(publicKeyFile, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  fs.writeFileSync(unrelatedPublicKeyFile, unrelatedPublicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  const results = [];
  const verificationEnvironments = [];
  for (const output of outputs) {
    const buildEnvironment = { ...process.env, BOOTSTRAP_OUTPUT_DIR: output, ALLOW_DIRTY_BOOTSTRAP_BUILD: "true" };
    execFileSync(process.execPath, [path.join(root, "scripts", "build-agent-bootstrap.mjs")], { cwd: root, env: buildEnvironment, stdio: "pipe" });
    const signingEnvironment = { ...buildEnvironment, BOOTSTRAP_SIGNING_PRIVATE_KEY_FILE: privateKeyFile, BOOTSTRAP_SIGNING_PUBLIC_KEY_FILE: publicKeyFile, BOOTSTRAP_ARTIFACT_URL: "https://releases.example.test/opsworkbench-agent-test.tar.gz", BOOTSTRAP_PUBLICATION_STATUS: "draft" };
    verificationEnvironments.push(signingEnvironment);
    execFileSync(process.execPath, [path.join(root, "scripts", "sign-agent-bootstrap.mjs")], { cwd: root, env: signingEnvironment, stdio: "pipe" });
    const verification = execFileSync(process.execPath, [path.join(root, "scripts", "verify-agent-bootstrap.mjs")], { cwd: root, env: signingEnvironment, encoding: "utf8" }).trim();
    results.push(JSON.parse(verification));
  }
  const [result] = results;
  if (result.version !== "0.10.0-beta.1" || !/^ed25519-[a-f0-9]{24}$/.test(result.signingKeyId) || result.artifacts < 8) throw new Error("Bootstrap verification summary is incomplete");
  if (fs.readFileSync(path.join(outputs[0], "SHA256SUMS"), "utf8") !== fs.readFileSync(path.join(outputs[1], "SHA256SUMS"), "utf8")) throw new Error("Signed bootstrap output is not reproducible");
  let unrelatedKeyRejected = false;
  try {
    execFileSync(process.execPath, [path.join(root, "scripts", "verify-agent-bootstrap.mjs")], {
      cwd: root,
      env: { ...verificationEnvironments[0], BOOTSTRAP_SIGNING_PUBLIC_KEY_FILE: unrelatedPublicKeyFile },
      stdio: "pipe",
    });
  } catch {
    unrelatedKeyRejected = true;
  }
  if (!unrelatedKeyRejected) throw new Error("Bootstrap signed by an unrelated key was accepted");
  fs.appendFileSync(path.join(outputs[1], "opsworkbench-agent.service"), "\n# tampered\n");
  let tamperingRejected = false;
  try {
    execFileSync(process.execPath, [path.join(root, "scripts", "verify-agent-bootstrap.mjs")], { cwd: root, env: verificationEnvironments[1], stdio: "pipe" });
  } catch {
    tamperingRejected = true;
  }
  if (!tamperingRejected) throw new Error("Tampered bootstrap artifact was accepted");
  process.stdout.write(`Ephemeral signed bootstrap verification passed for ${result.version}\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
