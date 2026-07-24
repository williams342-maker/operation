import fs from "node:fs";
import path from "node:path";
import { agentUpgradeManifestSchema, agentUpgradePlanDigest, type AgentUpgradeManifest } from "@control-center/shared";
import type { AgentConfig } from "./config.js";

export const updaterInbox = "/var/lib/opsworkbench-agent/updater-inbox";

export function handoffUpgrade(config: AgentConfig, raw: unknown, taskServerId: string, taskId: string, inbox = updaterInbox, agentState = "/var/lib/opsworkbench-agent/agent") {
  const manifest = agentUpgradeManifestSchema.parse(raw);
  const { planDigest, ...unsigned } = manifest;
  if (agentUpgradePlanDigest(unsigned) !== planDigest) throw new Error("Upgrade plan digest mismatch");
  if (!config.serverId || manifest.serverId !== config.serverId || taskServerId !== config.serverId) throw new Error("Upgrade manifest assigned to a different server");
  if (manifest.expectedAgentId !== config.agentId) throw new Error("Upgrade manifest assigned to a different agent");
  if (manifest.expectedCurrentVersion !== config.agentVersion) throw new Error("Agent version changed after upgrade planning");
  if (Date.parse(manifest.expiresAt) <= Date.now()) throw new Error("Upgrade manifest expired");
  fs.mkdirSync(inbox, { recursive: true, mode: 0o730 });
  const target = path.join(inbox, `${manifest.upgradeId}.json`);
  const fd = fs.openSync(target, "wx", 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(manifest)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.mkdirSync(agentState, { recursive: true, mode: 0o750 });
  fs.writeFileSync(path.join(agentState, `${manifest.upgradeId}.task.json`), `${JSON.stringify({ taskId, upgradeId: manifest.upgradeId })}\n`, { mode: 0o600, flag: "wx" });
  return { phase: "queued", upgradeId: manifest.upgradeId } as const;
}

export function readUpgradeManifest(file: string): AgentUpgradeManifest { return agentUpgradeManifestSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))); }
