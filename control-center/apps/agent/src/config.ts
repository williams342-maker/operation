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
  // Durable executor state: the review-enforcement record and the execution journal. A directory rather
  // than more fields in this file, because an executor's memory of what it has already applied must
  // survive losing or replacing its configuration.
  stateDir: z.string().default(""),
  // Layer 3. Absent is fine while this executor is DISABLED; absent while it is ENFORCING is a startup
  // failure, because losing configuration must not silently turn enforcement off.
  reviewGate: z.object({
    url: z.string().url(),
    credential: z.string().min(1),
    timeoutMs: z.number().int().min(100).max(30000).default(5000),
  }).strict().optional(),
  allowedRoots: z.array(z.string()).default([]),
  pollIntervalSeconds: z.number().int().min(10).max(3600).default(30),
  mongoChecks: z.record(z.string()).default({})
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

const configPath = process.env.CONTROL_CENTER_AGENT_CONFIG || path.resolve(process.cwd(), "agent.local.json");

/**
 * Where durable executor state lives when `stateDir` is not set.
 *
 * Beside the configuration file rather than under the working directory, because a service's working
 * directory is an accident of how it was started, and this directory is what stops an executor applying
 * the same action twice across a restart.
 */
export function defaultStateDir(): string {
  return path.join(path.dirname(configPath), "agent-state");
}

export function loadConfig() {
  const fallback = path.resolve(process.cwd(), "agent.example.json");
  const file = fs.existsSync(configPath) ? configPath : fallback;
  return agentConfigSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function saveConfig(config: AgentConfig) {
  fs.writeFileSync(configPath, `${JSON.stringify(agentConfigSchema.parse(config), null, 2)}\n`, { mode: 0o600 });
}
