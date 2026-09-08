import { mock } from "node:test";
import type { loadForgeSecurityMaterial } from "../src/forgeSecurityIdentity.js";

type Material = ReturnType<typeof loadForgeSecurityMaterial>;
type Target = Pick<Material["identity"], "orgId" | "serverId">;

// Test-runner module replacement, not a production configuration seam. Install before importing agent.
// These fixtures test the consumer's identity checks and error propagation. The real filesystem,
// signature and expiry verifier remains covered by forgeSecurityIdentity.test.ts without this mock.
export async function fixtureForgeSecurity(initial: Target) {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const url = new URL(`../src/forgeSecurityIdentity.${extension}`, import.meta.url);
  const actual = await import(url.href) as typeof import("../src/forgeSecurityIdentity.js");
  let target = { ...initial };
  let failure: Error | undefined;
  let reads = 0;
  mock.module(url, { namedExports: { ...actual, loadForgeSecurityMaterial: (): Material => {
    reads += 1;
    if (failure) throw failure;
    return {
      identity: {
        schemaVersion: "forge-security-identity-v1", ...target, ownerPublicKey: "fixture-public-key",
        trustedRootSha256: "a".repeat(64), reviewGateCaSha256: "b".repeat(64), hostname: "fixture-host",
        machineIdSha256: "c".repeat(64), validFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2027-01-01T00:00:00.000Z", ownerSignature: "fixture-signature",
      },
      trustedRoot: {}, reviewGateCaPath: "fixture-ca", reviewGateCa: Buffer.from("fixture-ca"),
    };
  } } });
  return {
    setTarget(value: Target) { target = { ...value }; },
    refuse(error?: Error) { failure = error; },
    get reads() { return reads; },
  };
}
