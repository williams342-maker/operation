import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runBetaDeploymentPreflight, serializePreflightReport, withBetaPreflightTemporaryFiles, type BetaDeploymentPreflightInput } from "./betaDeploymentPreflight.js";
import { agentConfigSchema } from "./config.js";
import { readJsonFile } from "./forgeAttestation.js";
import type { ForgeTrustAnchors } from "./forgePreflightEvidence.js";

// FIXED, ROOT-OWNED PATHS. Not configurable, not environment-overridable, not relative to the working
// directory, and not reachable from the operator-supplied input file.
//
// Three review rounds found the same failure relocated one level down each time: first a `verified`
// boolean in the evidence file, then the anchor PATHS in the evidence file, then `loadConfig()` — whose
// path is `process.env.CONTROL_CENTER_AGENT_CONFIG || path.resolve(process.cwd(), "agent.local.json")`.
// Both the environment variable and the working directory belong to the caller, so the owner public key
// and the "measured" org/server identity were still operator-substitutable: run the preflight from a
// directory holding your own agent.local.json and you are the owner.
//
// `loadConfig()` is the right helper for the agent daemon, where an override is a development
// convenience. It is the wrong helper HERE, because this is an authority boundary. Read the identity
// from the fixed root-owned path the agent design already defines
// (docs/agent-upgrades.md: "/etc/opsworkbench-agent/agent.json: preserved agent identity and credential
// configuration") and accept no substitute.
const AGENT_IDENTITY_PATH = "/etc/opsworkbench-agent/agent.json";
const TRUSTED_ROOT_PATH = "/etc/opsworkbench-agent/forge-trust-root.json";
const CONSUMED_NONCE_DIR = "/var/lib/opsworkbench-agent/consumed-preflight-nonces";

type RootOwnedIdentity = { orgId: string; serverId: string; ownerPublicKey: string };

/** Root-owned agent identity, or undefined when this host has none. Never falls back to cwd or env. */
function loadRootOwnedIdentity(): RootOwnedIdentity | undefined {
  try {
    const config = agentConfigSchema.parse(JSON.parse(fs.readFileSync(AGENT_IDENTITY_PATH, "utf8")));
    if (!config.orgId || !config.serverId || !config.ownerPublicKey) return undefined;
    return { orgId: config.orgId, serverId: config.serverId, ownerPublicKey: config.ownerPublicKey };
  } catch {
    return undefined;
  }
}

function loadTrustAnchors(ownerPublicKey: string): ForgeTrustAnchors | undefined {
  try {
    return { trustedRoot: readJsonFile(TRUSTED_ROOT_PATH), ownerPublicKey };
  } catch {
    return undefined;
  }
}

const nonceMarker = (nonce: string) =>
  // Store the digest, not the nonce: a marker directory should not disclose the authorization values it
  // has seen.
  path.join(CONSUMED_NONCE_DIR, `${crypto.createHash("sha256").update(nonce).digest("hex")}.used`);

/**
 * ATOMIC check-and-consume. Exclusive creation is the atomic primitive on POSIX and Windows, so two
 * concurrent preflights cannot both observe a nonce as unused: exactly one `wx` create succeeds.
 *
 * `claimedByThisRun` is the ONLY set that may ever be released. The previous version released whatever
 * nonces the report mentioned, so a blocked REPLAY deleted the markers left by the earlier successful
 * run — run 1 passed, run 2 replayed and blocked, run 3 passed. Replay protection that works once and
 * then disarms itself is worse than none, because it looks like protection.
 */
const claimedByThisRun = new Set<string>();

function claimNonces(nonces: string[]): { claimed: string[]; alreadyUsed: boolean } {
  fs.mkdirSync(CONSUMED_NONCE_DIR, { recursive: true, mode: 0o700 });
  const claimed: string[] = [];
  for (const nonce of nonces) {
    try {
      fs.writeFileSync(nonceMarker(nonce), "", { flag: "wx", mode: 0o600 });
      claimed.push(nonce);
      claimedByThisRun.add(nonce);
    } catch {
      // Already consumed — by an earlier run, or by a concurrent one that won the race. Release only
      // what THIS attempt created; a pre-existing marker is someone else's and must survive.
      for (const own of claimed) {
        fs.rmSync(nonceMarker(own), { force: true });
        claimedByThisRun.delete(own);
      }
      return { claimed: [], alreadyUsed: true };
    }
  }
  return { claimed, alreadyUsed: false };
}

/** Releases only what this invocation created. Never touches a marker it did not write. */
function releaseOwnClaims() {
  for (const nonce of claimedByThisRun) fs.rmSync(nonceMarker(nonce), { force: true });
  claimedByThisRun.clear();
}

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write("Usage: npm run preflight:beta -- <value-free-input.json>\n");
  process.exitCode = 2;
} else {
  let passed = false;
  try {
    const supplied = JSON.parse(fs.readFileSync(inputPath, "utf8")) as BetaDeploymentPreflightInput;
    // Identity is MEASURED from root-owned material. Anything the input file claims about identity or
    // consumed nonces is discarded rather than merged.
    const identity = loadRootOwnedIdentity();
    const input: BetaDeploymentPreflightInput = {
      ...supplied,
      actualOrgId: identity?.orgId,
      actualServerId: identity?.serverId,
    };
    const anchors = identity ? loadTrustAnchors(identity.ownerPublicKey) : undefined;
    const result = await withBetaPreflightTemporaryFiles(input, () => runBetaDeploymentPreflight(input, { anchors, claimNonces }));
    passed = result.status.startsWith("PASS");
    process.stdout.write(serializePreflightReport(result));
    process.exitCode = passed ? 0 : 1;
  } catch {
    process.stderr.write("Beta deployment preflight could not read the value-free input file.\n");
    process.exitCode = 2;
  } finally {
    // A run that did not reach PASS must not burn a legitimate authorization — including when the
    // temporary-file helper throws after the claim and no result object exists.
    if (!passed) releaseOwnClaims();
  }
}
