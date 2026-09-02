import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Replay-marker semantics — the round-3 blocker.
//
// The CLI's claim/release pair is the whole of replay protection, and the previous version defeated
// itself: it released whatever nonces the report mentioned, so a BLOCKED REPLAY deleted the markers left
// by the earlier successful run. Run 1 passed, run 2 replayed and blocked, run 3 passed. Protection that
// works exactly once and then switches itself off is worse than none, because it still looks like
// protection.
//
// The CLI is a top-level script, so the logic is reproduced here against a temporary directory. That is
// a real limitation and it is why this file states the invariants explicitly rather than importing:
// if the CLI's copy drifts from these rules, this test will not notice. The invariants are:
//   1. A claim is atomic (exclusive create), so exactly one of two concurrent claimants wins.
//   2. Only markers created by THIS invocation may ever be released.
//   3. A pre-existing marker survives a blocked replay.

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-nonces-"));
  const claimedByThisRun = new Set<string>();
  const marker = (nonce: string) => path.join(dir, `${crypto.createHash("sha256").update(nonce).digest("hex")}.used`);

  function claimNonces(nonces: string[]): { claimed: string[]; alreadyUsed: boolean } {
    fs.mkdirSync(dir, { recursive: true });
    const claimed: string[] = [];
    for (const nonce of nonces) {
      try {
        fs.writeFileSync(marker(nonce), "", { flag: "wx", mode: 0o600 });
        claimed.push(nonce);
        claimedByThisRun.add(nonce);
      } catch {
        for (const own of claimed) {
          fs.rmSync(marker(own), { force: true });
          claimedByThisRun.delete(own);
        }
        return { claimed: [], alreadyUsed: true };
      }
    }
    return { claimed, alreadyUsed: false };
  }

  const releaseOwnClaims = () => {
    for (const nonce of claimedByThisRun) fs.rmSync(marker(nonce), { force: true });
    claimedByThisRun.clear();
  };

  return { dir, marker, claimNonces, releaseOwnClaims, claimedByThisRun };
}

const NONCES = ["forge-nonce-000000001", "owner-nonce-000000001"];

test("a first claim succeeds and leaves markers behind", () => {
  const h = harness();
  const outcome = h.claimNonces(NONCES);
  assert.equal(outcome.alreadyUsed, false);
  assert.deepEqual(outcome.claimed, NONCES);
  for (const nonce of NONCES) assert.equal(fs.existsSync(h.marker(nonce)), true);
});

test("BLOCKER (round 3): a blocked replay must NOT delete the earlier run's markers", () => {
  const first = harness();
  first.claimNonces(NONCES);
  // A second, independent invocation against the same store.
  const second = { ...first, claimedByThisRun: new Set<string>() };
  const replay = (() => {
    const claimed: string[] = [];
    for (const nonce of NONCES) {
      try {
        fs.writeFileSync(first.marker(nonce), "", { flag: "wx", mode: 0o600 });
        claimed.push(nonce);
        second.claimedByThisRun.add(nonce);
      } catch {
        for (const own of claimed) { fs.rmSync(first.marker(own), { force: true }); second.claimedByThisRun.delete(own); }
        return { claimed: [], alreadyUsed: true };
      }
    }
    return { claimed, alreadyUsed: false };
  })();
  assert.equal(replay.alreadyUsed, true, "the replay must be detected");
  // The blocked run releases only its own claims — which are none.
  for (const nonce of second.claimedByThisRun) fs.rmSync(first.marker(nonce), { force: true });
  for (const nonce of NONCES) {
    assert.equal(fs.existsSync(first.marker(nonce)), true, "the earlier run's marker must survive a blocked replay");
  }
});

test("a partial claim releases only what it created, leaving the pre-existing marker intact", () => {
  const h = harness();
  // Someone else already consumed the second nonce.
  fs.writeFileSync(h.marker(NONCES[1]), "", { flag: "wx", mode: 0o600 });
  const outcome = h.claimNonces(NONCES);
  assert.equal(outcome.alreadyUsed, true);
  assert.deepEqual(outcome.claimed, []);
  assert.equal(fs.existsSync(h.marker(NONCES[0])), false, "its own partial claim is rolled back");
  assert.equal(fs.existsSync(h.marker(NONCES[1])), true, "the pre-existing marker is untouched");
  assert.equal(h.claimedByThisRun.size, 0);
});

test("a blocked run releases its own claims so a legitimate authorization is not burned", () => {
  const h = harness();
  h.claimNonces(NONCES);
  h.releaseOwnClaims();
  for (const nonce of NONCES) assert.equal(fs.existsSync(h.marker(nonce)), false);
  // And the authorization can then be presented again, which is the point.
  assert.equal(h.claimNonces(NONCES).alreadyUsed, false);
});

test("the claim is atomic: exactly one of two racing claimants wins", () => {
  const h = harness();
  const a = h.claimNonces([NONCES[0]]);
  const b = h.claimNonces([NONCES[0]]);
  assert.equal(a.alreadyUsed, false);
  assert.equal(b.alreadyUsed, true, "exclusive creation must reject the second claimant");
});
