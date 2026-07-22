import { describe, expect, it } from "vitest";
import { discoveredGithubRepositories, normalizeGithubRepository, projectLocationChoices, projectSlug, repositoryName } from "./projectAutofill";

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
});
