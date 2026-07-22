import type { ObjectId } from "mongodb";
import type { CloudflareOnboarding } from "@control-center/shared";
import { collections } from "./db.js";
import { decryptConfigurationValue, encryptConfigurationValue } from "./configurationVault.js";
import type { ConnectivityConfigDoc } from "./models.js";

const binding = (orgId: ObjectId, serverId: ObjectId, field: string) => `connectivity:${orgId}:${serverId}:cloudflare:${field}`;

export async function storeCloudflareConnectivity(orgId: ObjectId, serverId: ObjectId, userId: ObjectId, input: CloudflareOnboarding) {
  const now = new Date();
  const existing = await collections.connectivityConfigs.findOne({ orgId, serverId, provider: "cloudflare" });
  const set: Record<string, unknown> = { enabled: input.enabled, tunnelEnabled: input.tunnel.enabled, accessEnabled: input.access.enabled, updatedByUserId: userId, updatedAt: now, version: (existing?.version || 0) + 1 };
  if (input.tunnel.token) set.tunnelToken = encryptConfigurationValue(input.tunnel.token, binding(orgId, serverId, "tunnelToken"));
  if (input.access.clientId) set.accessClientId = encryptConfigurationValue(input.access.clientId, binding(orgId, serverId, "accessClientId"));
  if (input.access.clientSecret) set.accessClientSecret = encryptConfigurationValue(input.access.clientSecret, binding(orgId, serverId, "accessClientSecret"));
  await collections.connectivityConfigs.updateOne({ orgId, serverId, provider: "cloudflare" }, { $set: set, $setOnInsert: { orgId, serverId, provider: "cloudflare", createdAt: now } }, { upsert: true });
}

export function safeConnectivity(config: ConnectivityConfigDoc | null) {
  if (!config) return null;
  return { provider: config.provider, enabled: config.enabled, tunnelEnabled: config.tunnelEnabled, accessEnabled: config.accessEnabled, secrets: { tunnelToken: config.tunnelToken ? "configured" : "not_configured", accessClientId: config.accessClientId ? "configured" : "not_configured", accessClientSecret: config.accessClientSecret ? "configured" : "not_configured" }, version: config.version, updatedAt: config.updatedAt };
}

export function revealConnectivity(config: ConnectivityConfigDoc) {
  return { provider: config.provider, enabled: config.enabled, tunnel: { enabled: config.tunnelEnabled, token: config.tunnelToken ? decryptConfigurationValue(config.tunnelToken, binding(config.orgId, config.serverId, "tunnelToken")) : undefined }, access: { enabled: config.accessEnabled, clientId: config.accessClientId ? decryptConfigurationValue(config.accessClientId, binding(config.orgId, config.serverId, "accessClientId")) : undefined, clientSecret: config.accessClientSecret ? decryptConfigurationValue(config.accessClientSecret, binding(config.orgId, config.serverId, "accessClientSecret")) : undefined } };
}
