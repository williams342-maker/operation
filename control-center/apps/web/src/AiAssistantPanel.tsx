import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { Badge, Button, Card, Field } from "./ui";

type Scope = { type: "server" | "application"; id: string };
const suggestions = ["Explain the current status.", "What should I check next?", "Create a safe diagnostic plan."];
export function AiAssistantPanel({ scope }: { scope: Scope }) {
  const [question, setQuestion] = useState("");
  const status = useQuery({ queryKey: ["ai-assistant-status"], queryFn: () => api.get("/ai-assistant/status").then((r) => r.data), retry: false });
  const analysis = useMutation({ mutationFn: () => api.post("/ai-assistant/analyze", { scope, question, contextOptions: { includeHealth: true, includeDiscovery: true, includeRecentLogs: true, includeDeployments: true, includeCiSummary: true } }).then((r) => r.data) });
  const result = analysis.data?.result; const metadata = analysis.data?.metadata; const errorCode = (analysis.error as any)?.response?.data?.code;
  const disabled = status.data && (!status.data.enabled || !status.data.configured);
  return <Card><div className="min-w-0 space-y-3" aria-live="polite">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">AI Assistant</h3><p className="text-sm text-muted">Read-only explanations from authorized OpsWorkbench data.</p></div><Badge tone="success">Read only</Badge></div>
    {status.isLoading && <p className="text-sm text-muted">Checking assistant availability…</p>}
    {disabled && <div className="rounded-md border border-warning/40 p-3 text-sm"><strong>{status.data.enabled ? "Assistant is not configured" : "Assistant is disabled"}</strong><p className="text-muted">Existing server and application features remain available.</p></div>}
    {!disabled && <><label className="block text-sm" htmlFor={`ai-question-${scope.type}-${scope.id}`}>Ask about this {scope.type}<Field id={`ai-question-${scope.type}-${scope.id}`} className="mt-1" value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} placeholder="What should I check next?" /></label>
      <div className="flex flex-wrap gap-2">{suggestions.map((item) => <button key={item} type="button" className="rounded-full border border-border px-3 py-1 text-left text-xs" onClick={() => setQuestion(item)}>{item}</button>)}</div>
      <Button disabled={question.trim().length < 3 || analysis.isPending} onClick={() => analysis.mutate()}>{analysis.isPending ? "Analyzing…" : "Analyze"}</Button></>}
    {analysis.isError && <div className="rounded-md border border-danger/40 p-3 text-sm" role="alert"><strong>{errorCode === "provider_timeout" ? "Assistant timed out" : errorCode === "resource_not_found" ? "You cannot access this resource" : "Assistant could not complete the analysis"}</strong><p className="text-muted">No infrastructure changes were attempted.</p></div>}
    {metadata && Object.values(metadata.redactions || {}).some(Boolean) && <p className="rounded-md border border-warning/40 p-2 text-sm">Sensitive values were redacted before analysis.</p>}
    {result && <div className="min-w-0 space-y-4"><div><div className="flex flex-wrap gap-2"><Badge tone={result.status === "critical" ? "danger" : "warning"}>{result.status}</Badge><Badge>{result.confidence} confidence</Badge><Badge>{result.risk} risk</Badge></div><p className="mt-2 break-words">{result.summary}</p></div>
      {!!result.likelyCauses?.length && <section><h4 className="font-medium">Likely causes</h4><ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{result.likelyCauses.map((cause: any) => <li key={cause.title}><strong>{cause.title}</strong>{cause.evidence?.map((item: string) => <div className="break-words text-muted" key={item}>{item}</div>)}</li>)}</ul></section>}
      <section><h4 className="font-medium">Recommended diagnostic steps</h4><ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">{result.recommendedSteps.map((step: any) => <li key={step.order}><strong>{step.title}</strong><div className="break-words text-muted">{step.description}</div></li>)}</ol></section>
      <section><h4 className="font-medium">Evidence used</h4><ul className="mt-2 space-y-1 text-sm">{result.evidence.map((item: any) => <li className="break-words" key={`${item.sourceType}-${item.label}`}><strong>{item.label}:</strong> {item.value}</li>)}</ul></section>
      <p className="text-xs text-muted">Generated {new Date(result.generatedAt).toLocaleString()}</p></div>}
    <div className="rounded-md border border-success/40 bg-background p-3 text-sm font-semibold">No actions were executed</div>
  </div></Card>;
}
