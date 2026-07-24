import fs from "node:fs";
import path from "node:path";
import { releasePolicyDigest, releasePolicySchema } from "../packages/shared/dist/index.js";

const policyPath = path.resolve(process.argv[2] || "release/policies/Staging-BurnIn-v1.policy.json");
const policy = releasePolicySchema.parse(JSON.parse(fs.readFileSync(policyPath, "utf8")));
const digest = releasePolicyDigest(policy);
const ownerKeyConfigured = policy.publication.ownerKeyId !== "OWNER_ED25519_KEY_ID_REQUIRED";

process.stdout.write(`${JSON.stringify({
  valid: true,
  policyId: policy.policyId,
  version: policy.version,
  policyDigest: digest,
  stagingProfile: policy.stagingProfile.name,
  ownerKeyConfigured,
  productionPublishEnabled: false,
  nextRequiredAction: ownerKeyConfigured ? "owner_sign_policy_digest_offline" : "set_owner_public_key_id_then_owner_sign_policy_digest_offline"
})}\n`);
