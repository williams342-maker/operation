import fs from "node:fs";
import path from "node:path";
import { evaluateProductionPublication } from "../packages/shared/dist/index.js";

const [signedPolicyPath, evidencePath, authorizationPath, publicKeyPath] = process.argv.slice(2);
if (!signedPolicyPath || !evidencePath || !authorizationPath || !publicKeyPath) {
  throw new Error("Usage: verify-publication-policy.mjs <signed-policy.json> <evidence.json> <authorization.json> <owner-public-key.pem>");
}

function json(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

const result = evaluateProductionPublication({
  signedPolicy: json(signedPolicyPath),
  evidence: json(evidencePath),
  authorization: json(authorizationPath),
  ownerPublicKeyPem: fs.readFileSync(path.resolve(publicKeyPath))
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.publishEnabled) process.exitCode = 1;
