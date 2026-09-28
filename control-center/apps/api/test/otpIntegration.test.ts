import test from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { isolatedTestMongoUrl } from "../src/testDbGuard.js";

const enabled = process.env.CONTROL_CENTER_RUN_DB_TESTS === "true" && Boolean(process.env.MONGO_URL_TEST);
test("OTP enforcement across authentication, authorization, and credential races", { skip: !enabled, timeout: 120_000 }, async t => {
  process.env.NODE_ENV = "test";
  process.env.CONTROL_CENTER_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.CONTROL_CENTER_OTP_TTL_HOURS = "72";
  const isolated = isolatedTestMongoUrl();
  process.env.MONGO_URL = isolated.url;
  process.env.CONTROL_CENTER_DB = isolated.dbName;
  const { app } = await import("../src/server.js");
  const { collections, connectDb, client } = await import("../src/db.js");
  const { hashPassword, hashSecret, verifyPassword } = await import("../src/crypto.js");
  await connectDb();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const realFetch = globalThis.fetch;
  type Session = { cookie: string; csrf: string };
  async function request(path: string, method = "GET", body?: unknown, session?: Session) {
    const response = await realFetch(base + path, { method, headers: { "content-type": "application/json", ...(session ? { cookie: session.cookie, "x-csrf-token": session.csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : {}) as any, headers: response.headers };
  }
  const sessionOf = (r: Awaited<ReturnType<typeof request>>): Session => ({ cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: r.body.csrfToken });
  const now = new Date();
  const orgId = (await collections.organizations.insertOne({ name: "OTP tests", slug: "otp", createdAt: now, updatedAt: now })).insertedId;
  const ownerId = (await collections.users.insertOne({ orgId, name: "Owner", email: "owner@otp.test", role: "Owner", passwordHash: hashPassword("owner-password-long"), createdAt: now, updatedAt: now })).insertedId;
  const login = (email: string, password: unknown) => request("/auth/login", "POST", { organizationSlug: "otp", email, password });
  const owner = sessionOf(await login("owner@otp.test", "owner-password-long"));
  let counter = 0;
  async function invite(role = "Viewer") {
    const email = `invited${++counter}@otp.test`;
    const response = await request("/org/users", "POST", { email, name: "Invited", role }, owner);
    assert.equal(response.status, 201);
    return { email, id: new ObjectId(response.body.id), otp: response.body.oneTimePassword as string };
  }
  const change = (session: Session, currentPassword: string, newPassword = "chosen-password-long") => request("/auth/change-password", "POST", { currentPassword, newPassword }, session);
  try {
    await t.test("every role is gated on direct and alternate endpoints until a different password is chosen", async () => {
      for (const role of ["Owner", "Administrator", "Developer", "Viewer"]) {
        const u = await invite(role);
        const result = await login(u.email, u.otp);
        assert.equal(result.status, 200);
        assert.equal(result.body.mustChangePassword, true);
        const session = sessionOf(result);
        const other = sessionOf(await login(u.email, u.otp));
        const me = await request("/me", "GET", undefined, session);
        assert.equal(me.status, 200); assert.equal(me.body.mustChangePassword, true);
        for (const [path, method] of [["/servers", "GET"], ["/system/health", "GET"], ["/org/users", "GET"], ["/auth/reauthenticate", "POST"], ["/auth/change-password/nested", "POST"], ["/me/nested", "GET"]]) {
          const denied = await request(path, method, method === "POST" ? { password: u.otp } : undefined, session);
          assert.equal(denied.status, 403, `${role} ${path}`); assert.equal(denied.body.code, "PASSWORD_CHANGE_REQUIRED");
        }
        if (role === "Owner") {
          assert.equal((await request("/servers", "HEAD", undefined, session)).status, 403);
          assert.equal((await change({ ...session, csrf: "" }, u.otp)).status, 403);
          assert.equal((await change({ ...session, csrf: "wrong" }, u.otp)).status, 403);
          assert.equal((await collections.users.findOne({ _id: u.id }))?.mustChangePassword, true);
        }
        assert.equal((await change(session, u.otp, u.otp)).status, 400);
        assert.equal((await change(session, u.otp, "short")).status, 400);
        assert.equal((await change(session, u.otp)).status, 200);
        const doc = await collections.users.findOne({ _id: u.id });
        assert.equal(doc?.mustChangePassword, undefined); assert.equal(doc?.inviteIssuedAt, undefined);
        assert.equal((await request("/servers", "GET", undefined, session)).status, 200);
        assert.equal((await request("/me", "GET", undefined, session)).body.mustChangePassword, false);
        assert.equal((await request("/me", "GET", undefined, other)).status, 401);
        assert.equal((await login(u.email, u.otp)).status, 401);
        assert.equal((await login(u.email, "chosen-password-long")).status, 200);
      }
    });
    await t.test("wrong, missing, malformed and expired OTPs never create sessions or reveal expiry before verification", async () => {
      const u = await invite();
      for (const password of ["wrong-password", undefined, {}, 42]) {
        const result = await login(u.email, password);
        assert.equal(result.status, typeof password === "string" ? 401 : 400);
      }
      for (const timestamp of [new Date(Date.now() - 73 * 3_600_000), undefined, "invalid", new Date(Date.now() + 60_000)]) {
        await collections.users.updateOne({ _id: u.id }, timestamp === undefined ? { $unset: { inviteIssuedAt: "" } } : { $set: { inviteIssuedAt: timestamp as Date } });
        const result = await login(u.email, u.otp);
        assert.equal(result.status, 403); assert.equal(result.body.code, "PASSWORD_EXPIRED");
        assert.equal(result.headers.get("set-cookie"), null);
        await collections.loginThrottle.deleteMany({});
      }
      assert.equal((await login(u.email, "wrong-password")).status, 401);
      assert.equal(await collections.sessions.countDocuments({ userId: u.id }), 0);
    });
    await t.test("existing flagged sessions are live-gated, expired changes denied, and logout remains usable", async () => {
      const u = await invite();
      const session = sessionOf(await login(u.email, u.otp));
      await collections.users.updateOne({ _id: u.id }, { $set: { inviteIssuedAt: new Date(0) } });
      assert.equal((await change(session, u.otp)).body.code, "PASSWORD_EXPIRED");
      assert.equal((await request("/auth/logout", "POST", {}, session)).status, 200);
      const ownerDoc = await collections.users.findOne({ _id: ownerId });
      assert.ok(ownerDoc);
      await collections.users.updateOne({ _id: ownerId }, { $set: { mustChangePassword: true, inviteIssuedAt: new Date() } });
      assert.equal((await request("/servers", "GET", undefined, owner)).body.code, "PASSWORD_CHANGE_REQUIRED");
      await collections.users.updateOne({ _id: ownerId }, { $unset: { mustChangePassword: "", inviteIssuedAt: "" } });
      assert.equal((await request("/servers", "GET", undefined, owner)).status, 200);
    });
    await t.test("admin reset revokes old sessions and reflags next login; Viewer still cannot manage users after change", async () => {
      const u = await invite(); const session = sessionOf(await login(u.email, u.otp));
      assert.equal((await change(session, u.otp)).status, 200);
      assert.equal((await request("/org/users", "GET", undefined, session)).status, 403);
      const reset = await request(`/org/users/${u.id}/reset-password`, "POST", {}, owner);
      assert.equal(reset.status, 200);
      assert.equal((await request("/me", "GET", undefined, session)).status, 401);
      assert.equal((await login(u.email, "chosen-password-long")).status, 401);
      assert.equal((await login(u.email, reset.body.oneTimePassword)).body.mustChangePassword, true);
    });
    await t.test("session inserted after a reset from a stale credential snapshot remains revoked, including recovery routes", async () => {
      const u = await invite();
      const original = collections.sessions.insertOne.bind(collections.sessions);
      let resetPassword = "";
      collections.sessions.insertOne = (async (doc: any, options?: any) => {
        if (String(doc.userId) === String(u.id)) {
          const reset = await request(`/org/users/${u.id}/reset-password`, "POST", {}, owner);
          assert.equal(reset.status, 200); resetPassword = reset.body.oneTimePassword;
        }
        return original(doc, options);
      }) as typeof collections.sessions.insertOne;
      let result;
      try { result = await login(u.email, u.otp); } finally { collections.sessions.insertOne = original; }
      assert.equal(result.status, 200);
      const session = sessionOf(result);
      const current = sessionOf(await login(u.email, resetPassword));
      assert.equal((await change(current, resetPassword)).status, 200);
      assert.equal((await request("/me", "GET", undefined, session)).status, 401);
      assert.equal((await change(session, u.otp)).status, 401);
      assert.equal((await request("/servers", "GET", undefined, session)).status, 401);
    });
    await t.test("concurrent changes consume an OTP once and retain only the winning session", async () => {
      const u = await invite(); const a = sessionOf(await login(u.email, u.otp)); const b = sessionOf(await login(u.email, u.otp));
      const original = collections.users.updateOne.bind(collections.users);
      let arrived = 0; let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
      collections.users.updateOne = (async (filter: any, update: any, options?: any) => {
        if (String(filter._id) === String(u.id) && update.$unset?.mustChangePassword !== undefined) { if (++arrived === 2) release(); await barrier; }
        return original(filter, update, options);
      }) as typeof collections.users.updateOne;
      let results;
      try { results = await Promise.all([change(a, u.otp, "winner-a-password"), change(b, u.otp, "winner-b-password")]); }
      finally { collections.users.updateOne = original; }
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      const winner = results[0].status === 200 ? a : b;
      assert.equal((await request("/servers", "GET", undefined, winner)).status, 200);
      assert.equal(await collections.sessions.countDocuments({ userId: u.id }), 1);
    });
    await t.test("reset, disable and revoke between verification and change CAS cannot be overwritten", async () => {
      for (const transition of ["reset", "disable", "revoke"]) {
        const u = await invite(); const session = sessionOf(await login(u.email, u.otp));
        const original = collections.users.updateOne.bind(collections.users);
        collections.users.updateOne = (async (filter: any, update: any, options?: any) => {
          if (String(filter._id) === String(u.id) && update.$unset?.mustChangePassword !== undefined) {
            await original({ _id: u.id }, { $inc: { authVersion: 1 }, ...(transition === "reset" ? { $set: { passwordHash: hashPassword("reset-race-password"), inviteIssuedAt: new Date(), mustChangePassword: true } } : transition === "disable" ? { $set: { disabledAt: new Date() } } : {}) });
          }
          return original(filter, update, options);
        }) as typeof collections.users.updateOne;
        try { assert.equal((await change(session, u.otp)).status, 409); } finally { collections.users.updateOne = original; }
        const doc = await collections.users.findOne({ _id: u.id }); assert.ok(doc);
        assert.equal(doc.mustChangePassword, true); assert.equal(verifyPassword("chosen-password-long", doc.passwordHash), false);
        assert.equal((await request("/me", "GET", undefined, session)).status, 401);
      }
    });
    await t.test("Google authentication receives the same gate and cannot redeem an expired OTP", async () => {
      const u = await invite();
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const jwk = publicKey.export({ format: "jwk" });
      process.env.GOOGLE_OAUTH_CLIENT_ID = "otp-test.apps.googleusercontent.com";
      const { __resetJwksCacheForTests, verifyGoogleIdToken } = await import("../src/googleAuth.js"); __resetJwksCacheForTests();
      const nonce = "otp-google-nonce";
      const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "otp" })).toString("base64url");
      const p = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: process.env.GOOGLE_OAUTH_CLIENT_ID, sub: "otp-user", email: u.email, email_verified: true, nonce, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })).toString("base64url");
      const signer = createSign("RSA-SHA256"); signer.update(`${h}.${p}`); signer.end();
      const credential = `${h}.${p}.${signer.sign(privateKey).toString("base64url")}`;
      await verifyGoogleIdToken(credential, { clientId: process.env.GOOGLE_OAUTH_CLIENT_ID, nonce, fetchJwks: async () => ({ keys: [{ ...jwk, n: jwk.n!, e: jwk.e!, kty: "RSA", kid: "otp", alg: "RS256" }] }) });
      const response = await request("/auth/google", "POST", { credential }, { cookie: `cc_google_nonce=${nonce}`, csrf: "" });
      assert.equal(response.status, 200, JSON.stringify(response.body)); assert.equal(response.body.mustChangePassword, true);
      // Google also clears its nonce cookie; select the session cookie explicitly.
      const cookie = response.headers.getSetCookie().find(value => value.startsWith("cc_session="))!.split(";")[0];
      const session = { cookie, csrf: response.body.csrfToken };
      assert.equal((await request("/servers", "GET", undefined, session)).body.code, "PASSWORD_CHANGE_REQUIRED");
      await collections.users.updateOne({ _id: u.id }, { $set: { inviteIssuedAt: new Date(0) } });
      assert.equal((await change(session, u.otp)).body.code, "PASSWORD_EXPIRED");
      globalThis.fetch = realFetch;
    });
    // A legacy session without a revision remains compatible for an unchanged account.
    const token = owner.cookie.slice("cc_session=".length);
    await t.test("malformed stored revisions never authenticate as legacy zero", async () => {
      for (const invalid of [null, -1, 0.5, "0"]) {
        await collections.sessions.updateOne({ tokenHash: hashSecret(token) }, { $set: { authVersion: invalid as number } });
        assert.equal((await request("/me", "GET", undefined, owner)).status, 401);
      }
      await collections.sessions.updateOne({ tokenHash: hashSecret(token) }, { $set: { authVersion: 0 } });
      await collections.users.updateOne({ _id: ownerId }, { $set: { authVersion: null as unknown as number } });
      assert.equal((await request("/me", "GET", undefined, owner)).status, 401);
      await collections.users.updateOne({ _id: ownerId }, { $unset: { authVersion: "" } });
    });
    await collections.sessions.updateOne({ tokenHash: hashSecret(token) }, { $unset: { authVersion: "" } });
    assert.equal((await request("/me", "GET", undefined, owner)).body.mustChangePassword, false);
    await t.test("owner replacement snapshots its revision before a racing reset", async () => {
      await collections.users.updateMany({ orgId, role: "Owner", _id: { $ne: ownerId } }, { $set: { disabledAt: new Date() } });
      process.env.CONTROL_CENTER_BOOTSTRAP_MODE = "replacement";
      process.env.CONTROL_CENTER_OWNER_REPLACEMENT_TOKEN = "test-recovery-secret-012345678901234567890";
      const original = collections.sessions.deleteMany.bind(collections.sessions);
      collections.sessions.deleteMany = (async (filter: any, options?: any) => {
        const result = await original(filter, options);
        await collections.users.updateOne({ _id: ownerId }, { $inc: { authVersion: 1 }, $set: { passwordHash: hashPassword("racing-reset-password"), mustChangePassword: true, inviteIssuedAt: new Date() } });
        return result;
      }) as typeof collections.sessions.deleteMany;
      let replacement;
      try { replacement = await request("/auth/owner-replacement", "POST", { ownerEmail: "replacement@otp.test", ownerName: "New owner", password: "replacement-password", recoveryToken: process.env.CONTROL_CENTER_OWNER_REPLACEMENT_TOKEN }); }
      finally { collections.sessions.deleteMany = original; }
      assert.equal(replacement.status, 201);
      assert.equal((await collections.users.findOne({ _id: ownerId }))?.authVersion, 2);
      assert.equal((await request("/me", "GET", undefined, sessionOf(replacement))).status, 401);
    });
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await client.db(isolated.dbName).dropDatabase();
    await client.close();
  }
});
