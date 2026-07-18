import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capDiscovery, linuxMountPoints, sanitizeGitRemote, traversalDecision, walkSameDevice } from "../src/discoverySafety.js";

test("Git remotes are sanitized before telemetry", () => {
  assert.equal(sanitizeGitRemote("https://username:secret@example.com/org/repo.git?token=bad#secret"), "https://example.com/org/repo.git");
  assert.equal(sanitizeGitRemote("https://token@example.com/org/repo.git"), "https://example.com/org/repo.git");
  assert.equal(sanitizeGitRemote("git@example.com:org/repo.git"), "git@example.com:org/repo.git");
  assert.equal(sanitizeGitRemote("ssh://git@example.com/org/repo.git"), "ssh://git@example.com/org/repo.git");
  assert.equal(sanitizeGitRemote("not a remote with secret"), null);
});

test("mount and symlink boundaries are rejected", () => {
  const root = path.resolve("/allowed"); assert.equal(traversalDecision(root, path.join(root, "app"), 1, 1, false), "allow"); assert.equal(traversalDecision(root, path.join(root, "mount"), 1, 2, false), "mount_boundary_skipped"); assert.equal(traversalDecision(root, path.join(root, "bind"), 1, 1, false, true), "mount_boundary_skipped"); assert.equal(traversalDecision(root, path.resolve("/outside"), 1, 1, false), "symlink_skipped"); assert.equal(traversalDecision(root, path.join(root, "link"), 1, 1, true), "symlink_skipped");
});

test("Linux mountinfo parser identifies escaped mountpoints", () => { const points = linuxMountPoints("25 1 0:1 / /allowed/bind\\040mount rw - ext4 /dev/x rw\n"); assert.ok(points.has("/allowed/bind mount")); });

test("real traversal skips symlinks and stays bounded", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ops-discovery-")); fs.mkdirSync(path.join(root, "child"));
  try { fs.symlinkSync(os.tmpdir(), path.join(root, "outside-link"), "dir"); } catch { /* symlinks may require Windows privilege */ }
  const result = walkSameDevice(root); assert.ok(result.directories.includes(fs.realpathSync(root))); if (fs.existsSync(path.join(root, "outside-link"))) assert.ok(result.warnings.includes("symlink_skipped"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("discovery arrays and payload are capped", () => {
  const item = { path: "/srv/app", branch: "main" }; const result = capDiscovery({ repositories: Array.from({ length: 150 }, () => item), composeProjects: [], applications: [], warnings: [] }); assert.equal(result.repositories.length, 100); assert.equal(result.discoveryTruncated, true); assert.ok(result.truncationCategories.includes("repositories"));
});
