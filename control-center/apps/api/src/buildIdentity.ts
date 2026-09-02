import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Runtime build identity (gap G2, work-order item W2).
//
// Historically the app reported version/commit/branch from free-form build-time environment variables
// (BUILD_VERSION / GIT_COMMIT / GIT_BRANCH). Those are self-declared and attest nothing — the same
// mechanism by which production reported commit `16e14682`, a commit that exists in no git object
// database.
//
// Two changes here, both aimed at the same thing: stop reporting an assertion as if it were a fact.
//
// 1. IT FAILS CLOSED. Previously every failure path — missing file, malformed JSON, wrong schema, bad
//    commit — fell back to the environment values and reported `source: "env"`. That made "a release
//    manifest was configured and is broken" indistinguishable from "no release manifest was
//    configured", and answered both with a string somebody typed at build time. A configured manifest
//    that does not validate now yields `source: "unverified"` and an explicit `unknown` identity. The
//    environment path remains only for the case where no manifest was ever configured, which is
//    development.
//
// 2. IT MEASURES THE RUNNING CODE. `runtimeDigest` is a SHA-256 over the FIRST-PARTY emitted
//    JavaScript - this app's `dist` and the shared package's `dist` - computed at startup. It is the only value in this module that is measured rather
//    than declared, and it is reported unconditionally so two hosts claiming the same commit can be
//    compared even before any manifest carries the expectation. When a manifest declares
//    `runtimeSha256`, a mismatch is fatal to the claim: the identity degrades to `unverified`.
//
// WHAT THIS STILL DOES NOT DO, stated plainly so the next reader does not over-trust it: it performs no
// cryptographic verification. It does not check the SLSA build-provenance attestation that covers the
// release bundle, so a manifest with a valid shape and a matching runtime digest still proves only
// internal consistency, not provenance. Attestation verification requires a Sigstore verifier and a
// pinned trusted root; that work exists but is parked and uncertified — see
// docs/forge-chain-status-20260901.md.

export interface BuildIdentity {
  version: string;
  commit: string;
  branch: string;
  node: string;
  source: "manifest" | "env" | "unverified";
  /** SHA-256 over the runtime files this process loaded. Measured, never supplied. */
  runtimeDigest?: string;
}

const RELEASE_MANIFEST_SCHEMA = "opsworkbench-release-v1";
const RUNTIME_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

function collectRuntimeFiles(root: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) collectRuntimeFiles(full, found);
    else if (RUNTIME_EXTENSIONS.has(path.extname(entry.name))) found.push(full);
  }
  return found;
}

/**
 * SHA-256 over the emitted JavaScript under one or more roots, or undefined when nothing can be
 * measured (development under tsx, where there is no build output to hash).
 *
 * The file list is sorted and each file contributes its relative path as well as its bytes, so moving
 * code between files changes the digest even when the total bytes do not. Each root is prefixed by its
 * index, so identical files under different roots cannot collide.
 *
 * SCOPE, stated because a digest invites more trust than it earns: this covers FIRST-PARTY build output
 * only — this application's `dist` and the shared package's `dist`. It does not cover `node_modules`,
 * the Node binary, or anything else on the host. It answers "is this the same first-party build?", not
 * "is this the same machine state?".
 */
export function measureRuntimeDigest(runtimeRoot: string | string[]): string | undefined {
  const roots = Array.isArray(runtimeRoot) ? runtimeRoot : [runtimeRoot];
  const hash = crypto.createHash("sha256");
  let measured = 0;
  for (const [index, root] of roots.entries()) {
    let files: string[];
    try {
      if (!fs.statSync(root).isDirectory()) continue;
      files = collectRuntimeFiles(root);
    } catch {
      continue;
    }
    if (!files.length) continue;
    hash.update(`root:${index}\0`);
    for (const file of files) {
      hash.update(path.relative(root, file).split(path.sep).join("/"));
      hash.update("\0");
      try {
        hash.update(fs.readFileSync(file));
      } catch {
        return undefined; // A file we listed but cannot read means the measurement is incomplete.
      }
      hash.update("\0");
    }
    measured += files.length;
  }
  return measured ? hash.digest("hex") : undefined;
}

/**
 * First-party build output: this app's own emitted JavaScript plus the shared package's. Shared carries
 * the protocol and schemas, so a change there changes behaviour and must move the digest.
 */
function firstPartyRuntimeRoots(): string[] {
  const own = path.resolve(import.meta.dirname);
  const roots = [own];
  for (const candidate of [
    path.resolve(own, "..", "..", "..", "packages", "shared", "dist"),
    path.resolve(own, "..", "..", "..", "node_modules", "@control-center", "shared", "dist")
  ]) {
    if (fs.existsSync(candidate)) { roots.push(candidate); break; }
  }
  return roots;
}

// Measured once at module load. The digest cannot change without restarting the process, and hashing on
// every /healthz call would turn an unauthenticated endpoint into a disk-read amplifier.
const runtimeDigest = measureRuntimeDigest(firstPartyRuntimeRoots());

const unknownIdentity = (branch: string, digest?: string): BuildIdentity => ({
  version: "unknown",
  commit: "unknown",
  branch,
  node: process.version,
  source: "unverified",
  ...(digest ? { runtimeDigest: digest } : {})
});

// `digest` distinguishes three cases deliberately: omitted means "use the module's own measurement",
// an explicit string overrides it, and explicit `null` means "measurement was attempted and failed".
// A default parameter cannot express the third, because passing `undefined` selects the default — which
// made the unmeasurable case impossible to exercise, and therefore impossible to trust.
export function resolveBuildIdentity(env: NodeJS.ProcessEnv = process.env, digest: string | null | undefined = runtimeDigest): BuildIdentity {
  const measured = digest ?? undefined;
  const node = process.version;
  const branch = env.GIT_BRANCH || "unknown";
  const manifestPath = env.CONTROL_CENTER_RELEASE_MANIFEST;

  if (!manifestPath) {
    // No manifest was ever configured. This is the development path, and it is honest about being one:
    // `source: "env"` means "these values were typed, not verified".
    return {
      version: env.BUILD_VERSION || "development",
      commit: env.GIT_COMMIT || "unknown",
      branch,
      node,
      source: "env",
      ...(measured ? { runtimeDigest: measured } : {})
    };
  }

  // From here a manifest was configured, so anything short of a valid one is a FAILURE, not a licence to
  // fall back to values an operator typed.
  let manifest: { schemaVersion?: unknown; tag?: unknown; commit?: unknown; runtimeSha256?: unknown };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return unknownIdentity(branch, measured);
  }

  const tagIsValid = typeof manifest.tag === "string" && manifest.tag.startsWith("v") && manifest.tag.length > 1;
  const commitIsValid = typeof manifest.commit === "string" && /^[0-9a-f]{40}$/.test(manifest.commit);
  if (manifest.schemaVersion !== RELEASE_MANIFEST_SCHEMA || !tagIsValid || !commitIsValid) {
    return unknownIdentity(branch, measured);
  }

  // If the manifest states what the running code should be, that claim is checked. An expectation that
  // cannot be evaluated — because the digest could not be measured — is also a failure: an unverifiable
  // claim must not read as a verified one.
  if (typeof manifest.runtimeSha256 === "string") {
    if (!/^[a-f0-9]{64}$/.test(manifest.runtimeSha256) || !measured || manifest.runtimeSha256 !== measured) {
      return unknownIdentity(branch, measured);
    }
  }

  return {
    version: (manifest.tag as string).slice(1),
    commit: manifest.commit as string,
    branch,
    node,
    source: "manifest",
    ...(measured ? { runtimeDigest: measured } : {})
  };
}
