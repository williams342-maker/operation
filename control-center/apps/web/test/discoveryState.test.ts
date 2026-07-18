import assert from "node:assert/strict";
import test from "node:test";
import { discoveryUiState } from "../src/discoveryState.js";
const current = { collectedAt: new Date().toISOString(), dockerInstalled: true, repositories: [], composeProjects: [], applications: [], warnings: [] };
test("discovery UI states are explicit", () => {
  assert.equal(discoveryUiState({ loading: true }), "loading"); assert.equal(discoveryUiState({ errorStatus: 403 }), "permission_denied"); assert.equal(discoveryUiState({ errorStatus: 500 }), "discovery_failed"); assert.equal(discoveryUiState({ agentStatus: "offline" }), "agent_offline"); assert.equal(discoveryUiState({ agentStatus: "online" }), "agent_incompatible"); assert.equal(discoveryUiState({ agentStatus: "online", discovery: { ...current, discoveryTruncated: true } }), "truncated"); assert.equal(discoveryUiState({ agentStatus: "online", discovery: { ...current, warnings: ["unreadable_path"] } }), "partial"); assert.equal(discoveryUiState({ agentStatus: "online", discovery: { ...current, collectedAt: new Date(0).toISOString() } }), "stale"); assert.equal(discoveryUiState({ agentStatus: "online", discovery: { ...current, dockerInstalled: false } }), "empty"); assert.equal(discoveryUiState({ agentStatus: "online", discovery: current }), "success");
});
