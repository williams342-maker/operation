import { useEffect, useState } from "react";
import {
  ArrowRight, Calendar, Check, Eye, History, LayoutTemplate, Megaphone, Monitor,
  PencilRuler, Rocket, ShieldCheck, Smartphone, Sparkles, Store, User, Wrench,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import type { Theme } from "./theme";
import { trackFoundry } from "./foundryAnalytics";

// Public, unauthenticated Foundry landing page — the product's front door. It
// calls no protected APIs and renders identically for anonymous and signed-in
// visitors, differing only in its calls-to-action. Copy here reflects the product
// that exists TODAY: it shapes a brief, builds a working preview, and suggests
// improvements, with a human approving before anything is published. It does not
// claim autonomous publishing, live multi-agent AI, unlimited or zero-cost
// generation, or instant deployment. Anything not yet built is labelled Upcoming.

type StartHandler = (prompt: string) => void;

const EXAMPLES: Array<{ id: string; kind: string; icon: any; prompt: string; outcome: string }> = [
  { id: "hvac", kind: "Business website", icon: Wrench, prompt: "A modern website for a family-run HVAC company that wants more service calls.", outcome: "Home, Services, About and Contact with a clear “Book a visit” action." },
  { id: "waitlist", kind: "Launch page", icon: Rocket, prompt: "A launch page for a productivity app with an email waitlist.", outcome: "A focused single page leading to one primary sign-up action." },
  { id: "portfolio", kind: "Creator portfolio", icon: User, prompt: "A portfolio site for a freelance photographer showcasing recent shoots.", outcome: "A gallery-led home with an About and a Contact page." },
  { id: "store", kind: "Online storefront", icon: Store, prompt: "An online store to sell handmade ceramic mugs with a simple catalog.", outcome: "Home, Shop, About and Contact framed around browsing products." },
  { id: "festival", kind: "Event page", icon: Calendar, prompt: "A one-page site for a local music festival with schedule and ticket details.", outcome: "A single page covering the essentials for attendees." },
  { id: "fundraiser", kind: "Campaign page", icon: Megaphone, prompt: "A campaign page for a nonprofit’s annual fundraising drive.", outcome: "A persuasive page centred on a single supporting action." },
];

const CAPABILITIES = [
  "Business websites", "Landing pages", "Product launches", "Creator portfolios",
  "Online storefronts", "Campaign pages", "Event pages", "Internal tools",
];

const STEPS: Array<{ title: string; body: string; icon: any }> = [
  { title: "Describe", body: "Tell Foundry what you want in your own words.", icon: Sparkles },
  { title: "Shape", body: "Foundry turns the idea into a structured project brief.", icon: PencilRuler },
  { title: "Build", body: "The workspace creates the structure and a working preview.", icon: LayoutTemplate },
  { title: "Improve", body: "Foundry recommends meaningful changes and applies the ones you approve.", icon: Sparkles },
];

const CONTROLS: Array<{ title: string; body: string; icon: any }> = [
  { title: "Review before publishing", body: "Nothing goes live until you approve it. Publishing stays in your hands.", icon: ShieldCheck },
  { title: "Transparent activity", body: "A timeline shows exactly what Foundry is doing at each step.", icon: Eye },
  { title: "Editable content and structure", body: "Edit the brief and every section directly whenever you want.", icon: PencilRuler },
  { title: "Reversible changes", body: "Improvements are versioned, so you can step back if you change your mind.", icon: History },
  { title: "Project history", body: "Your projects and their versions are saved to return to later.", icon: History },
  { title: "No surprise publishing", body: "Production publishing is separate, explicit, and off by default.", icon: ShieldCheck },
];

function FoundryTopBar({ authed, theme, onChangeTheme, onStart, onSignIn, onViewProjects }: {
  authed: boolean; theme: Theme; onChangeTheme: (t: Theme) => void; onStart: StartHandler; onSignIn: () => void; onViewProjects: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" /> Foundry
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle theme={theme} onChange={onChangeTheme} variant="icon" />
          {authed ? (
            <>
              <button type="button" onClick={onViewProjects} className="hidden min-h-11 items-center rounded-md border border-border px-3 py-2 text-sm text-text hover:bg-panel sm:inline-flex">My Projects</button>
              <button type="button" onClick={() => { trackFoundry("foundry_hero_cta_clicked", { location: "topbar" }); onStart(""); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primaryForeground hover:bg-primary/90">Start Building</button>
            </>
          ) : (
            <>
              <button type="button" onClick={onSignIn} className="hidden min-h-11 items-center rounded-md border border-border px-3 py-2 text-sm text-text hover:bg-panel sm:inline-flex">Sign In</button>
              <button type="button" onClick={() => { trackFoundry("foundry_hero_cta_clicked", { location: "topbar" }); onStart(""); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primaryForeground hover:bg-primary/90">Start Building</button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

// A schematic representation of the real workspace (prompt → timeline → preview →
// suggestions). Deliberately a labelled interface illustration, not generative
// artwork and not a fabricated screenshot — decorative for assistive tech, with a
// concise text alternative.
function FoundryPreviewShowcase() {
  return (
    <figure className="m-0">
      <div aria-hidden="true" className="grid gap-4 rounded-2xl border border-border bg-panel p-4 shadow-sm sm:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-xs font-medium text-muted">Your request</div>
            <div className="mt-1 text-sm">A modern website for a family bakery that takes custom cake orders.</div>
          </div>
          <ol className="space-y-2">
            {["Understanding your request", "Preparing the project brief", "Planning the site structure", "Creating the first preview"].map((label, index) => (
              <li key={label} className="flex items-center gap-2 text-sm">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${index < 3 ? "bg-success/20 text-success" : "border border-primary text-primary"}`}>{index < 3 ? "✓" : "•"}</span>
                <span className={index < 3 ? "" : "text-muted"}>{label}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-1.5">
            {["Add a menu page", "Stronger call to action", "Improve mobile layout"].map((s) => (
              <span key={s} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{s}</span>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
              <span className="h-2 w-2 rounded-full bg-border" /><span className="h-2 w-2 rounded-full bg-border" /><span className="h-2 w-2 rounded-full bg-border" />
              <span className="ml-2 flex items-center gap-1 text-[10px] text-muted"><Monitor className="h-3 w-3" /> Desktop preview</span>
            </div>
            <div className="space-y-2 p-3">
              <div className="h-3 w-2/3 rounded bg-primary/30" />
              <div className="h-2 w-1/2 rounded bg-border" />
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="h-10 rounded bg-border/70" /><div className="h-10 rounded bg-border/70" /><div className="h-10 rounded bg-border/70" />
              </div>
            </div>
          </div>
          <div className="ml-auto w-24 overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex items-center gap-1 border-b border-border px-2 py-1"><span className="flex items-center gap-1 text-[9px] text-muted"><Smartphone className="h-2.5 w-2.5" /> Mobile</span></div>
            <div className="space-y-1.5 p-2"><div className="h-2 w-3/4 rounded bg-primary/30" /><div className="h-1.5 w-1/2 rounded bg-border" /><div className="h-6 rounded bg-border/70" /></div>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">
        Interface illustration of the Foundry workspace: a request, an activity timeline showing understanding the request, preparing a brief and planning structure, a desktop and mobile preview, and suggested improvements.
      </figcaption>
    </figure>
  );
}

function FoundryHero({ authed, onStart, onSignIn }: { authed: boolean; onStart: StartHandler; onSignIn: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [started, setStarted] = useState(false);
  const onFirstInput = () => { if (!started) { setStarted(true); trackFoundry("foundry_prompt_started"); } };
  const submit = () => { trackFoundry("foundry_hero_cta_clicked", { location: "hero", hasPrompt: prompt.trim().length > 0 }); onStart(prompt); };
  return (
    <section aria-labelledby="foundry-hero-title" className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
      <div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-panel px-3 py-1 text-xs font-semibold text-primary">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> Foundry — a creative studio in OpsWorkbench
        </span>
        <h1 id="foundry-hero-title" className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">Describe it. Watch Foundry build it.</h1>
        <p className="mt-4 max-w-xl text-lg text-muted">
          Tell Foundry what you want to create. It will shape the idea, build the structure, generate the first experience, and help you improve it — all in one workspace.
        </p>
        <div className="mt-6 rounded-2xl border border-border bg-panel p-3 shadow-sm">
          <label htmlFor="foundry-hero-prompt" className="sr-only">Describe what you want to build</label>
          <textarea
            id="foundry-hero-prompt"
            value={prompt}
            onChange={(event) => { setPrompt(event.target.value); onFirstInput(); }}
            onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit(); }}
            rows={3}
            maxLength={4000}
            placeholder="Describe the website, campaign, or experience you want to build."
            className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">Nothing is generated or published yet. {authed ? "Continue into your workspace." : "You'll sign in before your project is created."}</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => document.getElementById("foundry-examples")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-2 text-sm text-text hover:bg-background">View Examples</button>
              <button type="button" onClick={submit} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primary/90">
                Start Building <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        {!authed && (
          <p className="mt-3 text-xs text-muted">Already have an account? <button type="button" onClick={onSignIn} className="font-medium text-primary underline underline-offset-2">Sign in</button>.</p>
        )}
      </div>
      <FoundryPreviewShowcase />
    </section>
  );
}

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) {
  const headingId = `${id || title.replace(/\s+/g, "-").toLowerCase()}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className="border-t border-border py-14 sm:py-18">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <h2 id={headingId} className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
        {description && <p className="mt-3 max-w-2xl text-muted">{description}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

export function FoundryLandingPage({ authed, theme, onChangeTheme, onStart, onSignIn, onViewProjects }: {
  authed: boolean; theme: Theme; onChangeTheme: (theme: Theme) => void; onStart: StartHandler; onSignIn: () => void; onViewProjects: () => void;
}) {
  useEffect(() => { trackFoundry("foundry_landing_viewed", { authed }); }, [authed]);
  const startFromExample = (id: string, prompt: string) => { trackFoundry("foundry_example_selected", { example: id }); onStart(prompt); };

  return (
    <div className="min-h-screen bg-background text-text">
      <FoundryTopBar authed={authed} theme={theme} onChangeTheme={onChangeTheme} onStart={onStart} onSignIn={onSignIn} onViewProjects={onViewProjects} />
      <main>
        <FoundryHero authed={authed} onStart={onStart} onSignIn={onSignIn} />

        <Section id="foundry-capabilities" title="What you can build" description="Starting points, not limits. Describe your own idea and Foundry will shape it.">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {CAPABILITIES.map((item) => (
              <li key={item} className="rounded-xl border border-border bg-panel p-4 text-sm font-medium shadow-sm">{item}</li>
            ))}
          </ul>
        </Section>

        <Section id="foundry-how" title="How Foundry works">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-border bg-panel p-5 shadow-sm">
                <div className="flex items-center gap-2 text-primary"><step.icon className="h-5 w-5" aria-hidden="true" /><span className="text-xs font-semibold uppercase tracking-wide text-muted">Step {index + 1}</span></div>
                <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="foundry-preview" title="See it take shape" description="You watch the project come together as it is built — with editable content and human approval before anything is published.">
          <div className="grid items-center gap-8 lg:grid-cols-[1.3fr_1fr]">
            <FoundryPreviewShowcase />
            <ul className="space-y-3">
              {["Desktop and mobile previews", "Clear progress stages", "Editable project brief", "Reversible improvements", "Human approval before publishing", "Project history"].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />{item}</li>
              ))}
            </ul>
          </div>
        </Section>

        <Section id="foundry-examples" title="Example projects" description="Example concepts that show the kind of starting point Foundry produces. Pick one to begin with that prompt.">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {EXAMPLES.map((example) => (
              <li key={example.id} className="flex flex-col rounded-2xl border border-border bg-panel p-5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary"><example.icon className="h-4 w-4" aria-hidden="true" />{example.kind}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">Example concept</span>
                </div>
                <p className="mt-3 text-sm">“{example.prompt}”</p>
                <p className="mt-2 text-xs text-muted">{example.outcome}</p>
                <button type="button" onClick={() => startFromExample(example.id, example.prompt)} className="mt-4 inline-flex min-h-11 items-center justify-center gap-1.5 self-start rounded-md border border-border px-3 py-2 text-sm font-medium text-text hover:bg-background">
                  Build something like this <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="foundry-control" title="Built for control" description="Foundry assists — it never takes over. You stay in charge of what gets built and published.">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CONTROLS.map((control) => (
              <li key={control.title} className="rounded-2xl border border-border bg-panel p-5 shadow-sm">
                <control.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-3 font-semibold">{control.title}</h3>
                <p className="mt-1 text-sm text-muted">{control.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 rounded-xl border border-border bg-panel p-4 text-sm text-muted">
            <span className="font-semibold text-text">Upcoming:</span> transparent, budget-aware AI credits and additional live AI providers. Today Foundry builds your first preview with its built-in generator, and publishing to production always requires your explicit approval.
          </p>
        </Section>

        <Section id="foundry-cta" title="What would you like to build today?">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => { trackFoundry("foundry_hero_cta_clicked", { location: "final" }); onStart(""); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primaryForeground hover:bg-primary/90">
              Open Foundry <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
            {authed && (
              <button type="button" onClick={onViewProjects} className="inline-flex min-h-11 items-center rounded-md border border-border px-4 py-2.5 text-sm font-medium text-text hover:bg-panel">View My Projects</button>
            )}
          </div>
        </Section>
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 text-xs text-muted sm:px-6">
          <span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> Foundry — part of OpsWorkbench</span>
          <span>You approve before anything is published.</span>
        </div>
      </footer>
    </div>
  );
}
