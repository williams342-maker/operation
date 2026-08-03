import assert from "node:assert/strict";
import test from "node:test";
import { enroll, machineAccessHeaders, signedPost } from "../src/client.js";

const serviceEnv = {
  CF_ACCESS_CLIENT_ID: "test-client-id",
  CF_ACCESS_CLIENT_SECRET: "test-client-secret"
};

test("machine authentication requires a complete service-token pair", () => {
  assert.deepEqual(machineAccessHeaders({}), {});
  assert.throws(
    () => machineAccessHeaders({ CF_ACCESS_CLIENT_ID: "id-only" }),
    /configuration is incomplete/
  );
  assert.deepEqual(machineAccessHeaders(serviceEnv), {
    "CF-Access-Client-Id": "test-client-id",
    "CF-Access-Client-Secret": "test-client-secret"
  });
});

test("enrollment sends machine authentication and errors do not disclose secrets", async () => {
  const originalFetch = globalThis.fetch;
  const originalId = process.env.CF_ACCESS_CLIENT_ID;
  const originalSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  process.env.CF_ACCESS_CLIENT_ID = serviceEnv.CF_ACCESS_CLIENT_ID;
  process.env.CF_ACCESS_CLIENT_SECRET = serviceEnv.CF_ACCESS_CLIENT_SECRET;
  try {
    globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("CF-Access-Client-Id"), serviceEnv.CF_ACCESS_CLIENT_ID);
      assert.equal(headers.get("CF-Access-Client-Secret"), serviceEnv.CF_ACCESS_CLIENT_SECRET);
      return new Response("denied-body-must-not-be-logged", { status: 403 });
    };
    await assert.rejects(
      enroll("https://example.invalid", "one-time-token", {}),
      (error: Error) => {
        assert.equal(error.message, "Enrollment failed with 403");
        assert.doesNotMatch(error.message, /test-client|one-time-token|denied-body/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalId === undefined) delete process.env.CF_ACCESS_CLIENT_ID; else process.env.CF_ACCESS_CLIENT_ID = originalId;
    if (originalSecret === undefined) delete process.env.CF_ACCESS_CLIENT_SECRET; else process.env.CF_ACCESS_CLIENT_SECRET = originalSecret;
  }
});

test("signed agent requests carry machine authentication after enrollment", async () => {
  const originalFetch = globalThis.fetch;
  const originalId = process.env.CF_ACCESS_CLIENT_ID;
  const originalSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  process.env.CF_ACCESS_CLIENT_ID = serviceEnv.CF_ACCESS_CLIENT_ID;
  process.env.CF_ACCESS_CLIENT_SECRET = serviceEnv.CF_ACCESS_CLIENT_SECRET;
  try {
    globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("CF-Access-Client-Id"), serviceEnv.CF_ACCESS_CLIENT_ID);
      assert.equal(headers.get("CF-Access-Client-Secret"), serviceEnv.CF_ACCESS_CLIENT_SECRET);
      assert.ok(headers.get("x-agent-signature"));
      return Response.json({ tasks: [] });
    };
    await signedPost({
      controlCenterUrl: "https://example.invalid",
      agentId: "agent-id",
      agentSecret: "agent-secret"
    } as never, "/api/agent/poll", {});
  } finally {
    globalThis.fetch = originalFetch;
    if (originalId === undefined) delete process.env.CF_ACCESS_CLIENT_ID; else process.env.CF_ACCESS_CLIENT_ID = originalId;
    if (originalSecret === undefined) delete process.env.CF_ACCESS_CLIENT_SECRET; else process.env.CF_ACCESS_CLIENT_SECRET = originalSecret;
  }
});
