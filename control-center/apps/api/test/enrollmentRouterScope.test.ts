import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { ObjectId } from "mongodb";
import { adminEnrollmentRouter } from "../src/adminEnrollmentRoutes.js";
import { requirePermission } from "../src/auth.js";
import { collections } from "../src/db.js";

test("enrollment permission stays scoped while downstream permissions still apply", async t => {
  t.mock.method(collections.auditEvents, "insertOne", async () => ({ acknowledged: true, insertedId: new ObjectId() }));
  const app = express();
  app.use((req, _res, next) => { req.user = { _id: new ObjectId(), role: req.header("x-test-role") || "Viewer" } as any; next(); });
  app.use(adminEnrollmentRouter);
  app.post("/website-builder/workflows/from-prompt", requirePermission("ai:use"), (_req, res) => res.sendStatus(204));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const role of ["Viewer", "Developer", "Administrator", "Owner"]) {
    assert.equal((await fetch(origin + "/website-builder/workflows/from-prompt", { method: "POST", headers: { "x-test-role": role } })).status, 204, role);
  }
  assert.equal((await fetch(origin + "/website-builder/workflows/from-prompt", { method: "POST", headers: { "x-test-role": "unknown" } })).status, 403);
  for (const path of ["/admin/enrollment", "/admin/enrollment/download/000000000000000000000000", "/admin/integrations/cloudflare-access"]) {
    assert.equal((await fetch(origin + path)).status, 403, path);
  }
  assert.equal((await fetch(origin + "/admin/enrollment/generate", { method: "POST" })).status, 403);
});
