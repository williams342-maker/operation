import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const schema = z.object({
  controlCenterUrl: z.string().url(),
  agentId: z.string(),
  agentSecret: z.string(),
  agentVersion: z.string().default("0.1.0"),
  allowedRoots: z.array(z.string()).default([]),
  pollIntervalSeconds: z.number().int().min(10).max(3600).default(30),
  mongoChecks: z.record(z.string()).default({})
});

export type AgentConfig = z.infer<typeof schema>;

const configPath = process.env.CONTROL_CENTER_AGENT_CONFIG || path.resolve(process.cwd(), "agent.local.json");

export function loadConfig() {
  const fallback = path.resolve(process.cwd(), "agent.example.json");
  const file = fs.existsSync(configPath) ? configPath : fallback;
  return schema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function saveConfig(config: AgentConfig) {
  fs.writeFileSync(configPath, `${JSON.stringify(schema.parse(config), null, 2)}\n`, { mode: 0o600 });
}
