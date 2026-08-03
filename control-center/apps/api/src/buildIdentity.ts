import fs from "node:fs";

// Runtime build identity (gap G2). Historically the app reported version/commit/branch from free-form
// build-time environment variables (BUILD_VERSION / GIT_COMMIT / GIT_BRANCH). Those are self-declared and
// attest nothing — the same mechanism by which production reported commit `16e14682`, a commit that exists
// in no git object database.
//
// resolveBuildIdentity() BINDS the reported identity to the shipped, attested release manifest when one is
// present: if CONTROL_CENTER_RELEASE_MANIFEST points at a valid `opsworkbench-release-v1` manifest (the
// artifact produced by build-release-artifacts.sh and covered by the SLSA build-provenance attestation),
// the reported commit/version come from it and `source` is "manifest". Otherwise it falls back to the env
// values with `source` "env" — identical to the previous behavior, so current deploys are unaffected.
//
// This is backward-compatible and inert: deployments without a shipped manifest behave exactly as before
// (plus an explicit `source: "env"`). It does not force any behavior and touches no production configuration.

export interface BuildIdentity {
  version: string;
  commit: string;
  branch: string;
  node: string;
  source: "manifest" | "env";
}

const RELEASE_MANIFEST_SCHEMA = "opsworkbench-release-v1";

export function resolveBuildIdentity(env: NodeJS.ProcessEnv = process.env): BuildIdentity {
  const node = process.version;
  const manifestPath = env.CONTROL_CENTER_RELEASE_MANIFEST;
  if (manifestPath) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const tagIsValid = typeof manifest.tag === "string" && manifest.tag.startsWith("v") && manifest.tag.length > 1;
      const commitIsValid = /^[0-9a-f]{40}$/.test(manifest.commit || "");
      if (manifest.schemaVersion === RELEASE_MANIFEST_SCHEMA && tagIsValid && commitIsValid) {
        return {
          version: manifest.tag.slice(1),
          commit: manifest.commit,
          branch: env.GIT_BRANCH || "unknown",
          node,
          source: "manifest",
        };
      }
    } catch {
      // Malformed/absent manifest — fall through to the environment values (defensive, never throws).
    }
  }
  return {
    version: env.BUILD_VERSION || "development",
    commit: env.GIT_COMMIT || "unknown",
    branch: env.GIT_BRANCH || "unknown",
    node,
    source: "env",
  };
}
