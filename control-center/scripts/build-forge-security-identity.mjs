#!/usr/bin/env node
// Assemble the UNSIGNED Forge security identity for one host — the document the owner then signs
// offline with `sign-forge-security-identity.mjs`.
//
// WHY THIS EXISTS. Every field of that document is either measured on the target or chosen deliberately,
// and the signer refuses anything with a field missing, extra, or malformed. Hand-assembling ten fields
// including two file digests, at the one moment where a mistake means an owner signature over the wrong
// statement, is the wrong way to spend a ceremony. This builds it from the actual files and prints the
// digest of what it wrote, so what is carried to the offline machine can be checked on arrival.
//
// IT SIGNS NOTHING AND TOUCHES NO KEY. The owner's private key is never an input here; only the public
// half, which the signer separately proves is the public half of the key doing the signing.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const value = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const required = (name) => { const found = value(name); if (!found) throw new Error(`${name} is required`); return found; };
const absolute = (name) => { const found = required(name); if (!path.isAbsolute(found)) throw new Error(`${name} must be an absolute path`); return found; };
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

const orgId = required("--org");
const serverId = required("--server");
const hostname = required("--hostname");
const machineIdSha256 = required("--machine-id-sha256");
const ownerPublicKey = required("--owner-public-key");
const trustedRootPath = absolute("--trusted-root");
const reviewGateCaPath = absolute("--review-gate-ca");
const validFrom = required("--valid-from");
const validUntil = required("--valid-until");
const output = absolute("--output");

// The same shapes the loader and the signer enforce, applied here so a malformed value is caught while
// it is still cheap to fix rather than after an offline signature has been produced over it.
if (!/^[a-f0-9]{64}$/.test(machineIdSha256)) throw new Error("--machine-id-sha256 must be a sha256 digest, which is what the identity binds (never the raw machine id)");
if (!/^[A-Za-z0-9_-]+$/.test(ownerPublicKey)) throw new Error("--owner-public-key must be the base64url SPKI public key");
// Written by code point rather than a pattern: a character class containing the escapes for NUL and
// 0x1f is exactly the kind of source that gets normalised into REAL control bytes somewhere between
// here and the file, which then makes this a binary blob to git and to every reviewer.
const hasControlCharacter = (text) => [...text].some((character) => { const code = character.codePointAt(0); return code < 32 || code === 127; });
for (const [name, field] of [["--org", orgId], ["--server", serverId], ["--hostname", hostname]]) {
  // Control characters are the subject of the check, not an accident: these values are joined with
  // newlines into the statement the owner signs, so one containing a newline could shift a field
  // boundary and let two different identities produce the same signed bytes.
  if (!field.length || hasControlCharacter(field)) throw new Error(`${name} must be non-empty and free of control characters`);
}
for (const [name, moment] of [["--valid-from", validFrom], ["--valid-until", validUntil]]) {
  if (Number.isNaN(Date.parse(moment)) || new Date(moment).toISOString() !== moment) throw new Error(`${name} must be an exact ISO-8601 instant, for example 2026-09-13T00:00:00.000Z`);
}
if (Date.parse(validFrom) >= Date.parse(validUntil)) throw new Error("the validity window ends before it begins");

const readTrusted = (file, label) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} is not a regular file`);
  return fs.readFileSync(file);
};
const trustedRootBytes = readTrusted(trustedRootPath, "--trusted-root");
const reviewGateCaBytes = readTrusted(reviewGateCaPath, "--review-gate-ca");
// Both are checked for shape, because the loader will: a trusted root it cannot parse and a CA that is
// not a certificate both fail on the target, and finding that out there costs another ceremony.
JSON.parse(trustedRootBytes.toString("utf8"));
if (!reviewGateCaBytes.toString("utf8").includes("BEGIN CERTIFICATE")) throw new Error("--review-gate-ca is not a PEM certificate");

// Key order is irrelevant to the signer, which sorts, and to the statement, which names fields
// explicitly. Written in the order the schema declares them so a human reading the file can follow it.
const unsigned = {
  schemaVersion: "forge-security-identity-v1",
  orgId,
  serverId,
  ownerPublicKey,
  trustedRootSha256: sha256(trustedRootBytes),
  reviewGateCaSha256: sha256(reviewGateCaBytes),
  hostname,
  machineIdSha256,
  validFrom,
  validUntil,
};

// NO SWEEP HERE, deliberately. Every field this builds is already constrained by a rule above — the
// digests by their hex pattern, the key by base64url, the timestamps by exact-instant parsing, the three
// text fields by the control-character check — and every value arrives as a command-line string, so
// there is no other type to guard against. A review demonstrated that deleting a sweep here changed no
// test, which is the honest signal that it was covering nothing. The signer, which accepts a document
// from anywhere, keeps its own.

const body = `${JSON.stringify(unsigned, null, 2)}\n`;
fs.writeFileSync(output, body, { flag: "wx", mode: 0o444 });
process.stdout.write(`${JSON.stringify({
  unsigned: output,
  sha256: sha256(Buffer.from(body)),
  trustedRootSha256: unsigned.trustedRootSha256,
  reviewGateCaSha256: unsigned.reviewGateCaSha256,
}, null, 2)}\n`);
