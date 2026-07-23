import type { AgentConfig } from "./config.js";

export function shouldEnroll(config: AgentConfig, token?: string, force?: string) {
  if (!token) return false;
  const forced = /^(1|true|yes)$/i.test(force || "");
  return forced || !config.agentId || !config.agentSecret;
}
