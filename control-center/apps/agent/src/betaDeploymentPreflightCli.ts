import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runBetaDeploymentPreflight, serializePreflightReport, withBetaPreflightTemporaryFiles, type BetaDeploymentPreflightInput } from "./betaDeploymentPreflight.js";
import { loadConfig } from "./config.js";
import { readJsonFile } from "./forgeAttestation.js";
import type { ForgeTrustAnchors } from "./forgePreflightEvidence.js";

// FIXED, ROOT-OWNED PATHS. Not configurable, not environment-overridable, not reachable from the
// operator-supplied input file.
//
// An earlier version took the trusted root from the input and the nonce-store location from an
// environment variable. Both are caller-controlled, so both handed the caller the thing that was
// supposed to constrain them — the second round of independent review found the trusted-root case and
// it recreated the original "Party A simulatable" failure one level down. These mirror
// /etc/opsworkbench-agent/updater-trust.json and /var/lib/opsworkbench-agent/consumed-upgrades, which
// the updater already treats the same way.
const TRUSTED_ROOT_PATH = "/etc/opsworkbench-agent/forge-trust-root.json";
const CONSUMED_NONCE_DIR = "/var/lib/opsworkbench-agent/consumed-preflight-nonces";

/** Root-owned trust material, or undefined when this host has none. Never falls back to input. */
function loadTrustAnchors(ownerPublicKey: string): ForgeTrustAnchors | undefined {
  if (!ownerPublicKey) return undefined;
  try {
    return { trustedRoot: readJsonFile(TRUSTED_ROOT_PATH), ownerPublicKey };
  } catch {
    return undefined;
  }
}

const nonceMarker = (nonce: string) =>
  // Store the digest, not the nonce: a marker directory that is world-readable should not disclose the
  // authorization values it has seen.
  path.join(CONSUMED_NONCE_DIR, `${crypto.createHash("sha256").update(nonce).digest("hex")}.used`);

/**
 * ATOMIC check-and-consume. Exclusive file creation is the atomic primitive on both POSIX and Windows,
 * so two concurrent preflights cannot both observe a nonce as unused: exactly one `wx` create succeeds.
 *
 * The previous version read the whole store, decided, ran the preflight, and appended afterwards — a
 * textbook time-of-check/time-of-use window in which both runs returned PASS. Consumption must be the
 * decision, not a record of it.
 *
 * Returns the nonces this process successfully claimed, so a later failure can release them.
 */
function claimNonces(nonces: string[]): { claimed: string[]; alreadyUsed: boolean } {
  fs.mkdirSync(CONSUMED_NONCE_DIR, { recursive: true, mode: 0o700 });
  const claimed: string[] = [];
  for (const nonce of nonces) {
    try {
      fs.writeFileSync(nonceMarker(nonce), "", { flag: "wx", mode: 0o600 });
      claimed.push(nonce);
    } catch {
      // Already consumed by an earlier run, or by a concurrent one that won the race.
      for (const done of claimed) fs.rmSync(nonceMarker(done), { force: true });
      return { claimed: [], alreadyUsed: true };
    }
  }
  return { claimed, alreadyUsed: false };
}

const releaseNonces = (nonces: string[]) => {
  // A blocked run must not burn a legitimate authorization.
  for (const nonce of nonces) fs.rmSync(nonceMarker(nonce), { force: true });
};

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write("Usage: npm run preflight:beta -- <value-free-input.json>\n");
  process.exitCode = 2;
} else {
  try {
    const supplied = JSON.parse(fs.readFileSync(inputPath, "utf8")) as BetaDeploymentPreflightInput;
    const config = loadConfig();
    // The identity of the host being deployed to is MEASURED, and the trust anchors come from enrolled
    // configuration. Anything the input file claims about identity, trust, or consumed nonces is
    // discarded here rather than merged.
    const input: BetaDeploymentPreflightInput = {
      ...supplied,
      actualOrgId: config.orgId,
      actualServerId: config.serverId,
    };
    const anchors = loadTrustAnchors(config.ownerPublicKey ?? "");
    const result = await withBetaPreflightTemporaryFiles(input, () => runBetaDeploymentPreflight(input, { anchors, claimNonces }));
    if (!result.status.startsWith("PASS") && result.report.forge?.state === "verified") {
      releaseNonces([result.report.forge.bindingNonce, result.report.forge.ownerNonce].filter((value): value is string => Boolean(value)));
    }
    process.stdout.write(serializePreflightReport(result));
    process.exitCode = result.status.startsWith("PASS") ? 0 : 1;
  } catch {
    process.stderr.write("Beta deployment preflight could not read the value-free input file.\n");
    process.exitCode = 2;
  }
}
