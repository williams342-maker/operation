#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const value = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const privateKeyPath = value("--private-key"); const unsignedPath = value("--unsigned"); const outputPath = value("--output");
if (![privateKeyPath, unsignedPath, outputPath].every((item) => item && path.isAbsolute(item))) throw new Error("--private-key, --unsigned and --output must be absolute paths");
const exact = ["schemaVersion", "orgId", "serverId", "ownerPublicKey", "trustedRootSha256", "hostname", "machineIdSha256", "validFrom", "validUntil"].sort();
const unsigned = JSON.parse(fs.readFileSync(unsignedPath, "utf8"));
if (JSON.stringify(Object.keys(unsigned).sort()) !== JSON.stringify(exact) || unsigned.schemaVersion !== "forge-security-identity-v1") throw new Error("unsigned Forge identity has missing or unknown fields");
for (const field of ["trustedRootSha256", "machineIdSha256"]) if (!/^[a-f0-9]{64}$/.test(unsigned[field])) throw new Error(`${field} is invalid`);
if (!unsigned.orgId || !unsigned.serverId || !unsigned.hostname || Date.parse(unsigned.validFrom) >= Date.parse(unsigned.validUntil)) throw new Error("Forge identity values or validity window are invalid");
const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath));
if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("owner private key is not Ed25519");
const derived = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
if (Buffer.from(unsigned.ownerPublicKey, "base64url").compare(derived) !== 0) throw new Error("unsigned identity does not carry the public half of this owner key");
const statement = Buffer.from([unsigned.schemaVersion, unsigned.orgId, unsigned.serverId, unsigned.ownerPublicKey,
  unsigned.trustedRootSha256, unsigned.hostname, unsigned.machineIdSha256, unsigned.validFrom,
  unsigned.validUntil].join("\n"));
const ownerSignature = crypto.sign(null, statement, privateKey).toString("base64url");
fs.writeFileSync(outputPath, `${JSON.stringify({ ...unsigned, ownerSignature }, null, 2)}\n`, { flag: "wx", mode: 0o400 });
process.stdout.write(`${crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex")}\n`);
