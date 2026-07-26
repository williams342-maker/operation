import { describe, expect, it } from "vitest";
import { parseDeploymentTargetProfile } from "./deploymentTargetProfile";

const profile = {
  projectId: "aaaaaaaaaaaaaaaaaaaaaaaa",
  environmentId: "cccccccccccccccccccccccc",
  serverId: "111111111111111111111111",
  repositoryRoot: "/etc/opsworkbench-agent/targets/site",
  environmentFilePath: "/etc/opsworkbench-agent/targets/site/env/.env.staging",
  composePath: "/etc/opsworkbench-agent/targets/site/docker-compose.yml",
  composeOverridePaths: ["/etc/opsworkbench-agent/targets/site/app.override.yml"],
  composeProject: "site-staging",
  statelessServices: ["api", "web"],
  protectedServices: ["mongo"],
  healthChecks: [{ id: "site-health", url: "https://staging.example.com/healthz", timeoutMs: 5000 }],
  currentConfigurationDigest: "a".repeat(64)
};
const scope = { projectId: profile.projectId, environmentId: profile.environmentId, environmentKind: "staging", protectedEnvironment: false };

describe("deployment target profile parsing", () => {
  it("preserves ordered Compose overrides and bounded non-production inputs", () => {
    expect(parseDeploymentTargetProfile(JSON.stringify(profile), scope)).toEqual({ ok: true, profile });
  });

  it("rejects scope mismatches, unsupported fields, escapes, overlap, and unsafe health URLs", () => {
    expect(parseDeploymentTargetProfile(JSON.stringify({ ...profile, projectId: "bbbbbbbbbbbbbbbbbbbbbbbb" }), scope)).toMatchObject({ ok: false, error: expect.stringContaining("scope") });
    expect(parseDeploymentTargetProfile(JSON.stringify({ ...profile, password: "do-not-accept" }), scope)).toMatchObject({ ok: false, error: expect.stringContaining("unsupported") });
    expect(parseDeploymentTargetProfile(JSON.stringify({ ...profile, composePath: "/etc/other/docker-compose.yml" }), scope)).toMatchObject({ ok: false, error: expect.stringContaining("repository root") });
    expect(parseDeploymentTargetProfile(JSON.stringify({ ...profile, protectedServices: ["api"] }), scope)).toMatchObject({ ok: false, error: expect.stringContaining("overlap") });
    expect(parseDeploymentTargetProfile(JSON.stringify({ ...profile, healthChecks: [{ id: "site-health", url: "https://user:pass@staging.example.com/healthz", timeoutMs: 5000 }] }), scope)).toMatchObject({ ok: false, error: expect.stringContaining("Health") });
  });

  it("independently rejects production and protected environments", () => {
    expect(parseDeploymentTargetProfile(JSON.stringify(profile), { ...scope, environmentKind: "production" })).toMatchObject({ ok: false, error: expect.stringContaining("unavailable") });
    expect(parseDeploymentTargetProfile(JSON.stringify(profile), { ...scope, protectedEnvironment: true })).toMatchObject({ ok: false, error: expect.stringContaining("unavailable") });
  });
});
