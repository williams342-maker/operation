import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { scopedFilter } from "../src/db.js";

const resources = ["users", "servers", "projects", "enrollments", "healthChecks", "mongoChecks", "telemetry", "auditEvents", "marketingAccounts", "marketingCampaigns", "marketingMetricsDaily", "marketingGoals", "marketingInsights"];

for (const resource of resources) {
  test(`${resource} query scope overrides attacker-supplied organization`, () => {
    const orgA = new ObjectId();
    const orgB = new ObjectId();
    const filter = scopedFilter(orgA, { _id: new ObjectId(), orgId: orgB } as any);
    assert.equal(filter.orgId, orgA);
    assert.notEqual(filter.orgId.toHexString(), orgB.toHexString());
  });
}
