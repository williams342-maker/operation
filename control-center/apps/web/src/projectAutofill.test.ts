import { describe, expect, it } from "vitest";
import { clearProjectDiscoveryValues, discoveredGithubRepositories, eligibleProjectServers, isEligibleProjectServer, normalizeGithubRepository, projectLocationChoices, projectSlug, repositoryName } from "./projectAutofill";

const now = Date.parse("2026-07-21T18:00:00.000Z");
const currentDiscovery = {
  collectedAt: new Date(now - 30_000).toISOString(),
  dockerInstalled: true,
  nginxInstalled: true,
  repositories: [{ path: "/srv/app", branch: "main", remote: "https://github.com/acme/app.git" }],
  composeProjects: [{ name: "app", configPath: "/srv/app/compose.yml", services: ["web"] }],
  applications: [{ path: "/srv/app", type: "node" as const, name: "app" }],
  settings: [],
  warnings: [],
  discoveryTruncated: false,
  truncationCategories: [],
};
const eligibleServer = {
  _id: "server-a",
  orgId: "org-a",
  enrollmentStatus: "connected",
  agentStatus: "online",
  lastHeartbeatAt: new Date(now - 30_000).toISOString(),
  currentState: { discovery: currentDiscovery },
};

describe("project discovery autofill", () => {
  it("normalizes safe GitHub shorthand, HTTPS, and SSH remotes", () => {
    expect(normalizeGithubRepository("Owner/Repo.git")).toBe("owner/repo");
    expect(normalizeGithubRepository("https://github.com/Owner/Repo.git")).toBe("owner/repo");
    expect(normalizeGithubRepository("git@github.com:Owner/Repo.git")).toBe("owner/repo");
    expect(normalizeGithubRepository("https://credential@github.com/Owner/Repo.git")).toBeUndefined();
    expect(normalizeGithubRepository("https://example.test/Owner/Repo.git")).toBeUndefined();
  });

  it("derives a friendly name and normalized slug", () => {
    expect(repositoryName("owner/CraftersMarket-Beta")).toBe("CraftersMarket-Beta");
    expect(projectSlug("CraftersMarket Beta")).toBe("craftersmarket-beta");
  });

  it("lists unique repositories without returning remote URLs", () => {
    const discovery = { repositories: [
      { path: "/srv/a", remote: "https://github.com/Owner/Repo.git" },
      { path: "/srv/b", remote: "git@github.com:owner/repo.git" },
      { path: "/srv/c", remote: "https://example.test/private.git" },
    ] };
    expect(discoveredGithubRepositories(discovery)).toEqual(["owner/repo"]);
  });

  it("returns every matching checkout and compose choice without guessing", () => {
    const choices = projectLocationChoices({
      repositories: [
        { path: "/srv/one", branch: "main", remote: "https://github.com/acme/shop.git" },
        { path: "/srv/two", branch: "beta", remote: "git@github.com:acme/shop.git" },
        { path: "/srv/other", remote: "https://github.com/acme/other.git" },
      ],
      composeProjects: [
        { configPath: "/srv/one/compose.yml" },
        { configPath: "/srv/one/deploy/docker-compose.yml" },
        { configPath: "/srv/two/docker-compose.yaml" },
        { configPath: "/srv/other/compose.yml" },
      ],
    }, "ACME/SHOP");
    expect(choices).toEqual([
      { repoPath: "/srv/one", branch: "main", composePaths: ["/srv/one/compose.yml", "/srv/one/deploy/docker-compose.yml"] },
      { repoPath: "/srv/two", branch: "beta", composePaths: ["/srv/two/docker-compose.yaml"] },
    ]);
  });

  it("returns no paths for an unknown or invalid repository", () => {
    const discovery = { repositories: [{ path: "/srv/app", remote: "https://github.com/acme/app.git" }] };
    expect(projectLocationChoices(discovery, "acme/missing")).toEqual([]);
    expect(projectLocationChoices(discovery, "not a repository")).toEqual([]);
  });

  it("accepts only a connected server with fresh heartbeat and current usable discovery", () => {
    expect(isEligibleProjectServer(eligibleServer, "org-a", now)).toBe(true);
    expect(isEligibleProjectServer({ ...eligibleServer, enrollmentStatus: "pending" }, "org-a", now)).toBe(false);
    expect(isEligibleProjectServer({ ...eligibleServer, revokedAt: new Date(now).toISOString() }, "org-a", now)).toBe(false);
    expect(isEligibleProjectServer({ ...eligibleServer, archivedAt: new Date(now).toISOString() }, "org-a", now)).toBe(false);
    expect(isEligibleProjectServer({ ...eligibleServer, agentStatus: "offline" }, "org-a", now)).toBe(false);
    expect(isEligibleProjectServer({ ...eligibleServer, lastHeartbeatAt: new Date(now - 91_000).toISOString() }, "org-a", now)).toBe(false);
  });

  it("excludes missing, malformed, empty, and stale discovery inventories", () => {
    expect(isEligibleProjectServer({ ...eligibleServer, currentState: undefined }, "org-a", now)).toBe(false);
    expect(isEligibleProjectServer({ ...eligibleServer, currentState: {} }, "org-a", now)).toBe(false);
    expect(isEligibleProjectServer({ ...eligibleServer, currentState: { discovery: { collectedAt: "invalid" } } }, "org-a", now)).toBe(false);
    expect(isEligibleProjectServer({ ...eligibleServer, currentState: { discovery: { ...currentDiscovery, dockerInstalled: false, nginxInstalled: false, repositories: [], composeProjects: [], applications: [] } } }, "org-a", now)).toBe(false);
    expect(isEligibleProjectServer({ ...eligibleServer, currentState: { discovery: { ...currentDiscovery, collectedAt: new Date(now - 120_001).toISOString() } } }, "org-a", now)).toBe(false);
  });

  it("enforces organization and independent server discovery isolation", () => {
    const serverB = { ...eligibleServer, _id: "server-b", currentState: { discovery: { ...currentDiscovery, repositories: [{ path: "/srv/other", remote: "https://github.com/acme/other.git" }] } } };
    const crossOrg = { ...eligibleServer, _id: "server-cross", orgId: "org-b" };
    expect(eligibleProjectServers([eligibleServer, serverB, crossOrg], "org-a", now).map((server) => server._id)).toEqual(["server-a", "server-b"]);
    expect(discoveredGithubRepositories(eligibleServer.currentState.discovery)).toEqual(["acme/app"]);
    expect(discoveredGithubRepositories(serverB.currentState.discovery)).toEqual(["acme/other"]);
  });

  it("keeps a current connected server without a valid GitHub remote safely non-actionable", () => {
    const server = { ...eligibleServer, currentState: { discovery: { ...currentDiscovery, repositories: [{ path: "/srv/app", remote: "https://example.test/acme/app.git" }] } } };
    expect(isEligibleProjectServer(server, "org-a", now)).toBe(true);
    expect(discoveredGithubRepositories(server.currentState.discovery)).toEqual([]);
  });

  it("clears every server-derived value when eligibility or organization changes", () => {
    expect(clearProjectDiscoveryValues({ name: "App", slug: "app", primaryServerId: "server-a", githubRepository: "acme/app", branch: "beta", repoPath: "/srv/app", composePath: "/srv/app/compose.yml", serviceNames: "web" })).toEqual({ name: "", slug: "", primaryServerId: "", githubRepository: "", branch: "main", repoPath: "", composePath: "", serviceNames: "web" });
  });
});
