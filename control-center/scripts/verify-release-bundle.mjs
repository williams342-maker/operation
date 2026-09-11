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
      const match = line.match(/^([0-9a-f]{64})\s+\*?([A-Za-z0-9][A-Za-z0-9._-]*)$/);
      return match ? { hash: match[1], name: match[2] } : null;
    });
}

// Pure, offline verification of a release-output directory. Returns { ok, problems, manifest }.
// Never throws on verification failure — collects problems so callers/tests can assert precisely.
/**
 * `requireAgentArtifact` exists for ONE case: a host-verified rollback onto a release that predates the
 * agent artifact entirely. The agent installed by a deployment is always the CANDIDATE's -- a rollback
 * bundle's agent artifact is read by nothing, here or in the deployer -- so requiring it of a rollback
 * was a check on a field that is never used. It stays required everywhere else, including for every
 * candidate and for an attested rollback, because there it costs nothing and a missing one would mean a
 * malformed release.
 */
export function verifyReleaseBundle(dir, { expectedTag, requireAgentArtifact = true } = {}) {
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
    if (!manifest.artifact || !entries.some((entry) => entry && entry.name === manifest.artifact)) problems.push("manifest artifact is not covered by SHA256SUMS");
    // A DECLARED agent artifact must always be covered by SHA256SUMS, even when one is not required.
    // Relaxing "must be present" into "may be absent, unverified" would let a bundle name an artifact
    // nothing checks, which is the opposite of the point.
    if (manifest.agentArtifact || requireAgentArtifact) {
      if (!manifest.agentArtifact || !entries.some((entry) => entry && entry.name === manifest.agentArtifact)) problems.push("manifest agentArtifact is not covered by SHA256SUMS");
    }
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

/**
 * ATTESTATION BUNDLES, AND WHY THE BUNDLE IS ADDRESSED BY THE SUBJECT'S OWN DIGEST.
 *
 * `gh attestation verify` fetches the attestation from the GitHub API by default, and that needs a
 * token even for a public repository. Putting a GitHub credential on a production host so it can verify
 * a public artifact is the wrong trade, so the attestations are fetched where a credential already
 * exists and travel to the host as bundle files. `--bundle` makes gh read the attestation from disk.
 *
 * The bundle NAMES NOTHING. It is looked up by the sha256 of the bytes being verified, computed here,
 * never by a path carried in a plan or a manifest — so no caller can point one artifact at another
 * artifact's bundle, and there is no filename to get wrong. `gh attestation download` writes bundles
 * under exactly this name, so the producing side needs no extra tooling either.
 *
 * A MISSING BUNDLE IS AN ERROR, never a fall back to the API. Falling back would mean the mode that
 * exists to avoid needing a credential quietly requires one again at the moment it is used.
 */
export function attestationBundleFor(bundleDirectory, digest) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("attestation subject digest is invalid");
  const file = path.join(bundleDirectory, `sha256-${digest}.jsonl`);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw new Error(`no attestation bundle for sha256:${digest}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`attestation bundle for sha256:${digest} is not a regular file`);
  return file;
}

// Verify the SLSA build-provenance attestation for each listed file via `gh attestation verify`.
// Separated from the pure check so offline unit tests never touch the network.
//
// `bundleDirectory` switches gh from the API to bundles on disk. What gh checks is unchanged either
// way — signature, certificate identity, signer workflow, source commit and ref, and that the subject
// digest is the file in front of it. Measured against gh 2.100.0: a bundle for a different subject, a
// garbage bundle, an empty bundle, a tampered artifact, the wrong signer workflow, the wrong source
// digest and the wrong source ref each exit non-zero, and none of them falls back to the API.
export function verifyAttestation(dir, fileNames, { repo = REPOSITORY, required = false, signerWorkflow, sourceDigest, sourceRef, bundleDirectory, hooks = {} } = {}) {
  // Injectable so a test can see the ARGUMENTS this builds. Asserting that a bundle is passed by
  // asserting the function returned is asserting nothing: it returns the same value either way.
  const available = hooks.ghAvailable ?? ghAvailable;
  const run = hooks.run ?? ((args) => execFileSync("gh", args, { stdio: "pipe" }));
  if (!available()) {
    // Bundles remove the need for a CREDENTIAL, not for the CLI that checks the signature. A caller
    // that asked for bundle verification is never told the check was skipped.
    if (required || bundleDirectory) throw new Error("gh CLI is unavailable but attestation verification is required");
    return { verified: false, skipped: true, reason: "gh CLI unavailable" };
  }
  for (const name of fileNames) {
    const target = path.join(dir, name);
    const args = ["attestation", "verify", target, "--repo", repo];
    if (bundleDirectory) args.push("--bundle", attestationBundleFor(bundleDirectory, sha256Hex(fs.readFileSync(target))));
    if (signerWorkflow) args.push("--signer-workflow", signerWorkflow);
    if (sourceDigest) args.push("--source-digest", sourceDigest);
    if (sourceRef) args.push("--source-ref", sourceRef);
    run(args);
  }
  return { verified: true, skipped: false, offline: Boolean(bundleDirectory) };
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
