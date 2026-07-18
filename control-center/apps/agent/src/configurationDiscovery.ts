import fs from "node:fs";
import path from "node:path";
import { classifySecret, classifySettingType, recognizeProvider, type DiscoveredSetting } from "@control-center/shared";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_SETTINGS = 1000;
const namePattern = /^[A-Z_][A-Z0-9_]{0,127}$/;
const sourceFiles = [".env.example", ".env.template", ".env.sample", "compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml", "Dockerfile"];

function readSafe(file: string) {
  try { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) return ""; return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function namesFrom(content: string, kind: string) {
  const names = new Set<string>();
  const patterns = kind === "env" ? [/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/gm] : kind === "dockerfile" ? [/^\s*(?:ARG|ENV)\s+([A-Z_][A-Z0-9_]*)/gm, /\$\{([A-Z_][A-Z0-9_]*)/g] : [/\$\{([A-Z_][A-Z0-9_]*)/g, /process\.env\.([A-Z_][A-Z0-9_]*)/g, /(?:os\.getenv|getenv|env_get)\(["']([A-Z_][A-Z0-9_]*)["']/g, /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g];
  for (const pattern of patterns) for (const match of content.matchAll(pattern)) if (match[1] && namePattern.test(match[1])) names.add(match[1]);
  return [...names];
}

function merge(map: Map<string, DiscoveredSetting>, appPath: string, name: string, source: DiscoveredSetting["sources"][number], sourcePath: string, configured?: boolean) {
  if (!namePattern.test(name)) return; const key = `${appPath}\0${name}`; const existing = map.get(key); const secret = classifySecret(name);
  if (existing) { if (!existing.sources.includes(source)) existing.sources.push(source); if (!existing.sourcePaths.includes(sourcePath)) existing.sourcePaths.push(sourcePath); if (configured !== undefined) existing.configured = configured; return; }
  map.set(key, { name, applicationPath: appPath, sources: [source], sourcePaths: [sourcePath], services: [], required: source === "env-example", secret, type: classifySettingType(name, secret), provider: recognizeProvider(name), usage: source === "dockerfile" || name.startsWith("VITE_") || name.startsWith("REACT_APP_") ? "build" : "runtime", configured, authoritativePath: configured !== undefined ? sourcePath : undefined });
}

export function discoverConfiguration(applications: Array<{ path: string }>) {
  const map = new Map<string, DiscoveredSetting>();
  for (const application of applications) {
    const appPath = application.path;
    for (const candidate of sourceFiles) {
      const file = path.join(appPath, candidate); const content = readSafe(file); if (!content) continue;
      const source = candidate.startsWith(".env") ? "env-example" : candidate === "Dockerfile" ? "dockerfile" : "compose";
      for (const name of namesFrom(content, source === "env-example" ? "env" : source === "dockerfile" ? "dockerfile" : "source")) merge(map, appPath, name, source, file);
    }
    const workflowsDirectory = path.join(appPath, ".github", "workflows");
    let workflows: string[] = []; try { workflows = fs.readdirSync(workflowsDirectory).filter((file) => /\.ya?ml$/i.test(file)).slice(0, 30); } catch { /* optional directory */ }
    for (const workflow of workflows) { const file = path.join(workflowsDirectory, workflow); for (const name of namesFrom(readSafe(file), "source")) merge(map, appPath, name, "workflow", file); }
    for (const envName of [".env", ".env.local"]) {
      const file = path.join(appPath, envName); const content = readSafe(file); if (!content) continue;
      for (const name of namesFrom(content, "env")) merge(map, appPath, name, "runtime-name", file, true);
    }
    let files: string[] = []; try { files = fs.readdirSync(appPath).filter((file) => /\.(?:ts|tsx|js|jsx|py|cs)$/.test(file)).slice(0, 60); } catch { /* bounded discovery */ }
    for (const name of files) { const file = path.join(appPath, name); for (const variable of namesFrom(readSafe(file), "source")) merge(map, appPath, variable, "source", file); }
  }
  const settings = [...map.values()].slice(0, MAX_SETTINGS); return { settings, truncated: map.size > settings.length };
}
