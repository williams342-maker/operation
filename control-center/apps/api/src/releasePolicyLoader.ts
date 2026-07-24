import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { releasePolicySchema } from "@control-center/shared";

const bundledPolicyPath = fileURLToPath(new URL("../../../release/policies/Staging-BurnIn-v1.policy.json", import.meta.url));

export function loadStagingReleasePolicy(policyPath = process.env.CONTROL_CENTER_RELEASE_POLICY_PATH || bundledPolicyPath) {
  return releasePolicySchema.parse(JSON.parse(fs.readFileSync(policyPath, "utf8")));
}
