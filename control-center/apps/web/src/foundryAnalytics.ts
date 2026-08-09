// Privacy-conscious analytics for the Foundry landing→workspace journey.
//
// This records only funnel EVENTS, never content: prompt text is deliberately
// excluded (it lives only inside the secured workflow + audit trail). Metadata is
// limited to coarse, non-identifying fields (e.g. an example id, a boolean).
//
// The sink is pluggable and defaults to a no-op so nothing is transmitted until a
// real, privacy-reviewed sink is registered. This keeps a truthful seam without
// silently sending data or introducing a third-party dependency.

export type FoundryAnalyticsEvent =
  | "foundry_landing_viewed"
  | "foundry_hero_cta_clicked"
  | "foundry_example_selected"
  | "foundry_prompt_started"
  | "foundry_prompt_submitted"
  | "foundry_authentication_required"
  | "foundry_workspace_opened"
  | "foundry_workflow_created"
  | "foundry_preview_reached"
  | "foundry_suggestion_applied"
  | "foundry_flow_abandoned";

export type FoundryAnalyticsMeta = Record<string, string | number | boolean>;
type Sink = (event: FoundryAnalyticsEvent, meta?: FoundryAnalyticsMeta) => void;

let sink: Sink | null = null;

export function setFoundryAnalyticsSink(next: Sink | null): void {
  sink = next;
}

// Never pass prompt text or other content here — events + coarse metadata only.
export function trackFoundry(event: FoundryAnalyticsEvent, meta?: FoundryAnalyticsMeta): void {
  try {
    sink?.(event, meta);
  } catch {
    /* analytics must never break the product */
  }
}
