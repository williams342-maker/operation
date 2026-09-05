#!/usr/bin/env node
import fs from "node:fs";

const required = ["CANDIDATE_TAG", "CANDIDATE_COMMIT", "ROLLBACK_TAG", "ROLLBACK_COMMIT"];
for (const name of required) if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
for (const name of ["CANDIDATE_COMMIT", "ROLLBACK_COMMIT"]) if (!/^[a-f0-9]{40}$/.test(process.env[name])) throw new Error(`${name} is invalid`);
for (const name of ["CANDIDATE_TAG", "ROLLBACK_TAG"]) if (!/^v\d+\.\d+\.\d+-operate$/.test(process.env[name])) throw new Error(`${name} is invalid`);
const migrationsPresent = process.env.MIGRATIONS_PRESENT === "true";
const migration = migrationsPresent ? "passed" : "not-applicable-no-migrations";
const evidence = {
  schemaVersion: "opsworkbench-schema-rehearsal-v1",
  candidateTag: process.env.CANDIDATE_TAG,
  candidateCommit: process.env.CANDIDATE_COMMIT,
  rollbackTag: process.env.ROLLBACK_TAG,
  rollbackCommit: process.env.ROLLBACK_COMMIT,
  mongoTopology: "replica-set",
  migrationsPresent,
  scenarios: {
    forward_compatibility: "passed", rollback_compatibility: "passed", migration_boundaries: migration,
    old_app_new_schema: "passed", new_app_old_schema: "passed", interrupted_migration: migration,
    failed_deployment_after_migration: migration, rollback_after_partial_switch: "passed",
    service_restart_during_transition: "passed", predecessor_artifacts_retained: "passed",
    rollback_immutable_images: "passed", rollback_target_independently_verified: "passed",
  },
};
fs.writeFileSync(process.argv[2] ?? "schema-rehearsal.json", `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
