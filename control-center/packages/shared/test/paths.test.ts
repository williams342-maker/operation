import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { validateRegisteredPath } from "../src/paths.js";

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
