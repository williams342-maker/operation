import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserErrorTracker } from "./e2e-browser-errors.mjs";

const resourceError = (status, label) => `Failed to load resource: the server responded with a status of ${status} (${label})`;
const expected = (status, count = 1) => [{ phase: "negative test", method: "GET", path: "/api/protected", status, count }];
const observe = (tracker, status, path = "/api/protected") => {
  tracker.setPhase("negative test");
  tracker.response({ method: "GET", url: `http://127.0.0.1:5173${path}`, status });
  tracker.console({ type: "error", text: resourceError(status, status === 401 ? "Unauthorized" : "Forbidden") });
};

test("accepts exactly declared 401 and 403 responses", () => {
  for (const status of [401, 403]) {
    const tracker = createBrowserErrorTracker(expected(status));
    observe(tracker, status);
    assert.deepEqual(tracker.result(), { unmet: [], unexpectedResponses: [], unexpectedConsoleErrors: [] });
  }
});

test("rejects an expected status from an unexpected endpoint", () => {
  const tracker = createBrowserErrorTracker(expected(401));
  observe(tracker, 401, "/api/unexpected");
  assert.equal(tracker.result().unexpectedResponses.length, 1);
});

test("rejects extra authorization failures beyond the declared count", () => {
  const tracker = createBrowserErrorTracker(expected(401));
  observe(tracker, 401);
  observe(tracker, 401);
  assert.equal(tracker.result().unexpectedResponses.length, 1);
  assert.equal(tracker.result().unexpectedConsoleErrors.length, 1);
});

test("rejects JavaScript console errors and unrelated server failures", () => {
  const tracker = createBrowserErrorTracker([]);
  tracker.setPhase("normal");
  tracker.console({ type: "error", text: "Uncaught TypeError: broken" });
  tracker.response({ method: "GET", url: "http://127.0.0.1:5173/api/health", status: 500 });
  assert.equal(tracker.result().unexpectedConsoleErrors.length, 1);
  assert.equal(tracker.result().unexpectedResponses.length, 1);
});

test("enforces expected occurrence counts", () => {
  const tracker = createBrowserErrorTracker(expected(403, 2));
  observe(tracker, 403);
  assert.equal(tracker.result().unmet.length, 1);
});

test("rejects malformed expected-response declarations", () => {
  assert.throws(() => createBrowserErrorTracker([{ phase: "test", method: "GET", path: "broad", status: 401, count: 1 }]));
});
