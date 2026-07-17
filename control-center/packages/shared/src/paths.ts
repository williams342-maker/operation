import fs from "node:fs";
import path from "node:path";

export function rejectPathTraversal(inputPath: string) {
  if (!inputPath || inputPath.includes("\0")) throw new Error("Invalid path");
  const normalized = path.normalize(inputPath);
  if (normalized.split(/[\\/]/).includes("..")) throw new Error("Path traversal is not allowed");
}

export function realPathInside(rootPath: string, candidatePath: string) {
  rejectPathTraversal(candidatePath);
  const rootReal = fs.realpathSync(rootPath);
  const candidateReal = fs.realpathSync(candidatePath);
  const relative = path.relative(rootReal, candidateReal);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return candidateReal;
  throw new Error("Path escapes allowed root");
}

export function validateRegisteredPath(rootPath: string, candidatePath: string) {
  return realPathInside(rootPath, path.resolve(candidatePath));
}

export function validateConfiguredPath(allowlistedRoots: string[], candidatePath: string) {
  if (!candidatePath.startsWith("/") || candidatePath.includes("\\")) throw new Error("Managed-server paths must be absolute POSIX paths");
  rejectPathTraversal(candidatePath);
  const resolved = path.posix.resolve(candidatePath);
  for (const root of allowlistedRoots) {
    if (!root.startsWith("/") || root.includes("\\")) continue;
    const rootResolved = path.posix.resolve(root);
    const relative = path.posix.relative(rootResolved, resolved);
    if (relative === "" || (!relative.startsWith("..") && !path.posix.isAbsolute(relative))) return resolved;
  }
  throw new Error("Path escapes allowlisted roots");
}

export function isSafeHttpCheckUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  if (["localhost", "metadata.google.internal"].includes(host)) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
  if (host === "::1" || host.startsWith("[::1") || host.startsWith("fc") || host.startsWith("fd")) return false;
  return true;
}
