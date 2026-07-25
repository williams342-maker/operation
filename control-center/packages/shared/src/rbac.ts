export type Role = "Owner" | "Administrator" | "Developer" | "Viewer";

export type Permission =
  | "org:manage"
  | "users:manage"
  | "servers:enroll"
  | "servers:manage"
  | "projects:manage"
  | "status:view"
  | "audit:view"
  | "audit:manage"
  | "ai:use"
  | "ai:admin"
  | "tasks:view"
  | "tasks:run"
  | "tasks:cancel"
  | "configuration:view"
  | "configuration:edit-public"
  | "secrets:create"
  | "secrets:replace"
  | "agent:update"
  | "configuration:validate"
  | "configuration:view-history"
  | "configuration:manage-integrations"
  | "configuration:deploy-non-production"
  | "configuration:approve-non-production"
  | "marketing:view"
  | "marketing:manage"
  | "marketing:connect-accounts"
  | "marketing:import"
  | "marketing:export"
  | "marketing:manage-goals"
  | "marketing:manage-settings"
  | "marketing:generate-insights";

const rolePermissions: Record<Role, Permission[]> = {
  Owner: ["org:manage", "users:manage", "servers:enroll", "servers:manage", "projects:manage", "status:view", "audit:view", "audit:manage", "ai:use", "ai:admin", "tasks:view", "tasks:run", "tasks:cancel", "configuration:view", "configuration:edit-public", "secrets:create", "secrets:replace", "agent:update", "configuration:validate", "configuration:view-history", "configuration:manage-integrations", "configuration:deploy-non-production", "configuration:approve-non-production", "marketing:view", "marketing:manage", "marketing:connect-accounts", "marketing:import", "marketing:export", "marketing:manage-goals", "marketing:manage-settings", "marketing:generate-insights"],
  Administrator: ["users:manage", "servers:enroll", "servers:manage", "projects:manage", "status:view", "audit:view", "audit:manage", "ai:use", "ai:admin", "tasks:view", "tasks:run", "tasks:cancel", "configuration:view", "configuration:edit-public", "secrets:create", "secrets:replace", "agent:update", "configuration:validate", "configuration:view-history", "configuration:manage-integrations", "configuration:deploy-non-production", "configuration:approve-non-production", "marketing:view", "marketing:manage", "marketing:connect-accounts", "marketing:import", "marketing:export", "marketing:manage-goals", "marketing:manage-settings", "marketing:generate-insights"],
  Developer: ["projects:manage", "status:view", "ai:use", "tasks:view", "tasks:run", "configuration:view", "configuration:edit-public", "configuration:validate", "configuration:view-history", "marketing:view", "marketing:import", "marketing:export"],
  Viewer: ["status:view", "ai:use", "tasks:view", "configuration:view", "marketing:view", "marketing:export"]
};

export function hasPermission(role: Role, permission: Permission) {
  return rolePermissions[role]?.includes(permission) ?? false;
}

export function requirePermission(role: Role, permission: Permission) {
  if (!hasPermission(role, permission)) {
    throw new Error(`Missing permission: ${permission}`);
  }
}
