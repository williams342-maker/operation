import assert from "node:assert/strict";
import test from "node:test";
import { transitionProjectDeployment, transitionProjectRollback } from "../src/projectHistory.js";

test("project deployment lifecycle is ordered and idempotent", () => {
  assert.equal(transitionProjectDeployment("planned", "planned"), "planned");
  assert.equal(transitionProjectDeployment("planned", "approved"), "approved");
  assert.equal(transitionProjectDeployment("validating", "succeeded"), "succeeded");
  assert.equal(transitionProjectDeployment("succeeded", "rolled_back"), "rolled_back");
  assert.throws(() => transitionProjectDeployment("planned", "succeeded"), /Invalid lifecycle transition/);
  assert.throws(() => transitionProjectDeployment("rolled_back", "validating"), /Invalid lifecycle transition/);
});

test("project rollback lifecycle is ordered and terminal", () => {
  assert.equal(transitionProjectRollback("planned", "preparing"), "preparing");
  assert.equal(transitionProjectRollback("restoring", "validating"), "validating");
  assert.equal(transitionProjectRollback("validating", "failed"), "failed");
  assert.throws(() => transitionProjectRollback("failed", "restoring"), /Invalid lifecycle transition/);
});
