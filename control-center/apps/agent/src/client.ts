import crypto from "node:crypto";
import { agentSigningKey, signRequest } from "@control-center/shared";
import type { AgentConfig } from "./config.js";

export async function signedPost(config: AgentConfig, path: string, body: unknown) {
  const bodyText = JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(18).toString("base64url");
  const signature = signRequest(agentSigningKey(config.agentSecret), { method: "POST", path, timestamp, nonce, body: bodyText });
  const response = await fetch(`${config.controlCenterUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-id": config.agentId,
      "x-agent-timestamp": timestamp,
      "x-agent-nonce": nonce,
      "x-agent-signature": signature
    },
    body: bodyText
  });
  if (!response.ok) throw new Error(`Control center returned ${response.status}`);
  return response.json();
}

export async function enroll(controlCenterUrl: string, enrollmentToken: string, hostname: string, agentVersion: string) {
  const response = await fetch(`${controlCenterUrl}/api/agent/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enrollmentToken, hostname, agentVersion, capabilities: ["system", "docker", "compose", "git", "http", "mongo"] })
  });
  if (!response.ok) throw new Error(`Enrollment failed with ${response.status}`);
  return response.json() as Promise<{ agentId: string; agentSecret: string; serverId: string; pollIntervalSeconds: number }>;
}
