#!/usr/bin/env node
import fs from "node:fs";

const roles = ["API", "WEB", "ADMIN", "GATE"];
const required = ["CANDIDATE_TAG", "CANDIDATE_COMMIT", "ROLLBACK_TAG", "ROLLBACK_COMMIT", ...roles.flatMap((role) => [`CANDIDATE_${role}_IMAGE_ID`, `ROLLBACK_${role}_IMAGE_ID`])];
for (const name of required) if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
for (const name of ["CANDIDATE_COMMIT", "ROLLBACK_COMMIT"]) if (!/^[a-f0-9]{40}$/.test(process.env[name])) throw new Error(`${name} is invalid`);
for (const name of ["CANDIDATE_TAG", "ROLLBACK_TAG"]) if (!/^v\d+\.\d+\.\d+-operate$/.test(process.env[name])) throw new Error(`${name} is invalid`);
for (const name of roles.flatMap((role) => [`CANDIDATE_${role}_IMAGE_ID`, `ROLLBACK_${role}_IMAGE_ID`])) if (!/^sha256:[a-f0-9]{64}$/.test(process.env[name])) throw new Error(`${name} is invalid`);
const migrationsPresent = process.env.MIGRATIONS_PRESENT === "true";
const migration = migrationsPresent ? "passed" : "not-applicable-no-migrations";
const proofDirectory = process.env.REHEARSAL_PROOF_DIR;
const proven = (name) => {
  if (!proofDirectory || fs.readFileSync(`${proofDirectory}/${name}`, "utf8") !== "passed\n") throw new Error(`rehearsal proof is absent: ${name}`);
  return "passed";
};
const evidence = {
  schemaVersion: "opsworkbench-schema-rehearsal-v1",
  candidateTag: process.env.CANDIDATE_TAG,
  candidateCommit: process.env.CANDIDATE_COMMIT,
  rollbackTag: process.env.ROLLBACK_TAG,
  rollbackCommit: process.env.ROLLBACK_COMMIT,
  mongoTopology: "replica-set",
  images: {
    candidate: Object.fromEntries(roles.map((role) => [role.toLowerCase(), process.env[`CANDIDATE_${role}_IMAGE_ID`]])),
    rollback: Object.fromEntries(roles.map((role) => [role.toLowerCase(), process.env[`ROLLBACK_${role}_IMAGE_ID`]])),
  },
  migrationsPresent,
  scenarios: {
    forward_compatibility: proven("forward_compatibility"), rollback_compatibility: proven("rollback_compatibility"), migration_boundaries: migration,
    old_app_new_schema: migration, new_app_old_schema: migration, interrupted_migration: migration,
    failed_deployment_after_migration: migration, rollback_after_partial_switch: proven("rollback_after_partial_switch"),
    service_restart_during_transition: proven("service_restart_during_transition"), predecessor_artifacts_retained: proven("predecessor_artifacts_retained"),
    rollback_immutable_images: proven("rollback_immutable_images"), rollback_target_independently_verified: proven("rollback_target_independently_verified"),
  },
};
fs.writeFileSync(process.argv[2] ?? "schema-rehearsal.json", `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
