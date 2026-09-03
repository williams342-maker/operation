import test from "node:test";
import assert from "node:assert/strict";
import { credentialIndex, generateCredential, hashCredential, verifyCredential } from "../src/auth.js";
import { disable, provision, rotate } from "../src/operator.js";
import type { Db } from "mongodb";
import type { Principal } from "../src/store.js";

// The operator CLI without a database.
//
// A tiny in-memory stand-in for the two collections it touches, so the PROVISIONING RULES are tested
// even though the Mongo store itself is unverified here. The rules are what matter: a credential is
// shown once and stored only as a hash, and the epoch increments on rotation and disablement.

type Row = Principal & { credentialIndex: string };

function fakeDb() {
  const principals: Row[] = [];
  const auditLog: Array<Record<string, unknown>> = [];
  // A stand-in session. The operator now wraps each principal change and its audit entry in ONE
  // transaction -- an independent review found they were two separate writes, so a crash between them
  // left a principal changed with no record of who changed it. This fake runs the callback and lets a
  // throw propagate, which is the behaviour the code depends on.
  const client = {
    startSession: () => ({
      withTransaction: async (work: () => Promise<void>) => { await work(); },
      endSession: async () => {},
    }),
  };
  const db = {
    client,
    collection(name: string) {
      if (name === "principalAudit") {
        return { insertOne: async (entry: Record<string, unknown>) => { auditLog.push(entry); } };
      }
      return {
        findOne: async (query: Record<string, unknown>) =>
          principals.find((p) =>
            Object.entries(query).every(([k, v]) => (p as Record<string, unknown>)[k] === v)) ?? null,
        insertOne: async (row: Row) => { principals.push({ ...row }); },
        updateOne: async (query: Record<string, unknown>, update: Record<string, never>) => {
          const row = principals.find((p) =>
            Object.entries(query).every(([k, v]) => (p as Record<string, unknown>)[k] === v));
          if (!row) return { matchedCount: 0, modifiedCount: 0 };
          Object.assign(row, update.$set ?? {});
          for (const [k, delta] of Object.entries(update.$inc ?? {})) {
            (row as Record<string, unknown>)[k] = Number((row as Record<string, unknown>)[k]) + Number(delta);
          }
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    },
  } as unknown as Db;
  return { db, principals, auditLog };
}

test("provisioning stores a hash, never the credential", async () => {
  const { db, principals } = fakeDb();
  const { credential } = await provision(db, {
    principalId: "codex", displayName: "Codex",
    roles: ["reviewer"], reviewerClasses: ["independent"], audienceFor: [],
  });
  const [row] = principals;
  assert.equal(row.credentialHash.includes(credential), false,
    "the stored hash must not embed the secret");
  assert.ok(verifyCredential(credential, row.credentialHash));
  assert.equal(row.credentialIndex, credentialIndex(credential),
    "the lookup index is what locates the row; the salted hash is what authenticates");
  assert.equal(row.credentialEpoch, 1, "epochs start at 1 and only increase");
});

test("the same principal cannot be provisioned twice", async () => {
  const { db } = fakeDb();
  const args = { principalId: "codex", displayName: "Codex",
    roles: ["reviewer"], reviewerClasses: ["independent"], audienceFor: [] };
  await provision(db, args);
  await assert.rejects(() => provision(db, args), /already exists/,
    "re-provisioning would silently replace a credential someone is using");
});

test("rotation increments the epoch, which is what invalidates work in flight", async () => {
  const { db, principals } = fakeDb();
  const first = await provision(db, {
    principalId: "agent-1", displayName: "Agent", roles: ["executor"],
    reviewerClasses: [], audienceFor: [{ orgId: "org-1", serverId: "server-1" }],
  });
  const second = await rotate(db, "agent-1");
  const [row] = principals;
  assert.notEqual(first.credential, second.credential);
  assert.equal(verifyCredential(first.credential, row.credentialHash), false,
    "the old credential must stop working");
  assert.ok(verifyCredential(second.credential, row.credentialHash));
  assert.equal(row.credentialEpoch, 2,
    "a lease stamped at epoch 1 no longer matches, so work authorized to the old credential fails");
});

test("disabling also bumps the epoch", async () => {
  // Otherwise a disabled principal's outstanding lease would still match and could be redeemed.
  const { db, principals } = fakeDb();
  await provision(db, {
    principalId: "agent-1", displayName: "Agent", roles: ["executor"],
    reviewerClasses: [], audienceFor: [],
  });
  await disable(db, "agent-1");
  const [row] = principals;
  assert.ok(row.disabledAt);
  assert.equal(row.credentialEpoch, 2);
});

test("every provisioning action is audited", async () => {
  const { db, auditLog } = fakeDb();
  await provision(db, {
    principalId: "codex", displayName: "Codex", roles: ["reviewer"],
    reviewerClasses: ["independent"], audienceFor: [],
  });
  await rotate(db, "codex");
  await disable(db, "codex");
  assert.deepEqual(auditLog.map((e) => e.action), ["provision", "rotate", "disable"]);
  for (const entry of auditLog) {
    assert.ok(entry.by, "the audit records who ran the command");
    assert.ok(entry.at, "and when");
    assert.equal(String(JSON.stringify(entry)).includes("rgc_"), false,
      "a credential must never reach the audit log");
  }
});

test("rotating or disabling an unknown principal is an error, not a silent no-op", async () => {
  const { db } = fakeDb();
  await assert.rejects(() => rotate(db, "nobody"), /no such principal/);
  await assert.rejects(() => disable(db, "nobody"), /no such principal/);
});

test("a generated credential is not derivable from what is stored", () => {
  // Belt and braces on the property the whole provisioning model rests on.
  const credential = generateCredential();
  const stored = hashCredential(credential);
  const index = credentialIndex(credential);
  assert.equal(stored.includes(credential), false);
  assert.equal(index.includes(credential), false);
  assert.notEqual(hashCredential(credential), stored, "salted, so two hashes differ");
});
