export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.denied"
  | "enrollment.create"
  | "enrollment.success"
  | "enrollment.failure"
  | "server.create"
  | "project.create"
  | "project.update"
  | "agent.credential.revoke"
  | "agent.credential.rotate"
  | "authorization.failure";

export type AuditResult = "success" | "failure" | "denied";
