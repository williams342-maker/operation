import { Badge, Button, Card, GhostButton } from "./ui";

export type DeploymentWorkflowState = "draft" | "pending_approval" | "queued" | "running" | "succeeded" | "failed" | "rolled_back";
export function ConfigurationDeploymentWorkflow({ environmentKind, protectedEnvironment, state = "draft", onPlan }: { environmentKind?: string; protectedEnvironment?: boolean; state?: DeploymentWorkflowState; onPlan?: () => void }) {
  const unavailable = protectedEnvironment || environmentKind === "production" || !environmentKind;
  const tone = state === "succeeded" ? "success" : state === "failed" || state === "rolled_back" ? "danger" : state === "draft" ? "neutral" : "warning";
  return <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Controlled configuration deployment</h3><p className="mt-1 text-sm text-muted">A separate approver reviews an immutable plan. The agent backs up the file, recreates only allowlisted stateless services, verifies health, and rolls back automatically on failure.</p></div><Badge tone={unavailable ? "danger" : tone}>{unavailable ? "Production unavailable" : state.replace(/_/g, " ")}</Badge></div>
    <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><li>1. Review typed plan</li><li>2. Independent approval</li><li>3. Backup and apply</li><li>4. Health verification</li><li>5. Success or rollback</li></ol>
    <div className="mt-4 flex flex-wrap gap-2"><Button disabled={unavailable || state !== "draft"} onClick={onPlan}>Create immutable plan</Button><GhostButton disabled={state !== "pending_approval"}>Approve as different administrator</GhostButton><GhostButton disabled={!(["failed", "succeeded"] as DeploymentWorkflowState[]).includes(state)}>Request rollback</GhostButton></div>
    <p className="mt-3 text-xs text-muted" aria-live="polite">Progress is value-free. Secret values, file contents, command output, and credentials are never shown.</p>
  </Card>;
}
