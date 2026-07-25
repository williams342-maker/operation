import assert from "node:assert/strict";
import test from "node:test";
import { emailLoginUrl, sendEmailLoginEmail } from "../src/passwordResetMailer.js";

test("secure email login links keep tokens out of requests and referrers", () => {
  const previous = process.env.CONTROL_CENTER_PUBLIC_URL;
  process.env.CONTROL_CENTER_PUBLIC_URL = "https://opsworkbench.example/base?old=value";
  try {
    const url = new URL(emailLoginUrl("opaque-token-value"));
    assert.equal(url.pathname, "/email-login");
    assert.equal(url.search, "");
    assert.equal(new URLSearchParams(url.hash.slice(1)).get("token"), "opaque-token-value");
  } finally {
    if (previous === undefined) delete process.env.CONTROL_CENTER_PUBLIC_URL; else process.env.CONTROL_CENTER_PUBLIC_URL = previous;
  }
});

test("email login delivery fails closed without a secure webhook", async () => {
  const previous = { url: process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_URL, fallback: process.env.CONTROL_CENTER_PASSWORD_RESET_WEBHOOK_URL, node: process.env.NODE_ENV };
  delete process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_URL;
  delete process.env.CONTROL_CENTER_PASSWORD_RESET_WEBHOOK_URL;
  process.env.NODE_ENV = "production";
  try {
    assert.deepEqual(await sendEmailLoginEmail({ email: "owner@example.test", loginUrl: "https://opsworkbench.example/email-login#token=opaque", requestId: "request-1" }), { status: "not_configured" });
    process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_URL = "http://mailer.example.test/send";
    assert.deepEqual(await sendEmailLoginEmail({ email: "owner@example.test", loginUrl: "https://opsworkbench.example/email-login#token=opaque", requestId: "request-1" }), { status: "failed" });
    process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_URL = "https://mailer.example.test/send?credential=leaky";
    assert.deepEqual(await sendEmailLoginEmail({ email: "owner@example.test", loginUrl: "https://opsworkbench.example/email-login#token=opaque", requestId: "request-1" }), { status: "failed" });
  } finally {
    for (const [name, value] of [["CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_URL", previous.url], ["CONTROL_CENTER_PASSWORD_RESET_WEBHOOK_URL", previous.fallback], ["NODE_ENV", previous.node]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test("email login delivery uses a bounded template without exposing credentials in the URL", async () => {
  const previousUrl = process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_URL;
  const previousToken = process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_URL = "https://mailer.example.test/send";
  process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_TOKEN = "synthetic-webhook-credential";
  let request: { url?: string; authorization?: string; body?: any } = {};
  globalThis.fetch = (async (input, init) => { request = { url: String(input), authorization: (init?.headers as Record<string, string>)?.authorization, body: JSON.parse(String(init?.body)) }; return new Response(null, { status: 202 }); }) as typeof fetch;
  try {
    assert.deepEqual(await sendEmailLoginEmail({ email: "owner@example.test", loginUrl: "https://opsworkbench.example/email-login#token=opaque", requestId: "request-1" }), { status: "sent" });
    assert.equal(request.url, "https://mailer.example.test/send");
    assert.equal(request.authorization, "Bearer synthetic-webhook-credential");
    assert.equal(request.body.template, "opsworkbench-secure-email-login");
    assert.equal(request.body.to, "owner@example.test");
    assert.equal(request.url?.includes("synthetic-webhook-credential"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_URL; else process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_URL = previousUrl;
    if (previousToken === undefined) delete process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_TOKEN; else process.env.CONTROL_CENTER_EMAIL_LOGIN_WEBHOOK_TOKEN = previousToken;
  }
});
