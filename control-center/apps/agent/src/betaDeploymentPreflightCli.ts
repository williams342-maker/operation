import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runBetaDeploymentPreflight, serializePreflightReport, withBetaPreflightTemporaryFiles, type BetaDeploymentPreflightInput } from "./betaDeploymentPreflight.js";
import { forgeEvidenceRequested, type ForgeTrustAnchors } from "./forgePreflightEvidence.js";
import { loadForgeSecurityMaterial } from "./forgeSecurityIdentity.js";

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
// The daemon configuration is deliberately NOT used here. It is mutable enrollment state owned by the
// service identity. Forge security identity and trust roots live under a distinct root-owned hierarchy;
// `loadForgeSecurityMaterial()` validates the complete path, stable-open semantics, machine binding and
// validity window before returning either one.
const CONSUMED_NONCE_DIR = "/var/lib/opsworkbench-agent/consumed-preflight-nonces";

type RootOwnedIdentity = { orgId: string; serverId: string; ownerPublicKey: string };

/**
 * Root-owned agent identity, or the reason there is none. Never falls back to cwd or env.
 *
 * THESE FIELDS ARE PROVISIONED, NOT ENROLLED, and that is deliberate. `orgId` in particular is the
 * MEASURED identity the Forge binding check compares a signed authorization against. If the agent
 * learned it from the control plane, the party that issues bindings would also define the identity they
 * are checked against, and an authorization meant for another host could be made to pass here. The same
 * argument is why the owner key and the trusted root are files at fixed root-owned paths.
 *
 * Consequence, stated because it was previously described as temporary: NOTHING in this repository ever
 * writes `orgId`. Enrollment writes `serverId` only (agent.ts, on the poll response, which carries no
 * orgId at all). So on an unprovisioned host this is missing permanently, not "until enrollment", and
 * Forge evidence can never verify there. That is the correct direction -- it must be provisioned by
 * whoever owns the host -- but it has to be VISIBLE, which is what the reason string is for.
 */
type IdentityOutcome =
  | { ok: true; identity: RootOwnedIdentity; anchors: ForgeTrustAnchors }
  | { ok: false; reason: string };

function loadRootOwnedIdentity(): IdentityOutcome {
  try {
    const material = loadForgeSecurityMaterial();
    return {
      ok: true,
      identity: material.identity,
      anchors: { trustedRoot: material.trustedRoot, ownerPublicKey: material.identity.ownerPublicKey },
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Forge security identity is unavailable" };
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
    // STRICT INERTNESS. A host not using Forge must behave exactly as it did before Forge existed, and
    // that includes not READING root-owned identity or trust material. Reading those files is not
    // harmless: it is I/O on privileged paths, it can fail or warn, and it made every non-Forge run
    // depend on state it never used. `actualOrgId` and `actualServerId` have exactly one consumer -- the
    // Forge binding check -- so nothing outside Forge loses anything by this being conditional.
    const forgeRequested = forgeEvidenceRequested(supplied);
    // This three-service beta path predates admin-web plus the Review Gate becoming one indivisible
    // production image set. Its library-level verifier remains for historical evidence tests, but the
    // executable must never issue an approval for forge-build-v2 while it cannot deploy/rollback and
    // inspect the Review Gate image. The version-controlled trusted deployer is the sole Forge release
    // path and binds all four roles for both candidate and rollback.
    if (forgeRequested) {
      throw new Error("Forge deployment refused: beta preflight is superseded; use trusted-deployer.mjs so all four runtime images are bound");
    }
    // Identity is MEASURED from root-owned material. Anything the input file claims about identity or
    // consumed nonces is discarded rather than merged.
    const outcome = forgeRequested ? loadRootOwnedIdentity() : undefined;
    if (outcome && !outcome.ok) {
      // The run still BLOCKS -- unprovisioned identity must never become a pass. But it blocked with
      // "trust-anchors-unavailable", which describes a symptom two layers from the cause and does not
      // tell an operator what to put where.
      process.stderr.write(`Forge evidence was supplied, but this host has no provisioned identity: ${outcome.reason}\n`);
      process.stderr.write("Provision it root-owned; it is deliberately not supplied by enrollment.\n");
    }
    const identity = outcome?.ok ? outcome.identity : undefined;
    const input: BetaDeploymentPreflightInput = {
      ...supplied,
      actualOrgId: identity?.orgId,
      actualServerId: identity?.serverId,
    };
    const anchors = outcome?.ok ? outcome.anchors : undefined;
    const result = await withBetaPreflightTemporaryFiles(input, () => runBetaDeploymentPreflight(input, { anchors, claimNonces }));
    passed = result.status.startsWith("PASS");
    process.stdout.write(serializePreflightReport(result));
    process.exitCode = passed ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("Forge deployment refused:")
      ? error.message
      : "Beta deployment preflight could not read the value-free input file.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  } finally {
    // A run that did not reach PASS must not burn a legitimate authorization — including when the
    // temporary-file helper throws after the claim and no result object exists.
    if (!passed) releaseOwnClaims();
  }
}
