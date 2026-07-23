import assert from "node:assert/strict";
import test from "node:test";
import { runtimeIdentity } from "../src/runtimeIdentity.js";

function withEnv(values: Record<string, string | undefined>, callback: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("runtime identity prefers the immutable source commit over legacy Git metadata", () => {
  withEnv({
    BUILD_VERSION: "phase2-staging",
    CONTROL_CENTER_SOURCE_COMMIT: "264ee84588a48b9dbfcb22363c54a126398a09c3",
    GIT_COMMIT: "9312480658a49926b380b48fec2ba84ac4aa0601",
    GIT_BRANCH: "feat/project-deployment-history"
  }, () => {
    const identity = runtimeIdentity();
    assert.equal(identity.version, "phase2-staging");
    assert.equal(identity.commit, "264ee84588a48b9dbfcb22363c54a126398a09c3");
    assert.equal(identity.branch, "feat/project-deployment-history");
  });
});

test("runtime identity keeps the legacy Git commit fallback for non-container runs", () => {
  withEnv({
    CONTROL_CENTER_SOURCE_COMMIT: undefined,
    GIT_COMMIT: "73a1d83703277268cb1d120878f4288bd9fdea56"
  }, () => {
    assert.equal(runtimeIdentity().commit, "73a1d83703277268cb1d120878f4288bd9fdea56");
  });
});
