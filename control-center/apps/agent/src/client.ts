import crypto from "node:crypto";
import { agentSigningKey, signRequest } from "@control-center/shared";
import type { AgentConfig } from "./config.js";

export function machineAccessHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const clientId = env.CF_ACCESS_CLIENT_ID?.trim();
  const clientSecret = env.CF_ACCESS_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error("Cloudflare Access service-token configuration is incomplete");
  }
  return clientId && clientSecret
    ? { "CF-Access-Client-Id": clientId, "CF-Access-Client-Secret": clientSecret }
    : {};
}

export async function signedPost(config: AgentConfig, path: string, body: unknown) {
  const bodyText = JSON.stringify(body);
  if (Buffer.byteLength(bodyText) > 1024 * 1024) throw new Error("Agent payload exceeds the 1 MB protocol limit");
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(18).toString("base64url");
  const signature = signRequest(agentSigningKey(config.agentSecret), { method: "POST", path, timestamp, nonce, body: bodyText });
  const response = await fetch(`${config.controlCenterUrl}${path}`, {
    method: "POST",
    headers: {
      ...machineAccessHeaders(),
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

export async function enroll(controlCenterUrl: string, enrollmentToken: string, metadata: Record<string, unknown>) {
  const response = await fetch(`${controlCenterUrl}/api/agent/enroll`, {
    method: "POST",
    headers: { ...machineAccessHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ enrollmentToken, ...metadata })
  });
  if (!response.ok) throw new Error(`Enrollment failed with ${response.status}`);
  return response.json() as Promise<{ agentId: string; agentSecret: string; serverId: string; pollIntervalSeconds: number }>;
}
