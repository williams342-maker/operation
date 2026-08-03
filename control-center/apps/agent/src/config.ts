import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const agentConfigSchema = z.object({
  controlCenterUrl: z.string().url(),
  installationId: z.string().default(""),
  requestedSlug: z.string().default(""),
  agentId: z.string(),
  agentSecret: z.string(),
  // agent-v2 asymmetric credential material (optional; present only for v2-enrolled agents). Private
  // keys are stored agent-side at 0600 and never transmitted. controlPlanePublicKey is the Ed25519
  // public key used to verify control-plane task envelopes.
  keyProtocolVersion: z.enum(["agent-v1", "agent-v2"]).default("agent-v1"),
  signingPrivateKey: z.string().optional(),
  encryptionPrivateKey: z.string().optional(),
  controlPlanePublicKey: z.string().optional(),
  // Owner PUBLIC verification key (offline owner key's public half, delivered via bootstrap). When set,
  // privileged tasks must additionally carry a valid owner authorization. Independent of the transport key.
  ownerPublicKey: z.string().optional(),
  serverId: z.string().default(""),
  agentVersion: z.string().default("0.1.0"),
  protocolVersion: z.string().default("task-v1"),
  packageType: z.enum(["tar", "deb", "rpm"]).default("tar"),
  releaseChannel: z.enum(["stable", "candidate", "preview"]).default("stable"),
  binarySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  allowedRoots: z.array(z.string()).default([]),
  pollIntervalSeconds: z.number().int().min(10).max(3600).default(30),
  mongoChecks: z.record(z.string()).default({})
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

const configPath = process.env.CONTROL_CENTER_AGENT_CONFIG || path.resolve(process.cwd(), "agent.local.json");

export function loadConfig() {
  const fallback = path.resolve(process.cwd(), "agent.example.json");
  const file = fs.existsSync(configPath) ? configPath : fallback;
  return agentConfigSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function saveConfig(config: AgentConfig) {
  fs.writeFileSync(configPath, `${JSON.stringify(agentConfigSchema.parse(config), null, 2)}\n`, { mode: 0o600 });
}
