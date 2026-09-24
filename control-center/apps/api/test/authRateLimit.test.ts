import assert from "node:assert/strict";
import test from "node:test";

// The credential limiter is skipped outside production and staging, so this file imports the app in test
// mode and then switches NODE_ENV to staging: the limiter's `skip` is read per request. Google sign-in is
// left unconfigured, so neither route touches the database (start answers `enabled: false`, the exchange
// answers 404) and every 429 comes from the limiter alone.
test("the credential limiter counts the Google credential exchange but not the nonce request", async (t) => {
  process.env.NODE_ENV = "test";
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  const { app } = await import("../src/server.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "staging";
  t.after(async () => {
    process.env.NODE_ENV = previous;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const start = (path = "/api/auth/google/start") => fetch(origin + path).then((r) => r.status);
  const exchange = (path = "/api/auth/google") => fetch(origin + path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.status);

  // More nonce requests than the whole credential budget (20): a sign-in page that renders often must not
  // lock everyone out of signing in.
  for (let i = 0; i < 25; i += 1) assert.equal(await start(), 200, `nonce request ${i + 1}`);
  assert.equal(await start("/API/Auth/Google/Start/"), 200, "case and trailing-slash variants of the nonce request");

  // The exchange is still a credential attempt: 20 reach the route, the 21st is refused by the limiter.
  for (let i = 0; i < 20; i += 1) assert.equal(await exchange(), 404, `exchange ${i + 1}`);
  assert.equal(await exchange(), 429);
  // Express routes case-insensitively, so a case variant must not step around the limit.
  assert.equal(await exchange("/API/AUTH/GOOGLE"), 429);
  // The budget is shared with password login.
  const login = await fetch(origin + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(login.status, 429);
});
