import { type FoundryWorkflow } from "./foundryApi";

// Contextual improvement suggestions derived from the ACTUAL generated project —
// never generic filler. Actionable ones map to a real, reversible backend action
// (regenerating a versioned section); the rest are honest recommendations with no
// one-click apply yet (so we never imply a capability that isn't wired up).
//
// While the deterministic provider is used, every suggestion costs 0 credits and
// must not imply a paid model ran.

export type Suggestion = {
  id: string;
  title: string;
  what: string;
  why: string;
  scope: string;
  reversible: boolean;
  credits: 0;
  action: { kind: "regenerate"; sectionId: string } | { kind: "recommendation" };
};

function hasContactPage(workflow: FoundryWorkflow): boolean {
  const pages = workflow.architecture?.pages ?? [];
  return pages.some((page: any) => /contact/i.test(`${page.title} ${page.route}`));
}

// Returns 2–4 project-specific suggestions once a preview exists; [] otherwise.
export function buildSuggestions(workflow: FoundryWorkflow | null): Suggestion[] {
  if (!workflow?.artifact || !workflow.sections?.length) return [];
  const sections = workflow.sections;
  const out: Suggestion[] = [];
  const business = workflow.brief?.business?.name || "your business";

  const hero = sections.find((s) => s.type === "hero");
  if (hero) {
    out.push({
      id: "regen-hero", title: "Strengthen the homepage headline and call to action",
      what: `Rewrite the hero of ${business} with a sharper headline and a clearer primary action.`,
      why: "The hero is the first thing visitors read; a focused message and action lift engagement.",
      scope: "Homepage hero section", reversible: true, credits: 0,
      action: { kind: "regenerate", sectionId: hero.id },
    });
  }
  const features = sections.find((s) => s.type === "features");
  if (features) {
    out.push({
      id: "regen-features", title: "Refresh the “how we help” section",
      what: "Regenerate the features/services wording to be more specific and benefit-led.",
      why: "Concrete, benefit-led copy helps visitors understand what you offer.",
      scope: "Features section", reversible: true, credits: 0,
      action: { kind: "regenerate", sectionId: features.id },
    });
  }
  if (!hasContactPage(workflow)) {
    out.push({
      id: "add-contact", title: "Add a contact page",
      what: "Introduce a dedicated page so visitors can reach you.",
      why: "A clear way to make contact is a common expectation and supports your primary goal.",
      scope: "New page", reversible: true, credits: 0,
      action: { kind: "recommendation" },
    });
  }
  if (out.length < 4) {
    out.push({
      id: "a11y-contrast", title: "Review accessibility contrast in both themes",
      what: "Check text and control contrast in light and dark modes against the generated colors.",
      why: "Sufficient contrast keeps the site readable for everyone and meets accessibility guidance.",
      scope: "Whole project", reversible: true, credits: 0,
      action: { kind: "recommendation" },
    });
  }
  return out.slice(0, 4);
}
