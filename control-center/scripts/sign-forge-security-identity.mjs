#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const value = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const privateKeyPath = value("--private-key"); const unsignedPath = value("--unsigned"); const outputPath = value("--output");
if (![privateKeyPath, unsignedPath, outputPath].every((item) => item && path.isAbsolute(item))) throw new Error("--private-key, --unsigned and --output must be absolute paths");
const exact = ["schemaVersion", "orgId", "serverId", "ownerPublicKey", "trustedRootSha256", "reviewGateCaSha256", "hostname", "machineIdSha256", "validFrom", "validUntil"].sort();
const unsigned = JSON.parse(fs.readFileSync(unsignedPath, "utf8"));
if (JSON.stringify(Object.keys(unsigned).sort()) !== JSON.stringify(exact) || unsigned.schemaVersion !== "forge-security-identity-v1") throw new Error("unsigned Forge identity has missing or unknown fields");
for (const field of ["trustedRootSha256", "reviewGateCaSha256", "machineIdSha256"]) if (!/^[a-f0-9]{64}$/.test(unsigned[field])) throw new Error(`${field} is invalid`);
// THE SAME STRUCTURAL RULES THE PRODUCTION LOADER ENFORCES, applied before a signature exists rather
// than after. A signature over a document the target will refuse is worth less than no signature: it
// looks like a completed ceremony and only fails on the host, where a second ceremony is the remedy.
const hasControlCharacter = (text) => [...String(text)].some((character) => { const code = character.codePointAt(0); return code < 32 || code === 127; });
// TYPE FIRST, THEN CONTENT, FOR EVERY FIELD. Checking only string values left every other type
// unchecked, and the statement is built by JOINING these values: an array or an object is stringified
// on the way in, so a nested value carrying a newline produced a cryptographically valid signature over
// a statement with an extra line in it. The loader would refuse such a document, but a signer that
// signs it is a signer that lies. Sweeping every field also covers one added later, before anyone
// remembers to cover it.
for (const [field, present] of Object.entries(unsigned)) {
  if (typeof present !== "string") throw new Error(`${field} must be a string; every field is joined into the statement being signed, and anything else is stringified on the way`);
  if (hasControlCharacter(present)) throw new Error(`${field} contains a control character, and every field is joined into the statement being signed`);
  if (!present.length) throw new Error(`${field} must be non-empty`);
}
if (!/^[A-Za-z0-9_-]+$/.test(unsigned.ownerPublicKey)) throw new Error("ownerPublicKey must be base64url, as the loader parses it");
for (const field of ["validFrom", "validUntil"]) {
  if (Number.isNaN(Date.parse(unsigned[field])) || new Date(unsigned[field]).toISOString() !== unsigned[field]) throw new Error(`${field} must be an exact ISO-8601 instant`);
}
if (Date.parse(unsigned.validFrom) >= Date.parse(unsigned.validUntil)) throw new Error("Forge identity validity window ends before it begins");
const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath));
if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("owner private key is not Ed25519");
const derived = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
if (Buffer.from(unsigned.ownerPublicKey, "base64url").compare(derived) !== 0) throw new Error("unsigned identity does not carry the public half of this owner key");
const statement = Buffer.from([unsigned.schemaVersion, unsigned.orgId, unsigned.serverId, unsigned.ownerPublicKey,
  unsigned.trustedRootSha256, unsigned.reviewGateCaSha256, unsigned.hostname, unsigned.machineIdSha256, unsigned.validFrom,
  unsigned.validUntil].join("\n"));
const ownerSignature = crypto.sign(null, statement, privateKey).toString("base64url");
fs.writeFileSync(outputPath, `${JSON.stringify({ ...unsigned, ownerSignature }, null, 2)}\n`, { flag: "wx", mode: 0o400 });
process.stdout.write(`${crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex")}\n`);
