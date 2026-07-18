import test from "node:test";
import assert from "node:assert/strict";
import { agentPollRequestSchema, applicationDiscoverySchema, serverMetricsSchema } from "../src/protocol.js";

test("server metrics reject unreasonable CPU values", () => {
  const parsed = serverMetricsSchema.safeParse({
    collectedAt: new Date().toISOString(),
    agentVersion: "test",
    uptimeSeconds: 1,
    cpu: { loadPercent: 101, cores: 2 },
    memory: { totalBytes: 10, usedBytes: 5 },
    disk: []
  });
  assert.equal(parsed.success, false);
});

test("application discovery accepts sanitized read-only inventory", () => {
  const discovery = { collectedAt: new Date().toISOString(), dockerInstalled: true, composeProjects: [{ name: "CraftersMarket", configPath: "/root/Craftersmarket/docker-compose.yml", services: ["frontend", "backend", "mongo"] }], repositories: [{ path: "/root/Craftersmarket", branch: "main", commit: "abc123", remote: "git@github.com:example/repo.git", dirty: false }], applications: [{ path: "/root/Craftersmarket/frontend", type: "node", name: "frontend" }], nginxInstalled: true };
  assert.equal(applicationDiscoverySchema.safeParse(discovery).success, true);
  assert.equal(agentPollRequestSchema.safeParse({ heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "test" }, discovery }).success, true);
});
