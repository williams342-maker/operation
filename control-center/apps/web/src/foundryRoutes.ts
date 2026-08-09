// Foundry URL routing. The platform has no router library and a strong custom
// navigation convention, so Foundry uses a tiny, testable path parser over the
// History API rather than retrofitting a router into the shell. Only /foundry*
// paths are Foundry's; everything else falls through to the existing app.

export const FOUNDRY_BASE = "/foundry";

export type FoundryRoute =
  | { kind: "landing" }
  | { kind: "new" }
  | { kind: "projects" }
  | { kind: "project"; workflowId: string };

const WORKFLOW_ID = /^[a-f0-9]{24}$/i; // Mongo ObjectId hex

// Returns the Foundry route for a pathname, or null when the path is not a
// Foundry path (so the caller keeps existing behavior). An unknown /foundry/*
// path resolves to the landing rather than 404-ing the user out of the product.
export function parseFoundryPath(pathname: string): FoundryRoute | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path !== FOUNDRY_BASE && !path.startsWith(`${FOUNDRY_BASE}/`)) return null;
  if (path === FOUNDRY_BASE) return { kind: "landing" };
  if (path === `${FOUNDRY_BASE}/new`) return { kind: "new" };
  if (path === `${FOUNDRY_BASE}/projects`) return { kind: "projects" };
  const match = path.match(/^\/foundry\/projects\/([^/]+)$/);
  if (match && WORKFLOW_ID.test(match[1])) return { kind: "project", workflowId: match[1] };
  return { kind: "landing" };
}

export function foundryPath(route: FoundryRoute): string {
  switch (route.kind) {
    case "landing": return FOUNDRY_BASE;
    case "new": return `${FOUNDRY_BASE}/new`;
    case "projects": return `${FOUNDRY_BASE}/projects`;
    case "project": return `${FOUNDRY_BASE}/projects/${route.workflowId}`;
  }
}
