import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { forgeSecurityIdentityStatement, loadForgeSecurityMaterial, type SecurityPathPolicy } from "../src/forgeSecurityIdentity.js";

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

test("the signer enforces the loader's structural rules before a signature exists", () => {
  // A signature over a document the target will refuse is worth less than no signature: it looks like a
  // completed ceremony and only fails on the host, where the remedy is another ceremony.
  const { root, identityPath } = ceremony();
  const base = { ...JSON.parse(fs.readFileSync(identityPath, "utf8")) };
  delete base.ownerSignature;
  const keyDirectory = path.join(root, "signing-key");
  node("generate-forge-owner-key.mjs", [keyDirectory]);
  const signWith = (unsigned: Record<string, unknown>, label: string) => {
    const file = path.join(root, `${label}.json`);
    fs.writeFileSync(file, `${JSON.stringify(unsigned, null, 2)}\n`);
    return () => node("sign-forge-security-identity.mjs", ["--private-key", path.join(keyDirectory, "forge-owner-private.pem"), "--unsigned", file, "--output", path.join(root, `${label}-signed.json`)]);
  };
  // Caught by the all-fields sweep now rather than the three-field rule, so the message names the field.
  assert.throws(signWith({ ...base, hostname: "Ops\nWorkbench" }, "control-character"), /hostname contains a control character/);
  assert.throws(signWith({ ...base, orgId: "" }, "empty-org"), /non-empty/);
  assert.throws(signWith({ ...base, validFrom: "2026-09-01" }, "loose-instant"), /exact ISO-8601 instant/);
  assert.throws(signWith({ ...base, validUntil: base.validFrom }, "inverted"), /ends before it begins/);
  assert.throws(signWith({ ...base, ownerPublicKey: "not base64url!" }, "bad-key"), /base64url/);
});

test("a control character in ANY identity field is refused, not only the three with rules of their own", () => {
  // The statement the owner signs is the fields joined with newlines. A control character anywhere in it
  // can shift a boundary, so two different identities could produce the same signed bytes — which is why
  // this sweeps every field rather than the ones that happen to have a pattern today.
  const { root, identityPath } = ceremony();
  const base = { ...JSON.parse(fs.readFileSync(identityPath, "utf8")) };
  delete base.ownerSignature;
  const keyDirectory = path.join(root, "sweep-key");
  node("generate-forge-owner-key.mjs", [keyDirectory]);

  for (const field of Object.keys(base)) {
    const file = path.join(root, `sweep-${field}.json`);
    fs.writeFileSync(file, `${JSON.stringify({ ...base, [field]: `${base[field]}\u0000shifted` }, null, 2)}\n`);
    assert.throws(
      () => node("sign-forge-security-identity.mjs", ["--private-key", path.join(keyDirectory, "forge-owner-private.pem"), "--unsigned", file, "--output", path.join(root, `sweep-${field}-signed.json`)]),
      // Named exactly. A review pointed out that the loose alternation this used to carry accepted any
      // error mentioning the field, so for the digests and the timestamps it could not tell the sweep
      // from that field's own pattern rule — and the sweep was therefore covered by three fields out of
      // ten. The signer now runs the sweep before the patterns, so this can insist on the sweep.
      new RegExp(`${field} contains a control character`),
      `a control character in ${field} must not reach a signature`,
    );
  }

  // And the builder refuses to produce one, so the tools agree rather than one catching the other's work.
  const { trustedRootPath, reviewGateCaPath, ownerPublicKey } = ceremony();
  assert.throws(() => node("build-forge-security-identity.mjs", [
    "--org", `${org}\u0001`, "--server", server, "--hostname", hostname,
    "--machine-id-sha256", sha256(machineId), "--owner-public-key", ownerPublicKey,
    "--trusted-root", trustedRootPath, "--review-gate-ca", reviewGateCaPath,
    "--valid-from", "2026-09-01T00:00:00.000Z", "--valid-until", "2027-09-01T00:00:00.000Z",
    "--output", path.join(root, "sweep-built.json"),
  ]), /control character/);
});

test("a line terminator that is not ASCII is refused as well", () => {
  // The predicate stopped at U+007F, so a review signed a document whose hostname carried U+0085 NEXT
  // LINE and verified the signature. U+0085, U+2028 and U+2029 are line terminators to a great many
  // parsers even though they are not the byte the statement is joined with, and "reject control
  // characters in all identity fields" is not honoured by rejecting only the ASCII ones.
  const { root, identityPath } = ceremony();
  const base = { ...JSON.parse(fs.readFileSync(identityPath, "utf8")) };
  delete base.ownerSignature;
  const keyDirectory = path.join(root, "c1-key");
  node("generate-forge-owner-key.mjs", [keyDirectory]);

  // Written as code points rather than as the characters themselves: a literal U+2028 in a JavaScript
  // source file is the very hazard under test, and a reviewer cannot see it in the diff.
  for (const [label, character] of [["c1-next-line", 0x85], ["c1-string-terminator", 0x9c], ["line-separator", 0x2028], ["paragraph-separator", 0x2029]] as const) {
    const injected = String.fromCodePoint(character);
    const file = path.join(root, `${label}.json`);
    fs.writeFileSync(file, `${JSON.stringify({ ...base, hostname: `${base.hostname}${injected}injected` }, null, 2)}\n`);
    assert.throws(
      () => node("sign-forge-security-identity.mjs", ["--private-key", path.join(keyDirectory, "forge-owner-private.pem"), "--unsigned", file, "--output", path.join(root, `${label}-signed.json`)]),
      /control character/,
      `${label} must not reach a signature`,
    );
  }

  // And the builder refuses EVERY one of them, not just the first. A review deleted the two separators
  // from the builder alone and every ceremony test still passed, because this half of the case only ever
  // tried U+0085: the two tools are supposed to agree, and a test that checks one of them on four
  // characters and the other on one cannot tell when they stop agreeing.
  const { trustedRootPath, reviewGateCaPath, ownerPublicKey } = ceremony();
  for (const [label, character] of [["c1-next-line", 0x85], ["c1-string-terminator", 0x9c], ["line-separator", 0x2028], ["paragraph-separator", 0x2029]] as const) {
    assert.throws(() => node("build-forge-security-identity.mjs", [
      "--org", org, "--server", server, "--hostname", `${hostname}${String.fromCodePoint(character)}`,
      "--machine-id-sha256", sha256(machineId), "--owner-public-key", ownerPublicKey,
      "--trusted-root", trustedRootPath, "--review-gate-ca", reviewGateCaPath,
      "--valid-from", "2026-09-01T00:00:00.000Z", "--valid-until", "2027-09-01T00:00:00.000Z",
      "--output", path.join(root, `c1-built-${label}.json`),
    ]), /control characters/, `the builder must refuse ${label} too`);
  }
});

test("a field that is not a string never reaches a signature", () => {
  // The sweep checked string values only, so an array or an object walked past it and was stringified
  // into the statement on the way: a review obtained a cryptographically valid signature over a statement
  // carrying an extra newline that way. The loader would refuse that document, but a signer that signs it
  // is a signer that lies.
  const { root, identityPath } = ceremony();
  const base = { ...JSON.parse(fs.readFileSync(identityPath, "utf8")) };
  delete base.ownerSignature;
  const keyDirectory = path.join(root, "types-key");
  node("generate-forge-owner-key.mjs", [keyDirectory]);
  const signWith = (unsigned: Record<string, unknown>, label: string) => {
    const file = path.join(root, `${label}.json`);
    fs.writeFileSync(file, `${JSON.stringify(unsigned, null, 2)}\n`);
    return () => node("sign-forge-security-identity.mjs", ["--private-key", path.join(keyDirectory, "forge-owner-private.pem"), "--unsigned", file, "--output", path.join(root, `${label}-signed.json`)]);
  };
  assert.throws(signWith({ ...base, orgId: [["alpha\nbeta"]] }, "nested-array"), /orgId must be a string/);
  assert.throws(signWith({ ...base, hostname: { toString: "x" } }, "object-hostname"), /hostname must be a string/);
  // These two are caught earlier, by the digest pattern and the instant parse — which is the point: a
  // non-string is refused wherever it lands, not only by the sweep.
  assert.throws(signWith({ ...base, machineIdSha256: 12345 }, "numeric-digest"), /machineIdSha256/);
  assert.throws(signWith({ ...base, validUntil: null }, "null-window"), /validUntil/);
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

test("the signer refuses a document that is not the schema version it claims", () => {
  // The literal check moved after the control-character sweep so the sweep could be the rule that speaks
  // for every field, and nothing then asserted the literal still ran. It does.
  const { root, identityPath } = ceremony();
  const base = { ...JSON.parse(fs.readFileSync(identityPath, "utf8")) };
  delete base.ownerSignature;
  const keyDirectory = path.join(root, "schema-key");
  node("generate-forge-owner-key.mjs", [keyDirectory]);
  const file = path.join(root, "wrong-schema.json");
  fs.writeFileSync(file, `${JSON.stringify({ ...base, schemaVersion: "forge-security-identity-v2" }, null, 2)}
`);
  assert.throws(() => node("sign-forge-security-identity.mjs", ["--private-key", path.join(keyDirectory, "forge-owner-private.pem"), "--unsigned", file, "--output", path.join(root, "wrong-schema-signed.json")]), /missing or unknown fields/);
});

test("the loader refuses a control character on its own account, not because the signer would have", { skip: process.platform === "win32" }, () => {
  // The signer refuses to mint such a document, so every loader test that goes through the signer proves
  // only that the signer works. This signs the statement directly with the ceremony's own key, which is
  // what a document minted by any other route would look like, and asks the loader by itself. The field
  // is the organisation because nothing else in the loader binds it, so the control-character rule is
  // the only thing that can refuse.
  const { root, policy, identityPath } = ceremony();
  const unsigned = { ...JSON.parse(fs.readFileSync(identityPath, "utf8")), orgId: `${org}${String.fromCodePoint(0x85)}` };
  delete unsigned.ownerSignature;
  const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(root, "owner-key", "forge-owner-private.pem")));
  const ownerSignature = crypto.sign(null, forgeSecurityIdentityStatement(unsigned), privateKey).toString("base64url");
  rewrite(identityPath, `${JSON.stringify({ ...unsigned, ownerSignature }, null, 2)}
`);

  assert.throws(() => loadForgeSecurityMaterial(policy), /control characters are forbidden/);
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
