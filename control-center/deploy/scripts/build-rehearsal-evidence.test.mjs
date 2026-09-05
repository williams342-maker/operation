import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/build-rehearsal-evidence.mjs", import.meta.url));
const commit = "a".repeat(40);
const rollbackCommit = "b".repeat(40);

test("rehearsal evidence builder emits an exclusive exact schema", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-evidence-"));
  const output = path.join(root, "evidence.json");
  const imageEnv = Object.fromEntries(["CANDIDATE", "ROLLBACK"].flatMap((set, setIndex) => ["API", "WEB", "ADMIN", "GATE"].map((role, roleIndex) => [`${set}_${role}_IMAGE_ID`, `sha256:${String(setIndex * 4 + roleIndex + 1).repeat(64).slice(0, 64)}`])));
  const env = { ...process.env, CANDIDATE_TAG: "v1.2.3-operate", CANDIDATE_COMMIT: commit, ROLLBACK_TAG: "v1.2.2-operate", ROLLBACK_COMMIT: rollbackCommit, MIGRATIONS_PRESENT: "false", ...imageEnv };
  execFileSync(process.execPath, [script, output], { env });
  const evidence = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(evidence.candidateCommit, commit);
  assert.equal(evidence.rollbackCommit, rollbackCommit);
  assert.equal(evidence.mongoTopology, "replica-set");
  assert.match(evidence.images.candidate.api, /^sha256:/);
  assert.equal(evidence.scenarios.interrupted_migration, "not-applicable-no-migrations");
  assert.throws(() => execFileSync(process.execPath, [script, output], { env }));
});

test("rehearsal evidence builder rejects malformed identity", () => {
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-invalid-")), "evidence.json");
  assert.throws(() => execFileSync(process.execPath, [script, output], { env: { ...process.env, CANDIDATE_TAG: "latest", CANDIDATE_COMMIT: commit, ROLLBACK_TAG: "v1.2.2-operate", ROLLBACK_COMMIT: rollbackCommit } }));
});
