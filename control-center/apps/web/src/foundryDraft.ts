// Preserves a build prompt while the visitor moves from the landing page through
// sign-in into the workspace. Stored in sessionStorage (per-tab, cleared on
// close) — never sent anywhere until the user is authenticated and explicitly
// creates a project via the secured /website-builder/workflows/from-prompt route.
// The prompt is intentionally NOT recorded in analytics; only inside the workflow.

const DRAFT_KEY = "foundry.draftPrompt";

export function saveDraftPrompt(prompt: string): void {

  try {
    sessionStorage.setItem(DRAFT_KEY, prompt.slice(0, 4000));
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
  fallbackRequest = undefined;
  try {
    sessionStorage.removeItem(DRAFT_KEY);
    sessionStorage.removeItem("foundry.request");
  } catch {
    /* ignore */
  }
}

export function activateDraftScope(scope: string): void {
  try {
    const previous = sessionStorage.getItem("foundry.draftScope");
    if (previous && previous !== scope) {
      clearDraftPrompt();
      Object.keys(sessionStorage).filter(key => key.startsWith("foundry.brief.")).forEach(key => sessionStorage.removeItem(key));
    }
    sessionStorage.setItem("foundry.draftScope", scope);
  } catch { /* in-memory compose remains available */ }
}

let fallbackRequest: { prompt: string; key: string } | undefined;
export function draftRequestKey(prompt: string): string {
  let stored = fallbackRequest;
  try { stored = JSON.parse(sessionStorage.getItem("foundry.request") || "null") || stored; } catch { /* per-tab fallback */ }
  if (!stored || stored.prompt !== prompt) stored = { prompt, key: crypto.randomUUID() };
  fallbackRequest = stored;
  try { sessionStorage.setItem("foundry.request", JSON.stringify(stored)); } catch { /* retry remains stable in memory */ }
  return stored.key;
}
