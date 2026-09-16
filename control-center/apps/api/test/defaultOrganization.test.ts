import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { isolatedTestMongoUrl } from "../src/testDbGuard.js";

const enabled = process.env.CONTROL_CENTER_RUN_DB_TESTS === "true" && Boolean(process.env.MONGO_URL_TEST);
test("explicit default preserves login without granting access to a different tenant", { skip: !enabled }, async t => {
  const isolated = isolatedTestMongoUrl();
  process.env.NODE_ENV = "test";
  process.env.MONGO_URL = isolated.url;
  process.env.CONTROL_CENTER_DB = isolated.dbName;
  const previous = process.env.CONTROL_CENTER_DEFAULT_ORGANIZATION_SLUG;
  const { collections, db, client, connectDb } = await import("../src/db.js");
  const { hashPassword } = await import("../src/crypto.js");
  const { app } = await import("../src/server.js");
  await connectDb();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(async () => {
    if (previous === undefined) delete process.env.CONTROL_CENTER_DEFAULT_ORGANIZATION_SLUG; else process.env.CONTROL_CENTER_DEFAULT_ORGANIZATION_SLUG = previous;
    await new Promise<void>(resolve => server.close(() => resolve())); await db.dropDatabase(); await client.close();
  });
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const now = new Date();
  for (const slug of ["original", "second"]) {
    const orgId = new ObjectId();
    await collections.organizations.insertOne({ _id: orgId, name: slug, slug, createdAt: now, updatedAt: now });
    await collections.users.insertOne({ orgId, name: slug, email: `${slug}@example.invalid`, role: "Viewer", passwordHash: hashPassword("disposable-test-password-only"), createdAt: now, updatedAt: now });
  }
  async function login(email: string, organizationSlug?: string) {
    const r = await fetch(origin + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, organizationSlug, password: "disposable-test-password-only" }) });
    return { status: r.status, body: await r.json() as any };
  }
  delete process.env.CONTROL_CENTER_DEFAULT_ORGANIZATION_SLUG;
  assert.equal((await login("original@example.invalid")).status, 401);
  process.env.CONTROL_CENTER_DEFAULT_ORGANIZATION_SLUG = "original";
  const original = await login("original@example.invalid");
  assert.equal(original.status, 200); assert.equal(original.body.organization.slug, "original");
  assert.equal((await login("second@example.invalid")).status, 401);
  const second = await login("second@example.invalid", "second");
  assert.equal(second.status, 200); assert.equal(second.body.organization.slug, "second");
  assert.equal((await login("original@example.invalid", "second")).status, 401);
  process.env.CONTROL_CENTER_DEFAULT_ORGANIZATION_SLUG = "missing";
  assert.equal((await login("original@example.invalid")).status, 401);
});
