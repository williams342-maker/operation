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
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return candidateReal;
  }
  throw new Error("Path escapes allowed root");
}

export function validateRegisteredPath(rootPath: string, candidatePath: string) {
  const resolved = path.resolve(candidatePath);
  return realPathInside(rootPath, resolved);
}
