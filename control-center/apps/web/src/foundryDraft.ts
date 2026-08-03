// Preserves a build prompt while the visitor moves from the landing page through
// sign-in into the workspace. Stored in sessionStorage (per-tab, cleared on
// close) — never sent anywhere until the user is authenticated and explicitly
// creates a project via the secured /website-builder/workflows/from-prompt route.
// The prompt is intentionally NOT recorded in analytics; only inside the workflow.

const DRAFT_KEY = "foundry.draftPrompt";

export function saveDraftPrompt(prompt: string): void {
  const trimmed = prompt.trim();
  try {
    if (trimmed) sessionStorage.setItem(DRAFT_KEY, trimmed.slice(0, 4000));
  } catch {
    /* sessionStorage may be unavailable; the composer still works without preservation */
  }
}

export function readDraftPrompt(): string {
  try {
    return sessionStorage.getItem(DRAFT_KEY) || "";
  } catch {
    return "";
  }
}

export function clearDraftPrompt(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
