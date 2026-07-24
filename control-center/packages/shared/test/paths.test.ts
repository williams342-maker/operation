import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { isPublicIpAddress, isSafeHttpCheckUrl, validateConfiguredPath, validateRegisteredPath } from "../src/paths.js";

test("path validation allows paths inside allowed root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-root-"));
  const inside = path.join(root, "project");
  fs.mkdirSync(inside);
  assert.equal(validateRegisteredPath(root, inside), fs.realpathSync(inside));
});

test("path validation prevents traversal outside allowed root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-root-"));
  assert.throws(() => validateRegisteredPath(root, path.join(root, "..")));
});

test("path validation rejects sibling prefix tricks", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "cc-parent-"));
  const root = path.join(parent, "app");
  const sibling = path.join(parent, "app-evasion");
  fs.mkdirSync(root);
  fs.mkdirSync(sibling);
  assert.throws(() => validateRegisteredPath(root, sibling));
});

test("path validation handles nonexistent paths safely", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-root-"));
  assert.throws(() => validateRegisteredPath(root, path.join(root, "missing")));
});

test("path validation rejects symlink escapes when supported", { skip: process.platform === "win32" }, () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "cc-parent-"));
  const root = path.join(parent, "root");
  const outside = path.join(parent, "outside");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  const link = path.join(root, "link");
  fs.symlinkSync(outside, link, "dir");
  assert.throws(() => validateRegisteredPath(root, link));
});

test("configured path validation allows paths under an allowlisted root", () => {
  assert.equal(validateConfiguredPath(["/srv/apps"], "/srv/apps/demo/compose.yml"), "/srv/apps/demo/compose.yml");
});

test("configured path validation rejects traversal and sibling-prefix tricks", () => {
  assert.throws(() => validateConfiguredPath(["/srv/apps"], "/srv/apps/../secret"));
  assert.throws(() => validateConfiguredPath(["/srv/apps"], "/srv/appsevil/demo"));
});

test("http health URL validation blocks SSRF-sensitive targets", () => {
  assert.equal(isSafeHttpCheckUrl("https://example.com/health"), true);
  assert.equal(isSafeHttpCheckUrl("ftp://example.com/health"), false);
  assert.equal(isSafeHttpCheckUrl("http://127.0.0.1/health"), false);
  assert.equal(isSafeHttpCheckUrl("http://169.254.169.254/latest/meta-data"), false);
  assert.equal(isSafeHttpCheckUrl("http://10.0.0.4/health"), false);
  assert.equal(isSafeHttpCheckUrl("http://localhost/health"), false);
});

test("public address validation rejects private, metadata, benchmark, and documentation ranges", () => {
  for (const address of [
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "192.0.0.1", "192.0.2.1", "192.168.0.1", "198.18.0.1",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "::", "::1", "::ffff:127.0.0.1",
    "fc00::1", "fe80::1", "ff02::1", "100::1", "2001:db8::1"
  ]) assert.equal(isPublicIpAddress(address), false, address);
  assert.equal(isPublicIpAddress("1.1.1.1"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});
