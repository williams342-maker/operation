import crypto from "node:crypto";
import fs from "node:fs";
import { bundleFromJSON } from "@sigstore/bundle";
import { toTrustMaterial, toSignedEntity, Verifier } from "@sigstore/verify";
import { TrustedRoot } from "@sigstore/protobuf-specs";

// REAL Sigstore verification of a Forge build document — docs/forge-manifest-spec.md §7.
//
// This module replaces the earlier design, in which the preflight read a JSON file containing
// `verified: true` and believed it. That made Party A simulatable by the same operator supplying every
// other document, so the separation of parties was nominal. An independent review (2026-09-01) called
// it the central design failure, correctly.
//
// Nothing here accepts a verdict. The verdict is DERIVED from:
//   * a pinned trusted root, provisioned out of band (Fulcio/Rekor/TSA roots) — never fetched;
//   * the Sigstore bundle's certificate chain, transparency-log entry, and DSSE signature;
//   * the in-toto statement's own subject digests and SLSA predicate.
// There is no boolean an operator can set.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// THE TRAP THAT MAKES THIS FILE LONGER THAN IT LOOKS
//
// For a DSSE bundle, `Verifier.verify()` proves the STATEMENT was signed. It does NOT check that any
// artifact you have matches the statement's subjects, and it does not throw if you hand it an artifact
// that has nothing to do with the bundle. Verified against the real published release bundle on
// 2026-09-01: passing deliberately corrupted artifact bytes to `toSignedEntity(bundle, artifact)` still
// returned success.
//
// So the artifact→attestation binding is OURS to make, explicitly, in `subjectCoversDocument()` below.
// Omitting it yields a verifier that cryptographically proves something true about a document it never
// looked at. Do not remove that comparison.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** GitHub Actions OIDC issuer. Pinned: an attestation from any other issuer is not our builder. */
const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";

export type ForgeAttestationExpectation = {
  /** The workflow identity that must have signed, as the certificate SAN and the SLSA builder id. */
  builderIdentity: string;
  /** e.g. `github-hosted`. Rejects a self-hosted runner standing in for a hosted one. */
  runnerEnvironment: string;
  /** The commit the build document claims. Must equal what the attestation independently reports. */
  sourceCommit: string;
};

export type ForgeAttestationFacts = {
  /** Present only when every check below passed. There is no field an operator can set to fake this. */
  builderIdentity: string;
  runnerEnvironment: string;
  sourceCommit: string;
  documentSha256: string;
  subjectName: string;
};

export type ForgeAttestationOutcome =
  | { ok: true; facts: ForgeAttestationFacts }
  | { ok: false; reason: string; detail?: string };

const sha256 = (value: Buffer) => crypto.createHash("sha256").update(value).digest("hex");

/** Reads a `.json` file, or the first record of a `.jsonl` file. */
export function readJsonFile(path: string): unknown { return readJsonDocument(path); }

function readJsonDocument(path: string): unknown {
  const text = fs.readFileSync(path, "utf8").trim();
  // Try the whole document first. The previous version parsed only the first line, which silently
  // failed on any pretty-printed JSON — including a hand-provisioned trusted root, the file most likely
  // to be pretty-printed. Fail-closed, but brittle in exactly the wrong place.
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.split("\n")[0]);
  }
}

export function loadTrustedRootFile(path: string) {
  return loadTrustedRoot(readJsonDocument(path));
}

/** Takes the already-read trusted-root document. Callers supply it from root-owned material. */
export function loadTrustedRoot(document: unknown) {
  // Pinned and provisioned out of band, exactly as the updater treats
  // /etc/opsworkbench-agent/updater-trust.json: root-owned, public verification material only, never
  // fetched at verification time. A verifier that can fetch its own trust root can be pointed at
  // someone else's.
  return toTrustMaterial(TrustedRoot.fromJSON(document));
}

type InTotoStatement = {
  subject?: Array<{ name?: string; digest?: Record<string, string> }>;
  predicate?: {
    buildDefinition?: {
      internalParameters?: { github?: { runner_environment?: string } };
      resolvedDependencies?: Array<{ digest?: { gitCommit?: string } }>;
    };
    runDetails?: { builder?: { id?: string } };
  };
};

/**
 * THE BINDING THE LIBRARY DOES NOT MAKE. Returns the matching subject name, or undefined.
 * Compares our own computed digest of the bytes we actually read against the signed statement.
 */
function subjectCoversDocument(statement: InTotoStatement, documentSha256: string): string | undefined {
  for (const subject of statement.subject || []) {
    const digest = subject.digest?.sha256;
    // Validate the SHAPE before comparing. JS string length is not byte length: a multibyte digest of
    // equal character count made timingSafeEqual throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH, turning a
    // verification decision into an unhandled crash.
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) continue;
    // Constant-time compare: these are public values, but a timing-independent comparison costs
    // nothing and keeps the habit.
    if (crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(documentSha256, "hex"))) {
      return subject.name || "<unnamed>";
    }
  }
  return undefined;
}

/**
 * Verify that `documentBytes` is covered by a genuine Sigstore build-provenance attestation produced by
 * the expected workflow. Performs NO network I/O: the bundle and the trusted root are both files.
 */
export function verifyForgeBuildAttestation(input: {
  bundlePath: string;
  trustMaterial: ReturnType<typeof loadTrustedRoot>;
  documentBytes: Buffer;
  expectation: ForgeAttestationExpectation;
}): ForgeAttestationOutcome {
  let bundle: ReturnType<typeof bundleFromJSON>;
  try {
    const raw = readJsonDocument(input.bundlePath) as { bundle?: unknown };
    // `gh attestation download` wraps the bundle in an envelope; `actions/attest-build-provenance`
    // emits it bare. Accept both shapes, and nothing else.
    bundle = bundleFromJSON(raw?.bundle ?? raw);
  } catch (error) {
    return { ok: false, reason: "attestation-unreadable", detail: error instanceof Error ? error.message : undefined };
  }

  // 1. Cryptographic verification: certificate chain to the pinned roots, transparency-log inclusion,
  //    signing-time validity, and the DSSE signature. Throws on any failure.
  //    NOTE ON THE POLICY: @sigstore/verify matches a STRING SAN policy with
  //    `signerIdentity.match(policyIdentity)` — an UNANCHORED REGULAR EXPRESSION. A builder URL is full
  //    of regex metacharacters (`.`, `+`, `/`), so a plain string policy is a weaker check than it
  //    reads: a different SAN that merely contains a matching substring would pass. Anchor and escape
  //    the pattern, AND re-compare the returned identity with strict equality. Either alone would
  //    probably do; both is cheap, and this is an authority boundary.
  let signerIdentity: string | undefined;
  try {
    const anchored = new RegExp(`^${input.expectation.builderIdentity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
    const outcome = new Verifier(input.trustMaterial).verify(toSignedEntity(bundle), {
      subjectAlternativeName: anchored,
      extensions: { issuer: GITHUB_OIDC_ISSUER }
    }) as { identity?: { subjectAlternativeName?: string } };
    signerIdentity = outcome?.identity?.subjectAlternativeName;
  } catch (error) {
    return { ok: false, reason: "attestation-invalid", detail: error instanceof Error ? `${error.constructor.name}: ${error.message}` : undefined };
  }
  if (signerIdentity !== input.expectation.builderIdentity) {
    return { ok: false, reason: "builder-identity-mismatch", detail: "certificate SAN is not exactly the expected builder identity" };
  }

  // 2. Extract the signed statement.
  const dsse = bundle.content?.$case === "dsseEnvelope" ? bundle.content.dsseEnvelope : undefined;
  if (!dsse) return { ok: false, reason: "attestation-not-dsse" };
  let statement: InTotoStatement;
  try {
    statement = JSON.parse(Buffer.from(dsse.payload).toString("utf8")) as InTotoStatement;
  } catch {
    return { ok: false, reason: "attestation-statement-unparseable" };
  }

  // 3. THE BINDING THE LIBRARY DOES NOT MAKE. Without this the attestation proves something true about
  //    a document we never looked at.
  const documentSha256 = sha256(input.documentBytes);
  const subjectName = subjectCoversDocument(statement, documentSha256);
  if (!subjectName) return { ok: false, reason: "attestation-subject-mismatch", detail: "no signed subject matches this document" };

  // 4. The predicate must independently agree with what the document claims.
  const builderId = statement.predicate?.runDetails?.builder?.id;
  if (builderId !== input.expectation.builderIdentity) return { ok: false, reason: "builder-identity-mismatch" };
  const runnerEnvironment = statement.predicate?.buildDefinition?.internalParameters?.github?.runner_environment;
  if (runnerEnvironment !== input.expectation.runnerEnvironment) return { ok: false, reason: "builder-runner-mismatch" };
  const commits = (statement.predicate?.buildDefinition?.resolvedDependencies || []).map((entry) => entry.digest?.gitCommit).filter((value): value is string => typeof value === "string");
  if (!commits.includes(input.expectation.sourceCommit)) return { ok: false, reason: "source-commit-mismatch" };

  return { ok: true, facts: { builderIdentity: builderId, runnerEnvironment, sourceCommit: input.expectation.sourceCommit, documentSha256, subjectName } };
}
