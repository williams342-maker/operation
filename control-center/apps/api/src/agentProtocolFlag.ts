// Global kill-switch for the agent-v2 asymmetric credential protocol. DISABLED unless the operator
// explicitly sets CONTROL_CENTER_AGENT_PROTOCOL_V2=true. While disabled, the control plane behaves
// exactly as agent-v1 (legacy) and rejects v2 enrollment/auth attempts rather than silently
// downgrading. Read at call time so tests and staging can toggle it per process.
export function agentV2Enabled(): boolean {
  return process.env.CONTROL_CENTER_AGENT_PROTOCOL_V2 === "true";
}
