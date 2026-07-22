import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const sha256Pattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;

export async function bootstrapArtifactMetadata() {
  const artifactPath = path.resolve(process.env.CONTROL_CENTER_AGENT_ARTIFACT_PATH || "/app/artifacts/opsworkbench-agent-source.tar.gz");
  const sourceCommit = process.env.CONTROL_CENTER_SOURCE_COMMIT || process.env.GIT_COMMIT || "";
  if (!commitPattern.test(sourceCommit)) throw new Error("Bootstrap artifact source commit is unavailable");
  const stat = await fs.promises.stat(artifactPath);
  if (!stat.isFile() || stat.size < 1) throw new Error("Bootstrap artifact is unavailable");
  const digest = await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(artifactPath).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")));
  });
  if (!sha256Pattern.test(digest)) throw new Error("Bootstrap artifact digest is invalid");
  return { artifactPath, sourceCommit, digest, size: stat.size };
}
