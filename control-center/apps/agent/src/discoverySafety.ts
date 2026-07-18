import fs from "node:fs";
import path from "node:path";

export const DISCOVERY_LIMITS = { paths: 1024, name: 256, branch: 255, commit: 64, remote: 2048, repositories: 100, composeProjects: 100, applications: 250, warnings: 100, directories: 2000, payloadBytes: 768 * 1024 } as const;
export type DiscoveryWarning = "mount_boundary_skipped" | "symlink_skipped" | "unreadable_path" | "path_disappeared" | "discovery_truncated";

export function sanitizeGitRemote(value: string): string | null {
  const raw = value.trim(); if (!raw || raw.length > 8192 || /[\r\n\0]/.test(raw)) return null;
  if (/^git@[a-z0-9.-]+:[a-z0-9._/-]+(?:\.git)?$/i.test(raw)) return raw.slice(0, DISCOVERY_LIMITS.remote);
  try {
    const parsed = new URL(raw); if (!["http:", "https:", "ssh:", "git:"].includes(parsed.protocol)) return null;
    parsed.search = ""; parsed.hash = "";
    if (parsed.protocol === "http:" || parsed.protocol === "https:") { parsed.username = ""; parsed.password = ""; }
    else if (parsed.username && parsed.username !== "git") parsed.username = "git";
    return parsed.toString().slice(0, DISCOVERY_LIMITS.remote);
  } catch { return null; }
}

function contained(root: string, candidate: string) { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
export function traversalDecision(root: string, candidate: string, rootDev: number, candidateDev: number, isSymlink: boolean, isMountPoint = false): "allow" | "symlink_skipped" | "mount_boundary_skipped" {
  if (isSymlink || !contained(root, candidate)) return "symlink_skipped";
  return rootDev === candidateDev && !isMountPoint ? "allow" : "mount_boundary_skipped";
}

export function linuxMountPoints(mountInfo = process.platform === "linux" ? fs.readFileSync("/proc/self/mountinfo", "utf8") : "") {
  const decode = (value: string) => value.replace(/\\040/g, " ").replace(/\\011/g, "\t").replace(/\\012/g, "\n").replace(/\\134/g, "\\");
  return new Set(mountInfo.split(/\r?\n/).filter(Boolean).map((line) => line.split(" - ")[0]?.split(" ")[4]).filter((value): value is string => Boolean(value)).map(decode));
}

export function walkSameDevice(rootInput: string) {
  const directories: string[] = []; const warningSet = new Set<DiscoveryWarning>(); const mountPoints = linuxMountPoints();
  let root: string; let rootDev: number;
  try { root = fs.realpathSync(rootInput); rootDev = fs.statSync(root).dev; } catch { return { directories, warnings: ["unreadable_path" as const] }; }
  const visit = (directory: string, depth: number) => {
    if (depth > 4 || directories.length >= DISCOVERY_LIMITS.directories) { warningSet.add("discovery_truncated"); return; }
    let entries: fs.Dirent[]; try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { warningSet.add("unreadable_path"); return; }
    for (const entry of entries) {
      if (directories.length >= DISCOVERY_LIMITS.directories) { warningSet.add("discovery_truncated"); break; }
      if (!["node_modules", ".venv", "venv", "vendor"].includes(entry.name) && (entry.isDirectory() || entry.isSymbolicLink())) {
        const candidate = path.join(directory, entry.name);
        try {
          const link = fs.lstatSync(candidate); const real = link.isSymbolicLink() ? candidate : fs.realpathSync(candidate); const decision = traversalDecision(root, real, rootDev, link.isSymbolicLink() ? rootDev : fs.statSync(real).dev, link.isSymbolicLink(), mountPoints.has(real)); if (decision !== "allow") { warningSet.add(decision); continue; }
          directories.push(real); visit(real, depth + 1);
        } catch (error) { warningSet.add((error as NodeJS.ErrnoException).code === "ENOENT" ? "path_disappeared" : "unreadable_path"); }
      }
    }
  };
  directories.push(root); visit(root, 0); return { directories, warnings: [...warningSet].slice(0, DISCOVERY_LIMITS.warnings) };
}

export function capDiscovery<T extends { repositories: unknown[]; composeProjects: unknown[]; applications: unknown[]; warnings: string[] }>(value: T): T & { discoveryTruncated: boolean; truncationCategories: string[] } {
  const categories: string[] = []; const cap = (key: keyof T, limit: number) => { const rows = value[key] as unknown[]; if (rows.length > limit) categories.push(String(key)); return rows.slice(0, limit); };
  const result: any = { ...value, repositories: cap("repositories", DISCOVERY_LIMITS.repositories), composeProjects: cap("composeProjects", DISCOVERY_LIMITS.composeProjects), applications: cap("applications", DISCOVERY_LIMITS.applications), warnings: cap("warnings", DISCOVERY_LIMITS.warnings), discoveryTruncated: categories.length > 0, truncationCategories: categories };
  while (Buffer.byteLength(JSON.stringify(result)) > DISCOVERY_LIMITS.payloadBytes && (result.warnings.length || result.applications.length || result.repositories.length || result.composeProjects.length)) {
    const key = result.warnings.length ? "warnings" : result.applications.length ? "applications" : result.repositories.length ? "repositories" : "composeProjects"; result[key].pop(); if (!categories.includes(key)) categories.push(key); result.discoveryTruncated = true; result.truncationCategories = categories;
  }
  return result;
}
