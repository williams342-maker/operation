// verify-release-bundle.mjs — deploy-time verification of a release-output bundle (gap G1).
//
// Verifies a `release-output/` directory (produced by build-release-artifacts.sh) BEFORE it is allowed to
// deploy: (1) SHA256SUMS integrity, (2) release manifest consistency, and (3) the GitHub SLSA
// build-provenance attestation over the bundle files.
//
// This is standalone opt-in tooling. It is NOT wired into any running deploy and changes no runtime
// behavior; it exists so the deployment-readiness gate can refuse an unverified/out-of-band bundle (exactly
// the class of deploy that produced the unattested production commit 16e14682). It stays inert with respect
// to production until the readiness gate explicitly invokes it.
//
// The pure verification (1)+(2) is offline and unit-tested. The attestation step (3) shells out to `gh` and
// is only REQUIRED when CONTROL_CENTER_REQUIRE_RELEASE_ATTESTATION is set (backward-compatible default: if
// `gh` is unavailable it is reported as "not verified" rather than failing, unless required).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export const RELEASE_MANIFEST_SCHEMA = "opsworkbench-release-v1";
export const REPOSITORY = "williams342-maker/operation";

export function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Parse a SHA256SUMS file body into [{hash, name}]. `null` entries mark malformed lines.
export function parseSha256Sums(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
      return match ? { hash: match[1], name: match[2] } : null;
    });
}

// Pure, offline verification of a release-output directory. Returns { ok, problems, manifest }.
// Never throws on verification failure — collects problems so callers/tests can assert precisely.
export function verifyReleaseBundle(dir, { expectedTag } = {}) {
  const problems = [];
  const sumsPath = path.join(dir, "SHA256SUMS");
  if (!fs.existsSync(sumsPath) || !fs.statSync(sumsPath).isFile()) {
    return { ok: false, problems: ["SHA256SUMS is missing"], manifest: null };
  }
  const entries = parseSha256Sums(fs.readFileSync(sumsPath, "utf8"));
  if (entries.length === 0) problems.push("SHA256SUMS is empty");
  if (entries.some((entry) => entry === null)) problems.push("SHA256SUMS has malformed line(s)");

  for (const entry of entries.filter(Boolean)) {
    const target = path.join(dir, entry.name);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      problems.push(`listed file missing: ${entry.name}`);
      continue;
    }
    if (sha256Hex(fs.readFileSync(target)) !== entry.hash) {
      problems.push(`checksum mismatch: ${entry.name}`);
    }
  }

  let manifest = null;
  const manifestEntry = entries.find((entry) => entry && entry.name.endsWith(".manifest.json"));
  if (!manifestEntry) {
    problems.push("no .manifest.json listed in SHA256SUMS");
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, manifestEntry.name), "utf8"));
    } catch {
      problems.push("manifest is not valid JSON");
    }
  }
  if (manifest) {
    if (manifest.schemaVersion !== RELEASE_MANIFEST_SCHEMA) {
      problems.push(`unexpected manifest schemaVersion: ${manifest.schemaVersion}`);
    }
    if (!/^[0-9a-f]{40}$/.test(manifest.commit || "")) {
      problems.push("manifest commit is not a full 40-char SHA");
    }
    if (expectedTag && manifest.tag !== expectedTag) {
      problems.push(`manifest tag ${manifest.tag} != expected ${expectedTag}`);
    }
    if (manifest.artifact && !entries.some((entry) => entry && entry.name === manifest.artifact)) {
      problems.push(`manifest artifact ${manifest.artifact} is not covered by SHA256SUMS`);
    }
    if (!manifest.agentArtifact || !entries.some((entry) => entry && entry.name === manifest.agentArtifact)) problems.push("manifest agentArtifact is not covered by SHA256SUMS");
  }

  return { ok: problems.length === 0, problems, manifest };
}

export function ghAvailable() {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Verify the SLSA build-provenance attestation for each listed file via `gh attestation verify`.
// Separated from the pure check so offline unit tests never touch the network.
export function verifyAttestation(dir, fileNames, { repo = REPOSITORY, required = false, signerWorkflow, sourceDigest, sourceRef } = {}) {
  if (!ghAvailable()) {
    if (required) throw new Error("gh CLI is unavailable but attestation verification is required");
    return { verified: false, skipped: true, reason: "gh CLI unavailable" };
  }
  for (const name of fileNames) {
    const args = ["attestation", "verify", path.join(dir, name), "--repo", repo];
    if (signerWorkflow) args.push("--signer-workflow", signerWorkflow);
    if (sourceDigest) args.push("--source-digest", sourceDigest);
    if (sourceRef) args.push("--source-ref", sourceRef);
    execFileSync("gh", args, { stdio: "pipe" });
  }
  return { verified: true, skipped: false };
}

function main() {
  const arg = (name) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  const dir = path.resolve(arg("--dir") || "release-output");
  const expectedTag = arg("--tag");
  const required = process.env.CONTROL_CENTER_REQUIRE_RELEASE_ATTESTATION === "1";

  const result = verifyReleaseBundle(dir, { expectedTag });
  if (!result.ok) {
    process.stderr.write(`Release bundle verification FAILED:\n- ${result.problems.join("\n- ")}\n`);
    process.exit(1);
  }
  const covered = parseSha256Sums(fs.readFileSync(path.join(dir, "SHA256SUMS"), "utf8"))
    .filter(Boolean)
    .map((entry) => entry.name);
  let attestation;
  try {
    attestation = verifyAttestation(dir, covered, { required });
  } catch (error) {
    process.stderr.write(`Attestation verification FAILED: ${error.message}\n`);
    process.exit(1);
  }
  if (attestation.skipped) {
    process.stderr.write(`WARNING: build-provenance attestation NOT verified (${attestation.reason}). ` +
      `Set CONTROL_CENTER_REQUIRE_RELEASE_ATTESTATION=1 to make this a hard failure.\n`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    commit: result.manifest.commit,
    tag: result.manifest.tag,
    attestationVerified: attestation.verified,
  })}\n`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("verify-release-bundle.mjs")) {
  main();
}
