export type DiscoveredRepository = {
  path: string;
  branch?: string;
  remote?: string;
};

export type DiscoveredComposeProject = {
  configPath: string;
};

export type ProjectDiscovery = {
  repositories?: DiscoveredRepository[];
  composeProjects?: DiscoveredComposeProject[];
};

export type ProjectLocationChoice = {
  repoPath: string;
  branch: string;
  composePaths: string[];
};

export function normalizeGithubRepository(value?: string): string | undefined {
  const raw = value?.trim();
  if (!raw || /[\r\n\0]/.test(raw)) return undefined;
  const shorthand = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if (shorthand) return `${shorthand[1]}/${shorthand[2]}`.toLowerCase();
  const ssh = raw.match(/^git@github\.com:([^/\s]+)\/([^\s]+?)(?:\.git)?$/i);
  if (ssh) return `${ssh[1]}/${ssh[2]}`.toLowerCase();
  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() !== "github.com" || url.username && url.username !== "git") return undefined;
    const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    return parts.length === 2 && parts.every(Boolean) ? parts.join("/").toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export function repositoryName(repository: string) {
  return repository.split("/").pop() || repository;
}

export function projectSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isInside(repositoryPath: string, candidatePath: string) {
  const prefix = repositoryPath.endsWith("/") ? repositoryPath : `${repositoryPath}/`;
  return candidatePath.startsWith(prefix) && !candidatePath.slice(prefix.length).split("/").includes("..");
}

export function discoveredGithubRepositories(discovery?: ProjectDiscovery) {
  return [...new Set((discovery?.repositories || []).map((item) => normalizeGithubRepository(item.remote)).filter((item): item is string => Boolean(item)))].sort();
}

export function projectLocationChoices(discovery: ProjectDiscovery | undefined, repository: string): ProjectLocationChoice[] {
  const selected = normalizeGithubRepository(repository);
  if (!selected) return [];
  return (discovery?.repositories || [])
    .filter((item) => normalizeGithubRepository(item.remote) === selected)
    .map((item) => ({
      repoPath: item.path,
      branch: item.branch || "main",
      composePaths: (discovery?.composeProjects || [])
        .map((compose) => compose.configPath)
        .filter((candidate) => isInside(item.path, candidate))
        .sort(),
    }))
    .sort((left, right) => left.repoPath.localeCompare(right.repoPath));
}
