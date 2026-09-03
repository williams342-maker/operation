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
  // Layer 3. Absent is fine while this executor is DISABLED; absent while it is ENFORCING is a startup
  // failure, because losing configuration must not silently turn enforcement off.
  //
  // NOTE WHAT IS NOT HERE: the state directory. It used to be a field, and an independent review showed
  // that made enforcement caller-selectable — `executeTask({...config, stateDir: emptyDir}, task)`
  // resolved advisory on a host whose real record said ENFORCING. Removing the third argument had only
  // moved the caller-controlled input, not removed it. The location is now a property of the PROCESS
  // (see `stateDir()` below), and no argument can move it.
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
 * Where durable executor state lives: the review-enforcement record and the execution journal.
 *
 * DERIVED FROM THE PROCESS, never from an argument. `configPath` is a module constant resolved once at
 * load from `CONTROL_CENTER_AGENT_CONFIG` (or the working directory), so a caller holding an
 * `AgentConfig` object cannot point enforcement at a different record. That is the whole reason this is
 * a function of nothing rather than a config field — the previous shape let any caller of `executeTask`
 * choose which durable record was authoritative, which is not a boundary at all.
 *
 * WHAT THIS DOES AND DOES NOT DEFEND, stated exactly — and the wording here has been tightened once
 * already, because "resists configuration substitution" was itself an overclaim.
 *
 * It resists substitution of the parsed `AgentConfig` OBJECT after process initialization: no caller of
 * `executeTask`, however it builds its argument, can move the record that decides whether this executor
 * enforces.
 *
 * It does NOT resist a different process ENVIRONMENT. Launching the agent with
 * `CONTROL_CENTER_AGENT_CONFIG` pointing elsewhere selects a different config file and, with it, a
 * different state directory — where an absent record reads as DISABLED. Nor does it resist arbitrary code
 * inside this process, which can call the deployment functions directly and never reach the executor at
 * all, nor write access to the host, which can edit the record or the config file.
 *
 * All three of those require host control. Activation resists a compromised control-center. It does not
 * resist a compromised host, and nothing in this file should be read as claiming otherwise.
 *
 * Beside the configuration file rather than under the working directory, because a service's working
 * directory is an accident of how it was started.
 */
export function stateDir(): string {
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
