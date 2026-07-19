import crypto from "node:crypto";
import path from "node:path";
import { deployableEnvironmentKinds, deploymentCapabilities, encryptedValueBundleSchema, isCompatibleAgentVersion, minimumDeploymentAgentVersion } from "@control-center/shared";

export type DeploymentTarget = { environmentKind: string; protected: boolean; repositoryRoot: string; environmentFilePath: string; composePath: string; statelessServices: string[]; protectedServices: string[] };

export function assertDeploymentPolicy(target: DeploymentTarget, capabilities: string[], agentVersion?: string) {
  if (target.protected || !(deployableEnvironmentKinds as readonly string[]).includes(target.environmentKind)) throw new Error("Production configuration deployment is unavailable");
  if (!isCompatibleAgentVersion(agentVersion)) throw new Error(`Agent version must be stable and at least ${minimumDeploymentAgentVersion}`);
  if (!deploymentCapabilities.every((item) => capabilities.includes(item))) throw new Error("Agent deployment capabilities are missing or incomplete");
  const root = path.resolve(target.repositoryRoot);
  for (const candidate of [target.environmentFilePath, target.composePath]) { const resolved = path.resolve(candidate); if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) throw new Error("Deployment target escapes repository root"); }
  const protectedSet = new Set(target.protectedServices);
  if (!target.statelessServices.length || target.statelessServices.some((service) => protectedSet.has(service))) throw new Error("Stateful or protected service cannot be recreated");
}

export function encryptDeploymentValues(values: Record<string, string>, serverSigningKey: string) {
  const key = crypto.createHash("sha256").update(`configuration-deployment:${serverSigningKey}`).digest(); const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values)), cipher.final()]);
  return encryptedValueBundleSchema.parse({ algorithm: "aes-256-gcm", ciphertext: ciphertext.toString("base64"), nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyVersion: "agent-signing-v1" });
}

export function assertApproverSeparation(createdBy: string, approvedBy: string) { if (createdBy === approvedBy) throw new Error("Deployment creator cannot approve the same plan"); }
