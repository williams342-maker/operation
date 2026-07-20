import assert from "node:assert/strict";
import test from "node:test";
import { enrollmentBootstrapScript } from "../src/enrollmentBootstrap.js";

const input = {
  controlCenterUrl: "https://opsworkbench.org",
  serverSlug: "crafters-market-beta",
  enrollmentToken: "owenr_test-token",
  cloudflareClientId: "client-id.example.access",
  cloudflareClientSecret: "client-secret-value",
  agentRevision: "a".repeat(40),
  agentArchiveSha256: "b".repeat(64)
};

test("bootstrap keeps credentials out of commands and supplies every protected installer input", () => {
  const script = enrollmentBootstrapScript(input);
  assert.match(script, /^#!\/usr\/bin\/env bash\n/);
  assert.doesNotMatch(script, /owenr_test-token|client-secret-value|client-id\.example\.access/);
  for (const name of ["control-center-url", "server-slug", "enrollment-token", "cf-access-client-id", "cf-access-client-secret", "agent-revision", "agent-archive-sha256"]) assert.match(script, new RegExp(name));
  assert.match(script, /curl --config "\$INPUT_DIR\/curl\.conf"/);
  assert.doesNotMatch(script, /curl[^\n]+CF-Access-Client-(?:Id|Secret)/);
  assert.match(script, /rm -f -- "\$BOOTSTRAP_FILE"/);
});

test("bootstrap rejects an unpinned agent identity", () => {
  assert.throws(() => enrollmentBootstrapScript({ ...input, agentRevision: "main" }), /revision is invalid/);
  assert.throws(() => enrollmentBootstrapScript({ ...input, agentArchiveSha256: "abc" }), /digest is invalid/);
});
