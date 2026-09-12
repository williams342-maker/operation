import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadForgeSecurityMaterial, type SecurityPathPolicy } from "../src/forgeSecurityIdentity.js";

// THE CEREMONY, REHEARSED END TO END with a throwaway key.
//
// The owner's real key is offline and appears nowhere here. What this exercises is the path between the
// tools: build the unsigned identity from real files, sign it, install it, and have the agent's own
// loader accept it — and then, for each thing a ceremony can get wrong, watch the loader refuse. Every
// previous attempt to establish this chain was reviewed on the documents rather than on a run, and the
// hole moved each time.
const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.resolve(here, "..", "..", "..", "scripts");
const sha256 = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");
const node = (script: string, args: string[]) => execFileSync(process.execPath, [path.join(scripts, script), ...args], { encoding: "utf8" });

const org = "6a5dab47776e3028ac9b604b";
const server = "6a5f685ff8195a8813879bd7";
const hostname = "Ops-Workbench";
const machineId = "the-machine-id";

function ceremony() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-ceremony-"));
  const keyDirectory = path.join(root, "owner-key");
  node("generate-forge-owner-key.mjs", [keyDirectory]);
  const ownerPublicKey = JSON.parse(fs.readFileSync(path.join(keyDirectory, "forge-owner-public.json"), "utf8")).publicKey as string;

  const security = path.join(root, "etc", "opsworkbench-forge");
  fs.mkdirSync(security, { recursive: true, mode: 0o755 });
  for (const directory of [root, path.join(root, "etc"), security]) fs.chmodSync(directory, 0o755);
  const trustedRootPath = path.join(security, "trusted-root.json");
  const reviewGateCaPath = path.join(security, "review-gate-ca.pem");
  fs.writeFileSync(trustedRootPath, `${JSON.stringify({ mediaType: "application/vnd.dev.sigstore.trustedroot+json;version=0.1", tlogs: [] })}\n`, { mode: 0o444 });
  fs.writeFileSync(reviewGateCaPath, "-----BEGIN CERTIFICATE-----\nrehearsal\n-----END CERTIFICATE-----\n", { mode: 0o444 });

  const unsignedPath = path.join(root, "unsigned-identity.json");
  const built = JSON.parse(node("build-forge-security-identity.mjs", [
    "--org", org, "--server", server, "--hostname", hostname,
    "--machine-id-sha256", sha256(machineId),
    "--owner-public-key", ownerPublicKey,
    "--trusted-root", trustedRootPath, "--review-gate-ca", reviewGateCaPath,
    "--valid-from", "2026-09-01T00:00:00.000Z", "--valid-until", "2027-09-01T00:00:00.000Z",
    "--output", unsignedPath,
  ]));

  const identityPath = path.join(security, "identity.json");
  node("sign-forge-security-identity.mjs", ["--private-key", path.join(keyDirectory, "forge-owner-private.pem"), "--unsigned", unsignedPath, "--output", identityPath]);
  fs.chmodSync(identityPath, 0o444);

  const policy: SecurityPathPolicy = {
    directory: security, identityPath, trustedRootPath, reviewGateCaPath,
    expectedUid: process.getuid?.() ?? 0, expectedGid: process.getgid?.() ?? 0,
    directoryMode: 0o755, fileMode: 0o444, hostname, machineId,
    ancestorBoundary: root,
    expectedOwnerPublicKey: ownerPublicKey, expectedOwnerPublicKeySha256: sha256(Buffer.from(ownerPublicKey, "base64url")),
  };
  return { root, security, identityPath, trustedRootPath, reviewGateCaPath, ownerPublicKey, built, policy };
}

const rewrite = (file: string, body: string) => { fs.chmodSync(file, 0o644); fs.writeFileSync(file, body); fs.chmodSync(file, 0o444); };

test("the builder produces exactly the document the signer will accept", () => {
  const { built, identityPath, ownerPublicKey } = ceremony();
  assert.match(built.sha256, /^[a-f0-9]{64}$/, "the unsigned document is hashed, so what reaches the offline machine can be checked on arrival");
  const identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
  assert.deepEqual(Object.keys(identity).sort(), ["hostname", "machineIdSha256", "orgId", "ownerPublicKey", "ownerSignature", "reviewGateCaSha256", "schemaVersion", "serverId", "trustedRootSha256", "validFrom", "validUntil"]);
  assert.equal(identity.ownerPublicKey, ownerPublicKey);
  assert.equal(identity.orgId, org);
  assert.equal(identity.trustedRootSha256, built.trustedRootSha256, "the digests the builder measured are the ones that got signed");
});

test("the builder refuses what the target would reject later", () => {
  const { trustedRootPath, reviewGateCaPath, root, ownerPublicKey } = ceremony();
  const attempt = (overrides: Record<string, string>) => {
    const args = {
      "--org": org, "--server": server, "--hostname": hostname, "--machine-id-sha256": sha256(machineId),
      "--owner-public-key": ownerPublicKey, "--trusted-root": trustedRootPath, "--review-gate-ca": reviewGateCaPath,
      "--valid-from": "2026-09-01T00:00:00.000Z", "--valid-until": "2027-09-01T00:00:00.000Z",
      "--output": path.join(root, `attempt-${crypto.randomUUID()}.json`), ...overrides,
    };
    return () => node("build-forge-security-identity.mjs", Object.entries(args).flat());
  };
  // A raw machine id instead of its digest is the mistake that looks most like success: it is a string,
  // it is about the right length, and only the loader would ever notice.
  assert.throws(attempt({ "--machine-id-sha256": machineId }), /machine-id-sha256/);
  assert.throws(attempt({ "--valid-until": "2026-08-01T00:00:00.000Z" }), /ends before it begins/);
  assert.throws(attempt({ "--valid-from": "2026-09-01" }), /ISO-8601/);
  assert.throws(attempt({ "--hostname": "Ops\nWorkbench" }), /control characters/);
  assert.throws(attempt({ "--review-gate-ca": trustedRootPath }), /not a PEM certificate/);
});

test("the signer refuses a key that is not the one the document names", () => {
  const { root, identityPath } = ceremony();
  const otherKey = path.join(root, "other-key");
  node("generate-forge-owner-key.mjs", [otherKey]);
  const unsigned = { ...JSON.parse(fs.readFileSync(identityPath, "utf8")) };
  delete unsigned.ownerSignature;
  const unsignedPath = path.join(root, "unsigned-for-other.json");
  fs.writeFileSync(unsignedPath, `${JSON.stringify(unsigned, null, 2)}\n`);
  assert.throws(
    () => node("sign-forge-security-identity.mjs", ["--private-key", path.join(otherKey, "forge-owner-private.pem"), "--unsigned", unsignedPath, "--output", path.join(root, "wrong.json")]),
    /does not carry the public half of this owner key/,
  );
});

test("the agent's own loader accepts what the ceremony produced", { skip: process.platform === "win32" }, () => {
  const { policy } = ceremony();
  const material = loadForgeSecurityMaterial(policy);
  assert.equal(material.identity.orgId, org);
  assert.equal(material.identity.serverId, server);
});

for (const [what, mutate] of [
  ["the identity is for another host", (c: ReturnType<typeof ceremony>) => ({ ...c.policy, hostname: "someone-else" })],
  ["the identity is for another machine", (c: ReturnType<typeof ceremony>) => ({ ...c.policy, machineId: "another-machine" })],
  ["the validity window has passed", (c: ReturnType<typeof ceremony>) => { const identity = JSON.parse(fs.readFileSync(c.identityPath, "utf8")); identity.validUntil = "2026-09-02T00:00:00.000Z"; rewrite(c.identityPath, `${JSON.stringify(identity, null, 2)}\n`); return c.policy; }],
  ["the trusted root was swapped after signing", (c: ReturnType<typeof ceremony>) => { rewrite(c.trustedRootPath, `${JSON.stringify({ mediaType: "application/vnd.dev.sigstore.trustedroot+json;version=0.1", tlogs: [{ swapped: true }] })}\n`); return c.policy; }],
  ["the review gate CA was swapped after signing", (c: ReturnType<typeof ceremony>) => { rewrite(c.reviewGateCaPath, "-----BEGIN CERTIFICATE-----\nsomebody else\n-----END CERTIFICATE-----\n"); return c.policy; }],
  ["a field was edited after signing", (c: ReturnType<typeof ceremony>) => { const identity = JSON.parse(fs.readFileSync(c.identityPath, "utf8")); identity.serverId = "9".repeat(24); rewrite(c.identityPath, `${JSON.stringify(identity, null, 2)}\n`); return c.policy; }],
  ["the owner key is not the reviewed anchor", (c: ReturnType<typeof ceremony>) => ({ ...c.policy, expectedOwnerPublicKeySha256: "f".repeat(64) })],
] as const) {
  test(`the ceremony fails closed when ${what}`, { skip: process.platform === "win32" }, () => {
    const prepared = ceremony();
    const policy = mutate(prepared);
    assert.throws(() => loadForgeSecurityMaterial(policy), "the loader must refuse, and refusing is what keeps a wrong ceremony from becoming a running agent");
  });
}
