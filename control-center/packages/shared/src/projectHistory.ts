export const projectDeploymentStates = ["planned", "approved", "preparing", "activating", "validating", "succeeded", "failed", "rolled_back", "cancelled"] as const;
export type ProjectDeploymentState = typeof projectDeploymentStates[number];
export const projectRollbackStates = ["planned", "preparing", "restoring", "validating", "succeeded", "failed", "cancelled"] as const;
export type ProjectRollbackState = typeof projectRollbackStates[number];
export type ProjectValidationResult = { health: "passed" | "failed" | "not_run"; readiness: "passed" | "failed" | "not_run"; checkedAt?: string };

const deploymentTransitions: Record<ProjectDeploymentState, readonly ProjectDeploymentState[]> = {
  planned: ["approved", "cancelled"], approved: ["preparing", "cancelled"], preparing: ["activating", "failed", "cancelled"],
  activating: ["validating", "failed"], validating: ["succeeded", "failed", "rolled_back"], succeeded: ["rolled_back"], failed: ["rolled_back"], rolled_back: [], cancelled: []
};
const rollbackTransitions: Record<ProjectRollbackState, readonly ProjectRollbackState[]> = {
  planned: ["preparing", "cancelled"], preparing: ["restoring", "failed", "cancelled"], restoring: ["validating", "failed"], validating: ["succeeded", "failed"], succeeded: [], failed: [], cancelled: []
};
function transition<T extends string>(current: T, next: T, allowed: Record<T, readonly T[]>) {
  if (current === next) return current;
  if (!allowed[current].includes(next)) throw new Error(`Invalid lifecycle transition: ${current} -> ${next}`);
  return next;
}
export const transitionProjectDeployment = (current: ProjectDeploymentState, next: ProjectDeploymentState) => transition(current, next, deploymentTransitions);
export const transitionProjectRollback = (current: ProjectRollbackState, next: ProjectRollbackState) => transition(current, next, rollbackTransitions);

export type ProjectDeploymentHistoryItem = { id: string; projectId: string; server: { id: string; name?: string }; environment: string; requestedRevision: string; deployedRevision?: string; branch?: string; artifactDigest?: string; releaseId?: string; taskId: string; actor?: { id: string }; status: ProjectDeploymentState; startedAt?: string; completedAt?: string; validation: ProjectValidationResult; rollbackAvailable: boolean; evidenceConfidence: "verified" | "reported"; failureClassification?: string; createdAt: string };
export type ProjectRollbackHistoryItem = { id: string; projectId: string; server: { id: string; name?: string }; sourceDeploymentId: string; restoredDeploymentId?: string; restoredReleaseId?: string; taskId: string; actor?: { id: string }; reasonClassification: string; status: ProjectRollbackState; startedAt?: string; completedAt?: string; verification: ProjectValidationResult; failureClassification?: string; createdAt: string };
export type ProjectHistoryResponse<T> = { project: { id: string; name: string; archived: boolean }; records: T[]; limit: number; hasMore: boolean };
