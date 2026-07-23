export function runtimeIdentity() {
  return {
    version: process.env.BUILD_VERSION || "development",
    commit: process.env.CONTROL_CENTER_SOURCE_COMMIT || process.env.GIT_COMMIT || "unknown",
    branch: process.env.GIT_BRANCH || "unknown",
    node: process.version
  };
}
