import assert from "node:assert/strict";
import test from "node:test";
import { validateHttpTaskTargets } from "../src/taskRoutes.js";

test("ad-hoc HTTP tasks reject direct private and metadata targets", async () => {
  for (const url of [
    "http://127.0.0.1/health",
    "http://169.254.169.254/latest/meta-data",
    "http://192.0.2.1/health",
    "http://[::1]/health",
    "http://[2001:db8::1]/health"
  ]) await assert.rejects(() => validateHttpTaskTargets([{ url }]), url);
  await assert.doesNotReject(() => validateHttpTaskTargets([{ url: "https://1.1.1.1/health" }]));
});
