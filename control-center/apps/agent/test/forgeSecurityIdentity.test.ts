import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { forgeSecurityIdentitySchema, forgeSecurityIdentityStatement, loadForgeSecurityMaterial, type SecurityPathPolicy } from "../src/forgeSecurityIdentity.js";

const digest = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");

test("security identity fields cannot inject canonical statement separators", () => {
  const base = { schemaVersion: "forge-security-identity-v1", orgId: "org", serverId: "server", ownerPublicKey: "abc", trustedRootSha256: "a".repeat(64), reviewGateCaSha256: "b".repeat(64), hostname: "host", machineIdSha256: "c".repeat(64), validFrom: "2026-09-01T00:00:00.000Z", validUntil: "2027-09-01T00:00:00.000Z", ownerSignature: "d".repeat(64) };
  for (const field of ["orgId", "serverId", "hostname"] as const) assert.equal(forgeSecurityIdentitySchema.safeParse({ ...base, [field]: "trusted\nshifted" }).success, false);
});

function fixture(): { root: string; security: string; identity: string; trustedRoot: string; reviewGateCa: string; policy: SecurityPathPolicy } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-security-"));
  const security = path.join(root, "etc", "opsworkbench-forge");
  fs.mkdirSync(security, { recursive: true, mode: 0o755 });
  for (const dir of [root, path.join(root, "etc"), security]) fs.chmodSync(dir, 0o755);
  const trustedRoot = path.join(security, "trusted-root.json");
  const trustBytes = `${JSON.stringify({ mediaType: "application/vnd.dev.sigstore.trustedroot+json;version=0.1", tlogs: [] })}\n`;
  fs.writeFileSync(trustedRoot, trustBytes, { mode: 0o444 });
  const reviewGateCa = path.join(security, "review-gate-ca.pem");
  const caBytes = "-----BEGIN CERTIFICATE-----\nreviewed-public-ca\n-----END CERTIFICATE-----\n";
  fs.writeFileSync(reviewGateCa, caBytes, { mode: 0o444 });
  const identity = path.join(security, "identity.json");
  const keys = crypto.generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const unsigned = {
    schemaVersion: "forge-security-identity-v1", orgId: "org-reviewed", serverId: "server-reviewed",
    ownerPublicKey: publicKey,
    trustedRootSha256: digest(trustBytes), reviewGateCaSha256: digest(caBytes), hostname: "reviewed-host", machineIdSha256: digest("reviewed-machine"),
    validFrom: "2026-09-01T00:00:00.000Z", validUntil: "2027-09-01T00:00:00.000Z",
  } as const;
  const ownerSignature = crypto.sign(null, forgeSecurityIdentityStatement(unsigned), keys.privateKey).toString("base64url");
  fs.writeFileSync(identity, `${JSON.stringify({ ...unsigned, ownerSignature })}\n`, { mode: 0o444 });
  const stat = fs.statSync(root);
  return { root, security, identity, trustedRoot, reviewGateCa, policy: {
    directory: security, identityPath: identity, trustedRootPath: trustedRoot,
    reviewGateCaPath: reviewGateCa,
    expectedUid: stat.uid, expectedGid: stat.gid, directoryMode: 0o755, fileMode: 0o444,
    hostname: "reviewed-host", machineId: "reviewed-machine", now: new Date("2026-09-05T00:00:00.000Z"),
    ancestorBoundary: root,
    expectedOwnerPublicKey: publicKey, expectedOwnerPublicKeySha256: digest(Buffer.from(publicKey, "base64url")),
  } };
}

test("loads only machine-bound, time-bounded material whose trust-root digest matches", { skip: process.platform === "win32" }, () => {
  const item = fixture();
  const result = loadForgeSecurityMaterial(item.policy);
  assert.equal(result.identity.serverId, "server-reviewed");
  assert.deepEqual(result.trustedRoot, { mediaType: "application/vnd.dev.sigstore.trustedroot+json;version=0.1", tlogs: [] });
});

test("refuses alternate paths, malicious cwd and environment selection", { skip: process.platform === "win32" }, () => {
  const item = fixture();
  const priorCwd = process.cwd(); const priorEnv = process.env.CONTROL_CENTER_AGENT_CONFIG;
  process.chdir(item.root); process.env.CONTROL_CENTER_AGENT_CONFIG = path.join(item.root, "attacker.json");
  try {
    assert.equal(loadForgeSecurityMaterial(item.policy).identity.orgId, "org-reviewed");
    assert.throws(() => loadForgeSecurityMaterial({ ...item.policy, identityPath: path.join(item.root, "attacker.json") }), /direct children/);
  } finally { process.chdir(priorCwd); if (priorEnv === undefined) delete process.env.CONTROL_CENTER_AGENT_CONFIG; else process.env.CONTROL_CENTER_AGENT_CONFIG = priorEnv; }
});

test("refuses symlinks, writable ancestors, wrong owner/group and permissive files", { skip: process.platform === "win32" }, () => {
  const item = fixture();
  const link = path.join(item.security, "identity-link.json");
  fs.symlinkSync(item.identity, link);
  assert.throws(() => loadForgeSecurityMaterial({ ...item.policy, identityPath: link }), /symlink/);
  fs.chmodSync(item.security, 0o775);
  assert.throws(() => loadForgeSecurityMaterial(item.policy), /wrong mode/);
  fs.chmodSync(item.security, 0o755); fs.chmodSync(item.identity, 0o644);
  assert.throws(() => loadForgeSecurityMaterial(item.policy), /wrong mode/);
  fs.chmodSync(item.identity, 0o444);
  assert.throws(() => loadForgeSecurityMaterial({ ...item.policy, expectedUid: item.policy.expectedUid + 1 }), /wrong owner\/group/);
  assert.throws(() => loadForgeSecurityMaterial({ ...item.policy, expectedGid: item.policy.expectedGid + 1 }), /wrong owner\/group/);
});

test("refuses directory, FIFO and directory/file bind mounts in place of trusted material", { skip: process.platform === "win32" }, () => {
  const directoryItem = fixture(); fs.rmSync(directoryItem.identity); fs.mkdirSync(directoryItem.identity, { mode: 0o444 });
  assert.throws(() => loadForgeSecurityMaterial(directoryItem.policy), /not a regular file/);
  const fifoItem = fixture(); fs.rmSync(fifoItem.identity); execFileSync("mkfifo", [fifoItem.identity]); fs.chmodSync(fifoItem.identity, 0o444);
  assert.throws(() => loadForgeSecurityMaterial(fifoItem.policy), /not a regular file/);
  const mountItem = fixture(); const mountInfo = path.join(mountItem.root, "mountinfo");
  fs.writeFileSync(mountInfo, `1 0 0:1 / ${mountItem.security.replaceAll(" ", "\\040")} rw - ext4 /dev/root rw\n`);
  assert.throws(() => loadForgeSecurityMaterial({ ...mountItem.policy, mountInfoPath: mountInfo }), /bind mount/);
  fs.writeFileSync(mountInfo, `1 0 0:1 / ${mountItem.identity.replaceAll(" ", "\\040")} rw - ext4 /dev/root rw\n`);
  assert.throws(() => loadForgeSecurityMaterial({ ...mountItem.policy, mountInfoPath: mountInfo }), /bind mount/);
});

test("refuses wrong machine, host, trust digest and stale validity", { skip: process.platform === "win32" }, () => {
  const item = fixture();
  assert.throws(() => loadForgeSecurityMaterial({ ...item.policy, machineId: "other" }), /different machine/);
  assert.throws(() => loadForgeSecurityMaterial({ ...item.policy, hostname: "other" }), /different hostname/);
  assert.throws(() => loadForgeSecurityMaterial({ ...item.policy, now: new Date("2028-01-01T00:00:00.000Z") }), /not currently valid/);
  fs.chmodSync(item.trustedRoot, 0o644); fs.appendFileSync(item.trustedRoot, " "); fs.chmodSync(item.trustedRoot, 0o444);
  assert.throws(() => loadForgeSecurityMaterial(item.policy), /digest does not match/);
});

test("refuses a substituted Review Gate CA", { skip: process.platform === "win32" }, () => {
  const item = fixture();
  fs.chmodSync(item.reviewGateCa, 0o644); fs.writeFileSync(item.reviewGateCa, "-----BEGIN CERTIFICATE-----\nattacker\n-----END CERTIFICATE-----\n"); fs.chmodSync(item.reviewGateCa, 0o444);
  assert.throws(() => loadForgeSecurityMaterial(item.policy), /Review Gate CA does not match/);
});

test("refuses an unpinned owner key and a forged host-identity signature", { skip: process.platform === "win32" }, () => {
  const item = fixture();
  assert.throws(() => loadForgeSecurityMaterial({ ...item.policy, expectedOwnerPublicKey: "MCowBQYDK2VwAyEA" }), /reviewed release trust anchor/);
  fs.chmodSync(item.identity, 0o644);
  const identity = JSON.parse(fs.readFileSync(item.identity, "utf8")); identity.serverId = "substituted-server";
  fs.writeFileSync(item.identity, `${JSON.stringify(identity)}\n`); fs.chmodSync(item.identity, 0o444);
  assert.throws(() => loadForgeSecurityMaterial(item.policy), /signature is invalid/);
});
