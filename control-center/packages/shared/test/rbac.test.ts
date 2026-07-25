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

test("AI administration is limited to owner and administrator", () => { assert.equal(hasPermission("Owner", "ai:admin"), true); assert.equal(hasPermission("Administrator", "ai:admin"), true); assert.equal(hasPermission("Developer", "ai:admin"), false); assert.equal(hasPermission("Viewer", "ai:admin"), false); });
test("AI use does not grant resource management", () => { assert.equal(hasPermission("Viewer", "ai:use"), true); assert.equal(hasPermission("Viewer", "servers:manage"), false); });
test("agent updates are limited to owners and administrators", () => { assert.equal(hasPermission("Owner", "agent:update"), true); assert.equal(hasPermission("Administrator", "agent:update"), true); assert.equal(hasPermission("Developer", "agent:update"), false); assert.equal(hasPermission("Viewer", "agent:update"), false); });
test("marketing permissions separate administration, import, and read-only analysis", () => {
  assert.equal(hasPermission("Owner", "marketing:manage-settings"), true);
  assert.equal(hasPermission("Administrator", "marketing:connect-accounts"), true);
  assert.equal(hasPermission("Developer", "marketing:import"), true);
  assert.equal(hasPermission("Viewer", "marketing:view"), true);
  assert.equal(hasPermission("Viewer", "marketing:import"), false);
  assert.equal(hasPermission("Viewer", "marketing:manage-settings"), false);
});
