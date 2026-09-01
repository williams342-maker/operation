import fs from "node:fs";
import path from "node:path";
import { runBetaDeploymentPreflight, serializePreflightReport, withBetaPreflightTemporaryFiles, type BetaDeploymentPreflightInput } from "./betaDeploymentPreflight.js";
import { loadConfig } from "./config.js";

// Persistent replay markers, mirroring the updater's /var/lib/opsworkbench-agent/consumed-upgrades.
// A nonce store that lives only in a process is not replay protection: the second run is a new process.
const CONSUMED_NONCE_FILE = process.env.CONTROL_CENTER_PREFLIGHT_NONCE_FILE || "/var/lib/opsworkbench-agent/consumed-preflight-nonces";

function readConsumedNonces(): string[] {
  try {
    return fs.readFileSync(CONSUMED_NONCE_FILE, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function consumeNonces(nonces: string[]) {
  if (!nonces.length) return;
  fs.mkdirSync(path.dirname(CONSUMED_NONCE_FILE), { recursive: true, mode: 0o700 });
  // Append-only: a marker that can be removed is a marker that can be replayed around.
  fs.appendFileSync(CONSUMED_NONCE_FILE, `${nonces.join("\n")}\n`, { mode: 0o600 });
}

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write("Usage: npm run preflight:beta -- <value-free-input.json>\n");
  process.exitCode = 2;
} else {
  try {
    const supplied = JSON.parse(fs.readFileSync(inputPath, "utf8")) as BetaDeploymentPreflightInput;
    // The identity of the host being deployed to is MEASURED, never accepted from the input file. An
    // operator-supplied "actual" identity would let a binding for one server be presented against
    // another, which is exactly the blocker an independent review found on 2026-09-01. Anything the
    // input claims about identity or consumed nonces is discarded here.
    const config = loadConfig();
    const input: BetaDeploymentPreflightInput = {
      ...supplied,
      actualOrgId: config.orgId,
      actualServerId: config.serverId,
      consumedNonces: readConsumedNonces(),
    };
    const result = await withBetaPreflightTemporaryFiles(input, () => runBetaDeploymentPreflight(input));
    // Consume only on a PASS. A blocked run must not burn the nonce, or a transient failure would
    // destroy a legitimate authorization; a passing run must burn it, or the approval it produces can be
    // presented twice.
    if (result.status.startsWith("PASS") && result.report.forge?.state === "verified") {
      consumeNonces([result.report.forge.bindingNonce, result.report.forge.ownerNonce].filter((value): value is string => Boolean(value)));
    }
    process.stdout.write(serializePreflightReport(result));
    process.exitCode = result.status.startsWith("PASS") ? 0 : 1;
  } catch {
    process.stderr.write("Beta deployment preflight could not read the value-free input file.\n");
    process.exitCode = 2;
  }
}
