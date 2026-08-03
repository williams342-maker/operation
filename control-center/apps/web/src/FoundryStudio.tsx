import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, Check, Loader2, Monitor, RefreshCw, ShieldCheck,
  Smartphone, Sparkles, Tablet, X,
} from "lucide-react";
import { apiError } from "./api";
import {
  advanceWorkflow, createWorkflowFromPrompt, getWorkflow, listWorkflows, nextAutoAction,
  regenerateSection, stageIndex, type FoundryWorkflow,
} from "./foundryApi";
import { buildTimeline, workspacePhase } from "./foundryTimeline";
import { buildSuggestions, type Suggestion } from "./foundrySuggestions";
import { foundryPath, type FoundryRoute } from "./foundryRoutes";
import { clearDraftPrompt, readDraftPrompt } from "./foundryDraft";
import { trackFoundry } from "./foundryAnalytics";

type Viewport = "desktop" | "tablet" | "mobile";
const VIEWPORTS: Array<{ id: Viewport; label: string; icon: any; width: string }> = [
  { id: "desktop", label: "Desktop", icon: Monitor, width: "100%" },
  { id: "tablet", label: "Tablet", icon: Tablet, width: "768px" },
  { id: "mobile", label: "Mobile", icon: Smartphone, width: "375px" },
];

function dismissedKey(id: string) { return `foundry.dismissed.${id}`; }
function loadDismissed(id: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(dismissedKey(id)) || "[]")); } catch { return new Set(); }
}
function saveDismissed(id: string, set: Set<string>) {
  try { localStorage.setItem(dismissedKey(id), JSON.stringify([...set])); } catch { /* ignore */ }
}

export function FoundryStudio({ route, navigate }: { route: FoundryRoute; navigate: (path: string) => void }) {
  const [prompt, setPrompt] = useState(() => (route.kind === "new" ? readDraftPrompt() : ""));
  const [workflow, setWorkflow] = useState<FoundryWorkflow | null>(null);
  const [creating, setCreating] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastGoodHtml, setLastGoodHtml] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const createdRef = useRef(false);
  const advanceRef = useRef(false);

  useEffect(() => { trackFoundry("foundry_workspace_opened"); }, []);

  // Load an existing workflow for /foundry/projects/:id (reload/resume-safe).
  // Skipped when we already hold it (e.g. just created it), to avoid a redundant
  // fetch and any chance of re-creation.
  useEffect(() => {
    if (route.kind !== "project") return;
    if (workflow?.id === route.workflowId) return;
    let cancelled = false;
    setLoadError(null);
    getWorkflow(route.workflowId)
      .then((res) => { if (!cancelled) { setWorkflow(res.workflow); if (res.workflow.artifact?.html) setLastGoodHtml(res.workflow.artifact.html); setDismissed(loadDismissed(res.workflow.id)); } })
      .catch((error) => { if (!cancelled) setLoadError(apiError(error)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.kind, route.kind === "project" ? route.workflowId : ""]);

  // Auto-advance through safe, reversible stages until the preview is ready, then
  // stop for human review. Guarded so it never double-fires or crosses a gated
  // boundary (nextAutoAction returns null at preview/staging/discovery).
  useEffect(() => {
    if (!workflow || failed) return;
    const action = nextAutoAction(workflow);
    if (!action || advanceRef.current) return;
    advanceRef.current = true;
    setAdvancing(true);
    advanceWorkflow(workflow.id, action.path, action.body)
      .then((res) => {
        setWorkflow(res.workflow);
        if (res.workflow.artifact?.html) setLastGoodHtml(res.workflow.artifact.html);
        if (stageIndex(res.workflow.stage) >= 6) trackFoundry("foundry_preview_reached");
      })
      .catch((error) => setFailed(apiError(error)))
      .finally(() => { advanceRef.current = false; setAdvancing(false); });
  }, [workflow, failed]);

  const submit = async () => {
    if (creating || createdRef.current) return;
    const text = prompt.trim();
    if (text.length < 3) { setComposerError("Please describe what you'd like to build — a sentence is enough."); return; }
    createdRef.current = true; setCreating(true); setComposerError(null);
    trackFoundry("foundry_prompt_submitted");
    try {
      const res = await createWorkflowFromPrompt(text);
      clearDraftPrompt();
      trackFoundry("foundry_workflow_created");
      setWorkflow(res.workflow);
      setDismissed(loadDismissed(res.workflow.id));
      if (res.workflow.artifact?.html) setLastGoodHtml(res.workflow.artifact.html);
      navigate(foundryPath({ kind: "project", workflowId: res.workflow.id }));
    } catch (error) {
      createdRef.current = false; // allow a retry without leaving a half-created state
      setComposerError(apiError(error));
    } finally { setCreating(false); }
  };

  const retryAdvance = () => { setFailed(null); };

  const refreshPreview = async () => {
    if (!workflow) return;
    setPreviewError(null);
    try {
      const res = await getWorkflow(workflow.id);
      setWorkflow(res.workflow);
      if (res.workflow.artifact?.html) setLastGoodHtml(res.workflow.artifact.html);
    } catch (error) {
      setPreviewError(apiError(error)); // keep the last-known-good preview on screen
    }
  };

  const openPreview = () => {
    const html = workflow?.artifact?.html || lastGoodHtml;
    if (!html) return;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const applySuggestion = async (suggestion: Suggestion) => {
    if (!workflow || suggestion.action.kind !== "regenerate") return;
    setActionError(null);
    try {
      const res = await regenerateSection(workflow.id, suggestion.action.sectionId);
      setWorkflow(res.workflow);
      if (res.workflow.artifact?.html) setLastGoodHtml(res.workflow.artifact.html);
      trackFoundry("foundry_suggestion_applied", { suggestion: suggestion.id });
      dismiss(suggestion.id);
    } catch (error) { setActionError(apiError(error)); }
  };

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      if (workflow) saveDismissed(workflow.id, next);
      return next;
    });
  };

  const approvePreview = async () => {
    if (!workflow) return;
    setActionError(null);
    try {
      const res = await advanceWorkflow(workflow.id, "approve-preview");
      setWorkflow(res.workflow);
    } catch (error) { setActionError(apiError(error)); }
  };

  // --- Composer (no workflow yet) --------------------------------------------
  if (!workflow) {
    if (route.kind === "project" && loadError) {
      return <StudioNotice title="We couldn't open this project" body={loadError} action={{ label: "Back to Foundry", onClick: () => navigate(foundryPath({ kind: "landing" })) }} />;
    }
    if (route.kind === "project") {
      return <div role="status" className="flex items-center gap-2 py-16 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading your project…</div>;
    }
    return (
      <section aria-labelledby="foundry-composer-title" className="mx-auto max-w-3xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-panel px-3 py-1 text-xs font-semibold text-primary"><Sparkles className="h-4 w-4" aria-hidden="true" /> New project</div>
        <h1 id="foundry-composer-title" className="mt-4 text-3xl font-bold tracking-tight">What would you like to build today?</h1>
        <p className="mt-2 text-muted">Describe it in your own words. Foundry will shape a brief, build a working preview, and suggest improvements. Nothing is published until you approve it.</p>
        <div className="mt-5 rounded-2xl border border-border bg-panel p-3 shadow-sm">
          <label htmlFor="foundry-composer" className="sr-only">Describe what you want to build</label>
          <textarea
            id="foundry-composer" value={prompt} rows={4} maxLength={4000}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit(); }}
            placeholder="Describe the website, campaign, or experience you want to build."
            className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">Foundry will start building right away and stop for your review before anything is published.</p>
            <button type="button" onClick={submit} disabled={creating} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primary/90 disabled:opacity-60">
              {creating ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Starting…</> : <>Start Building <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
            </button>
          </div>
          {composerError && <p role="alert" className="mt-2 text-sm text-danger">{composerError}</p>}
        </div>
      </section>
    );
  }

  // --- Workspace (workflow loaded) -------------------------------------------
  const phase = workspacePhase(workflow);
  const timeline = buildTimeline(workflow, { advancing, failed: Boolean(failed) });
  const suggestions = (phase === "reviewing" || phase === "approved") ? buildSuggestions(workflow).filter((s) => !dismissed.has(s.id)) : [];
  const html = workflow.artifact?.html || lastGoodHtml;
  const previewWidth = VIEWPORTS.find((v) => v.id === viewport)!.width;

  if (phase === "guided-legacy") {
    return <StudioNotice title="This project was started in the guided builder" body="Open it from the AI Website Builder in OpsWorkbench to continue where you left off. Your answers and approvals are preserved." action={{ label: "Go to OpsWorkbench", onClick: () => navigate("/") }} />;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <StudioHeader workflow={workflow} phase={phase} />
        <PreviewCanvas
          html={html} advancing={advancing} viewport={viewport} width={previewWidth}
          onViewport={setViewport} onRefresh={refreshPreview} onOpen={openPreview}
          previewError={previewError} failed={failed} onRetry={retryAdvance}
        />
      </div>
      <aside className="space-y-5">
        <ActivityTimeline steps={timeline} advancing={advancing} phase={phase} failed={failed} onRetry={retryAdvance} />
        {suggestions.length > 0 && <SuggestionsPanel suggestions={suggestions} onApply={applySuggestion} onDismiss={dismiss} error={actionError} />}
        <ApprovalControls workflow={workflow} phase={phase} onApprove={approvePreview} error={actionError} />
        <BriefPanel workflow={workflow} />
      </aside>
    </div>
  );
}

function StudioNotice({ title, body, action }: { title: string; body: string; action: { label: string; onClick: () => void } }) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-border bg-panel p-6 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">{body}</p>
      <button type="button" onClick={action.onClick} className="mt-4 inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primary/90">{action.label}</button>
    </div>
  );
}

function StudioHeader({ workflow, phase }: { workflow: FoundryWorkflow; phase: string }) {
  const label = phase === "building" ? "Building" : phase === "reviewing" ? "Ready for your review" : phase === "approved" ? "Approved for staging" : "Building";
  const tone = phase === "reviewing" ? "text-primary" : phase === "approved" ? "text-success" : "text-muted";
  return (
    <div className="rounded-2xl border border-border bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Your request</div>
          <p className="mt-1 break-words text-sm">{workflow.prompt || workflow.brief?.business?.description || "—"}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold ${tone}`}>
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${phase === "reviewing" ? "bg-primary" : phase === "approved" ? "bg-success" : "bg-muted"}`} />{label}
        </span>
      </div>
    </div>
  );
}

function PreviewCanvas({ html, advancing, viewport, width, onViewport, onRefresh, onOpen, previewError, failed, onRetry }: {
  html: string | null; advancing: boolean; viewport: Viewport; width: string; onViewport: (v: Viewport) => void;
  onRefresh: () => void; onOpen: () => void; previewError: string | null; failed: string | null; onRetry: () => void;
}) {
  return (
    <section aria-labelledby="foundry-preview-title" className="rounded-2xl border border-border bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="foundry-preview-title" className="font-semibold">Live preview</h2>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Preview viewport" className="flex items-center gap-1 rounded-md border border-border p-0.5">
            {VIEWPORTS.map((v) => (
              <button key={v.id} type="button" aria-pressed={viewport === v.id} aria-label={v.label} title={v.label} onClick={() => onViewport(v.id)} className={`inline-flex min-h-9 min-w-9 items-center justify-center rounded ${viewport === v.id ? "bg-primary text-primaryForeground" : "text-muted hover:bg-background"}`}>
                <v.icon className="h-4 w-4" aria-hidden="true" />
              </button>
            ))}
          </div>
          <button type="button" onClick={onRefresh} disabled={!html} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-background disabled:opacity-50"><RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh</button>
          <button type="button" onClick={onOpen} disabled={!html} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-background disabled:opacity-50">Open</button>
        </div>
      </div>
      {previewError && <p role="alert" className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">{previewError} Showing the last working preview.</p>}
      {failed && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
          <span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-danger" aria-hidden="true" /> A build step didn't complete: {failed}</span>
          <button type="button" onClick={onRetry} className="inline-flex min-h-9 items-center rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background">Retry</button>
        </div>
      )}
      <div className="mt-4 flex justify-center overflow-x-auto rounded-xl bg-background p-3">
        {html ? (
          <iframe title="Generated website preview" sandbox="" srcDoc={html} className="h-[640px] rounded-lg border border-border bg-white transition-[width]" style={{ width, maxWidth: "100%" }} />
        ) : advancing ? (
          <div role="status" className="flex h-[640px] w-full items-center justify-center gap-2 text-sm text-muted"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Building your first preview…</div>
        ) : (
          <div className="flex h-[640px] w-full items-center justify-center px-6 text-center text-sm text-muted">The preview will appear here as your project is built.</div>
        )}
      </div>
    </section>
  );
}

function ActivityTimeline({ steps, advancing, phase, failed, onRetry }: {
  steps: ReturnType<typeof buildTimeline>; advancing: boolean; phase: string; failed: string | null; onRetry: () => void;
}) {
  const active = steps.find((s) => s.status === "active");
  const announce = failed ? "A build step didn't complete." : phase === "reviewing" ? "Your preview is ready for review." : phase === "approved" ? "Your design is approved for staging." : active ? `${active.label}…` : "Waiting.";
  return (
    <section aria-labelledby="foundry-activity-title" className="rounded-2xl border border-border bg-panel p-4">
      <div className="flex items-center justify-between">
        <h2 id="foundry-activity-title" className="font-semibold">Activity</h2>
        {advancing && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden="true" />}
      </div>
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>
      <ol className="mt-3 space-y-2">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
              step.status === "completed" ? "bg-success/20 text-success" :
              step.status === "active" ? "border border-primary text-primary" :
              step.status === "failed" ? "bg-danger/20 text-danger" : "border border-border text-muted"}`}>
              {step.status === "completed" ? "✓" : step.status === "failed" ? "!" : step.status === "active" ? "●" : "○"}
            </span>
            <span className={step.status === "pending" ? "text-muted" : ""}>{step.label}</span>
            <span className="sr-only">
              {step.status === "completed" ? " — completed" : step.status === "active" ? " — in progress" : step.status === "failed" ? " — failed" : " — pending"}
            </span>
          </li>
        ))}
      </ol>
      {failed && <button type="button" onClick={onRetry} className="mt-3 inline-flex min-h-9 items-center rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background">Retry this step</button>}
    </section>
  );
}

function SuggestionsPanel({ suggestions, onApply, onDismiss, error }: {
  suggestions: Suggestion[]; onApply: (s: Suggestion) => void; onDismiss: (id: string) => void; error: string | null;
}) {
  return (
    <section aria-labelledby="foundry-suggestions-title" className="rounded-2xl border border-border bg-panel p-4">
      <h2 id="foundry-suggestions-title" className="font-semibold">Suggested improvements</h2>
      <p className="mt-1 text-xs text-muted">Based on your project. Applying a change is reversible.</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <ul className="mt-3 space-y-3">
        {suggestions.map((s) => (
          <li key={s.id} className="rounded-xl border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold">{s.title}</h3>
              <button type="button" onClick={() => onDismiss(s.id)} aria-label={`Dismiss: ${s.title}`} className="text-muted hover:text-text"><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            <p className="mt-1 text-xs text-muted">{s.what}</p>
            <p className="mt-1 text-xs"><span className="font-medium">Why:</span> <span className="text-muted">{s.why}</span></p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <span className="rounded-full border border-border px-2 py-0.5">{s.scope}</span>
              <span className="rounded-full border border-border px-2 py-0.5">{s.reversible ? "Reversible" : "Not reversible"}</span>
              <span className="rounded-full border border-border px-2 py-0.5">Estimated credits: {s.credits}</span>
            </div>
            <div className="mt-3">
              {s.action.kind === "regenerate" ? (
                <button type="button" onClick={() => onApply(s)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primaryForeground hover:bg-primary/90">Apply</button>
              ) : (
                <span className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs text-muted">Recommendation — apply coming soon</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ApprovalControls({ workflow, phase, onApprove, error }: { workflow: FoundryWorkflow; phase: string; onApprove: () => void; error: string | null }) {
  const validationPassed = Boolean((workflow.validation as any)?.passed);
  return (
    <section aria-labelledby="foundry-approval-title" className="rounded-2xl border border-border bg-panel p-4">
      <h2 id="foundry-approval-title" className="font-semibold">Review &amp; publishing</h2>
      {phase === "building" && <p className="mt-2 text-sm text-muted">Foundry is building. You'll be able to review and approve once the preview is ready.</p>}
      {phase === "reviewing" && (
        <>
          <p className="mt-2 text-sm text-muted">Your preview is ready. Approving marks the design ready for staging — it does not publish to production.</p>
          <button type="button" onClick={onApprove} disabled={!validationPassed} className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primary/90 disabled:opacity-60"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Approve preview for staging</button>
          {!validationPassed && <p className="mt-2 text-xs text-muted">Waiting for validation to pass before approval is available.</p>}
        </>
      )}
      {phase === "approved" && <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-success"><Check className="h-4 w-4" aria-hidden="true" /> Approved for staging.</p>}
      <div className="mt-4 rounded-md border border-border bg-background p-3 text-xs text-muted">
        <div className="flex items-center gap-1.5 font-medium text-text"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Publishing boundary</div>
        <p className="mt-1">Production publishing is separate and not enabled. A configured publishing provider and explicit authorization are required — Foundry never publishes on its own.</p>
        <button type="button" disabled aria-disabled="true" title="Not available" className="mt-2 inline-flex min-h-9 cursor-not-allowed items-center rounded-md border border-border px-3 py-1.5 text-sm opacity-60">Publish to production (disabled)</button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}

export function FoundryProjectsPage({ navigate }: { navigate: (path: string) => void }) {
  const [workflows, setWorkflows] = useState<FoundryWorkflow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    listWorkflows().then((rows) => { if (!cancelled) setWorkflows(rows); }).catch((e) => { if (!cancelled) setError(apiError(e)); });
    return () => { cancelled = true; };
  }, []);
  const statusLabel = (workflow: FoundryWorkflow) => {
    const phase = workspacePhase(workflow);
    return phase === "approved" ? "Approved for staging" : phase === "reviewing" ? "Ready for review" : phase === "guided-legacy" ? "Guided draft" : "In progress";
  };
  return (
    <section aria-labelledby="foundry-projects-title" className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="foundry-projects-title" className="text-2xl font-bold tracking-tight">Your projects</h1>
        <button type="button" onClick={() => navigate(foundryPath({ kind: "new" }))} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primary/90"><Sparkles className="h-4 w-4" aria-hidden="true" /> New project</button>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      {workflows === null && !error && <div role="status" className="mt-6 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…</div>}
      {workflows && workflows.length === 0 && <p className="mt-6 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">No projects yet. Start by describing what you'd like to build.</p>}
      {workflows && workflows.length > 0 && (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {workflows.map((workflow) => (
            <li key={workflow.id}>
              <button type="button" onClick={() => navigate(foundryPath({ kind: "project", workflowId: workflow.id }))} className="flex w-full flex-col rounded-2xl border border-border bg-panel p-4 text-left hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="line-clamp-2 text-sm font-medium">{workflow.prompt || workflow.brief?.business?.name || workflow.websiteType.replace(/_/g, " ")}</span>
                <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary" />{statusLabel(workflow)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BriefPanel({ workflow }: { workflow: FoundryWorkflow }) {
  const brief = workflow.brief;
  if (!brief) return null;
  const description = brief.business?.description || "";
  const fromUser = workflow.prompt ? description.trim() === workflow.prompt.trim() : false;
  const rows: Array<{ label: string; value: string; source: "user" | "derived" }> = [
    { label: "What it's about", value: description || "—", source: fromUser ? "user" : "derived" },
    { label: "Business name", value: brief.business?.name || "—", source: brief.business?.name && brief.business.name !== "Untitled business" ? "user" : "derived" },
    { label: "Audience", value: brief.audience?.primary || "—", source: "derived" },
    { label: "Primary goal", value: brief.goals?.primaryGoal || "—", source: "derived" },
    { label: "Pages", value: (brief.website?.requiredPages || []).join(", ") || "—", source: "derived" },
    { label: "Personality", value: (brief.brand?.personality || []).join(", ") || "—", source: "derived" },
  ];
  return (
    <section aria-labelledby="foundry-brief-title" className="rounded-2xl border border-border bg-panel p-4">
      <h2 id="foundry-brief-title" className="font-semibold">Project brief</h2>
      <p className="mt-1 text-xs text-muted">Foundry filled in sensible defaults from your request. Values marked <span className="font-medium text-text">Suggested</span> are safe to change.</p>
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="rounded-lg border border-border bg-background p-2">
            <dt className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted">
              {row.label}
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] normal-case ${row.source === "user" ? "border-primary/40 text-primary" : "border-border text-muted"}`}>{row.source === "user" ? "From you" : "Suggested"}</span>
            </dt>
            <dd className="mt-1 break-words text-sm">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
