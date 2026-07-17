export type Role = "Owner" | "Administrator" | "Developer" | "Viewer";

export type Permission =
  | "org:manage"
  | "users:manage"
  | "servers:enroll"
  | "servers:manage"
  | "projects:manage"
  | "status:view"
  | "audit:view";

const rolePermissions: Record<Role, Permission[]> = {
  Owner: ["org:manage", "users:manage", "servers:enroll", "servers:manage", "projects:manage", "status:view", "audit:view"],
  Administrator: ["users:manage", "servers:enroll", "servers:manage", "projects:manage", "status:view", "audit:view"],
  Developer: ["projects:manage", "status:view"],
  Viewer: ["status:view"]
};

export function hasPermission(role: Role, permission: Permission) {
  return rolePermissions[role]?.includes(permission) ?? false;
}

export function requirePermission(role: Role, permission: Permission) {
  if (!hasPermission(role, permission)) {
    throw new Error(`Missing permission: ${permission}`);
  }
}
