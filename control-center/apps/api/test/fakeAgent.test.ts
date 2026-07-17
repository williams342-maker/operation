import { MongoClient } from "mongodb";
import test from "node:test";
import assert from "node:assert/strict";
import { agentSigningKey, signRequest } from "@control-center/shared";
import { assertSafeTestMongoUrl, isolatedTestMongoUrl } from "../src/testDbGuard.js";

export function signedAgentHeaders(secret: string, agentId: string, path: string, body: unknown, timestamp = new Date().toISOString(), nonce = "nonce") {
  const bodyText = JSON.stringify(body);
  return {
    "content-type": "application/json",
    "x-agent-id": agentId,
    "x-agent-timestamp": timestamp,
    "x-agent-nonce": nonce,
    "x-agent-signature": signRequest(agentSigningKey(secret), { method: "POST", path, timestamp, nonce, body: bodyText })
  };
}

test("fake-agent harness signs poll requests", () => {
  const body = { heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "test" } };
  const headers = signedAgentHeaders("secret", "agent-1", "/api/agent/poll", body);
  assert.equal(headers["x-agent-id"], "agent-1");
  assert.match(headers["x-agent-signature"], /^[a-f0-9]{64}$/);
});

test("database integration guard blocks production-like MongoDB targets", () => {
  const original = process.env.CONTROL_CENTER_RUN_DB_TESTS;
  process.env.CONTROL_CENTER_RUN_DB_TESTS = "true";
  assert.throws(() => assertSafeTestMongoUrl("mongodb+srv://user:pass@cluster0.uxetngu.mongodb.net/craftersmarket"));
  assert.throws(() => assertSafeTestMongoUrl("mongodb://127.0.0.1:27017/production"));
  assert.equal(assertSafeTestMongoUrl("mongodb://127.0.0.1:27017/control_center_test"), "mongodb://127.0.0.1:27017/control_center_test");
  if (original === undefined) delete process.env.CONTROL_CENTER_RUN_DB_TESTS;
  else process.env.CONTROL_CENTER_RUN_DB_TESTS = original;
});

test("database integration: safe test database can connect", { skip: process.env.CONTROL_CENTER_RUN_DB_TESTS !== "true" || !process.env.MONGO_URL_TEST }, async () => {
  const isolated = isolatedTestMongoUrl();
  const client = new MongoClient(isolated.url, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  try {
    await client.db(isolated.dbName).command({ ping: 1 });
  } finally {
    await client.db(isolated.dbName).dropDatabase();
    await client.close();
  }
});
