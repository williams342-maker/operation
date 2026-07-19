import assert from "node:assert/strict";
import test from "node:test";
import { aiOrganizationSettingsUpdateSchema } from "../src/index.js";

const valid = { enabled: false, provider: null, model: null, monthlyRequestLimit: null, monthlyTokenLimit: null, maximumRequestsPerUserPerHour: 20, maximumRequestsPerOrganizationPerDay: 200, maximumConcurrentRequests: 3, allowedScopeTypes: ["server"] as const, retentionAcknowledged: false };
test("AI settings reject arbitrary fields and invalid limits", () => { assert.equal(aiOrganizationSettingsUpdateSchema.safeParse({ ...valid, baseUrl: "https://attacker.invalid" }).success, false); assert.equal(aiOrganizationSettingsUpdateSchema.safeParse({ ...valid, maximumConcurrentRequests: 0 }).success, false); });
test("AI settings accept bounded server-controlled selections", () => { assert.equal(aiOrganizationSettingsUpdateSchema.safeParse(valid).success, true); });
