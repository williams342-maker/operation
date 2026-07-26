export type DeploymentTargetProfile = {
  projectId: string;
  environmentId: string;
  serverId: string;
  repositoryRoot: string;
  environmentFilePath: string;
  composePath: string;
  composeOverridePaths: string[];
  composeProject: string;
  statelessServices: string[];
  protectedServices: string[];
  healthChecks: Array<{ id: string; url: string; timeoutMs: number }>;
  currentConfigurationDigest?: string;
};

export type DeploymentTargetScope = { projectId: string; environmentId: string; environmentKind?: string; protectedEnvironment?: boolean };
export type DeploymentTargetParseResult = { ok: true; profile: DeploymentTargetProfile } | { ok: false; error: string };

const objectId = /^[a-f0-9]{24}$/i;
const digest = /^[a-f0-9]{64}$/;
const safeId = /^[A-Za-z0-9._:-]{1,160}$/;
const requiredKeys = ["projectId", "environmentId", "serverId", "repositoryRoot", "environmentFilePath", "composePath", "composeProject", "statelessServices", "protectedServices", "healthChecks"];
const optionalKeys = ["composeOverridePaths", "currentConfigurationDigest"];

function boundedString(value: unknown, maximum = 1024): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\0\r\n]/.test(value);
}

function absolutePath(value: unknown): value is string {
  if (!boundedString(value) || !value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/").slice(1);
  return segments.length > 0 && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function contained(root: string, candidate: string) {
  return candidate !== root && candidate.startsWith(`${root}/`);
}

function stringList(value: unknown, minimum: number, maximum: number): value is string[] {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum && value.every((item) => typeof item === "string" && safeId.test(item)) && new Set(value).size === value.length;
}

function parseHealthChecks(value: unknown): DeploymentTargetProfile["healthChecks"] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return null;
  const parsed: DeploymentTargetProfile["healthChecks"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "id,timeoutMs,url") return null;
    if (typeof record.id !== "string" || !safeId.test(record.id) || !Number.isInteger(record.timeoutMs) || Number(record.timeoutMs) < 100 || Number(record.timeoutMs) > 30_000 || typeof record.url !== "string") return null;
    try {
      const url = new URL(record.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    } catch { return null; }
    parsed.push({ id: record.id, url: record.url, timeoutMs: Number(record.timeoutMs) });
  }
  return new Set(parsed.map((item) => item.id)).size === parsed.length ? parsed : null;
}

export function parseDeploymentTargetProfile(text: string, scope: DeploymentTargetScope): DeploymentTargetParseResult {
  if (scope.protectedEnvironment || scope.environmentKind === "production") return { ok: false, error: "Production and protected deployment targets are unavailable." };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, error: "Target profile must be valid JSON." }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Target profile must be a JSON object." };
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (requiredKeys.some((key) => !keys.includes(key)) || keys.some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key))) return { ok: false, error: "Target profile contains missing or unsupported fields." };
  if (record.projectId !== scope.projectId || record.environmentId !== scope.environmentId) return { ok: false, error: "Target profile scope does not match the selected project and environment." };
  if (![record.projectId, record.environmentId, record.serverId].every((item) => typeof item === "string" && objectId.test(item))) return { ok: false, error: "Target profile identifiers are invalid." };
  if (!absolutePath(record.repositoryRoot) || !absolutePath(record.environmentFilePath) || !absolutePath(record.composePath)) return { ok: false, error: "Repository, environment, and Compose paths must be absolute safe paths." };
  const overrides = record.composeOverridePaths === undefined ? [] : record.composeOverridePaths;
  if (!Array.isArray(overrides) || overrides.length > 8 || !overrides.every(absolutePath)) return { ok: false, error: "Compose overrides must contain at most eight absolute safe paths." };
  const composePaths = [record.composePath, ...overrides];
  if (new Set(composePaths).size !== composePaths.length || ![record.environmentFilePath, ...composePaths].every((candidate) => contained(record.repositoryRoot as string, candidate))) return { ok: false, error: "Every unique target path must stay inside the repository root." };
  if (typeof record.composeProject !== "string" || !safeId.test(record.composeProject)) return { ok: false, error: "Compose project is invalid." };
  if (!stringList(record.statelessServices, 1, 30) || !stringList(record.protectedServices, 0, 30) || record.statelessServices.some((service) => (record.protectedServices as string[]).includes(service))) return { ok: false, error: "Service allowlists are invalid or overlap." };
  const healthChecks = parseHealthChecks(record.healthChecks);
  if (!healthChecks) return { ok: false, error: "Health checks are invalid or unsafe." };
  if (record.currentConfigurationDigest !== undefined && (typeof record.currentConfigurationDigest !== "string" || !digest.test(record.currentConfigurationDigest))) return { ok: false, error: "Current configuration digest must be a SHA-256 value." };
  return { ok: true, profile: { projectId: record.projectId as string, environmentId: record.environmentId as string, serverId: record.serverId as string, repositoryRoot: record.repositoryRoot as string, environmentFilePath: record.environmentFilePath as string, composePath: record.composePath as string, composeOverridePaths: overrides as string[], composeProject: record.composeProject, statelessServices: record.statelessServices, protectedServices: record.protectedServices, healthChecks, ...(record.currentConfigurationDigest ? { currentConfigurationDigest: record.currentConfigurationDigest as string } : {}) } };
}
