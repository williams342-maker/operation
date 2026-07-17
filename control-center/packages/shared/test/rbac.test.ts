import test from "node:test";
import assert from "node:assert/strict";
import { hasPermission } from "../src/rbac.js";

test("role foundations enforce phase 1 permissions", () => {
  assert.equal(hasPermission("Owner", "org:manage"), true);
  assert.equal(hasPermission("Owner", "servers:enroll"), true);
  assert.equal(hasPermission("Owner", "servers:manage"), true);
  assert.equal(hasPermission("Administrator", "servers:enroll"), true);
  assert.equal(hasPermission("Developer", "projects:manage"), true);
  assert.equal(hasPermission("Developer", "servers:enroll"), false);
  assert.equal(hasPermission("Viewer", "status:view"), true);
  assert.equal(hasPermission("Viewer", "audit:view"), false);
});
