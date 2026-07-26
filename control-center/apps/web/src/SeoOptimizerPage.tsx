import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, Gauge, SearchCheck, ShieldCheck } from "lucide-react";
import type { SeoCategory, SeoFinding } from "@control-center/shared";
import { api, apiError } from "./api";
import { Badge, Button, Card, Field, GhostButton, Select, Skeleton } from "./ui";

type CrawlPage = { url: string; finalUrl: string; status: number; responseTimeMs: number; contentType?: string; title?: string; metaDescription?: string; canonical?: string; h1Count: number; findingCount: number };
type SeoAudit = {
  id: string; revision: number; targetUrl: string; finalUrl: string; keywords: string[]; score: number;
  categoryScores: Record<SeoCategory, number>; evidence: Record<string, string | number | boolean | undefined>;
  findings: SeoFinding[]; pages: CrawlPage[]; crawl: null | { pagesAudited: number; pagesDiscovered: number; limit: number; timedOut: boolean; durationMs: number }; createdAt: string;
};
type SeoState = {
  project: { id: string; name: string; slug: string };
  target: { available: boolean; url: string | null; source: string | null };
  audit: SeoAudit | null;
  history: Array<{ id: string; revision: number; score: number; createdAt: string }>;
  capabilities: { readOnlyScan: true; multiPageCrawl: true; maximumPages: number; automaticChanges: false; keywordResearch: false; coreWebVitals: false };
  boundary: string;
};

const categories: Array<[SeoCategory, string]> = [["technical", "Technical"], ["metadata", "Metadata"], ["content", "Content"], ["indexing", "Indexing"], ["performance", "Performance"]];
const scoreTone = (score: number) => score >= 90 ? "success" : score >= 70 ? "warning" : "danger";
const severityTone = (severity: SeoFinding["severity"]) => severity === "critical" ? "danger" : severity === "warning" ? "warning" : "neutral";

export function SeoOptimizerPage({ projectId, navigate }: { projectId: string; navigate: (path: string) => void }) {
  const client = useQueryClient();
  const [keywords, setKeywords] = useState("");
  const [maxPages, setMaxPages] = useState(10);
  const [notice, setNotice] = useState("");
  const query = useQuery<SeoState>({ queryKey: ["seo", projectId], queryFn: () => api.get(`/projects/${projectId}/seo`).then((response) => response.data), retry: false });
  const scan = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/seo/audits`, { keywords: keywords.split(",").map((item) => item.trim()).filter(Boolean), maxPages }).then((response) => response.data),
    onSuccess: async (data) => { setNotice(`Read-only audit revision ${data.audit.revision} completed with a score of ${data.audit.score}.`); await client.invalidateQueries({ queryKey: ["seo", projectId] }); },
    onError: (error) => setNotice(apiError(error))
  });
  if (query.isLoading) return <Skeleton />;
  if (query.error || !query.data) return <Card><h2 className="font-semibold">SEO Optimizer unavailable</h2><p role="alert" className="mt-2 text-sm text-danger">{apiError(query.error)}</p><GhostButton className="mt-3" onClick={() => navigate(`/projects/${projectId}/overview`)}>Back to project</GhostButton></Card>;
  const data = query.data; const result = data.audit;
  return <div className="space-y-4" data-testid="seo-optimizer">
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><button className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-text" onClick={() => navigate(`/projects/${projectId}/overview`)}><ChevronLeft className="h-3.5 w-3.5" /> Project workspace</button><div className="flex items-center gap-2"><SearchCheck className="h-5 w-5 text-primary" /><h2 className="text-xl font-semibold">SEO Optimizer</h2></div><p className="mt-1 text-sm text-muted">Evidence-based site audits for {data.project.name}.</p></div>{result && <div className="text-center"><div className="text-3xl font-bold">{result.score}</div><Badge tone={scoreTone(result.score)}>latest score</Badge></div>}</div>
      <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-muted"><strong className="text-text">Read-only boundary:</strong> {data.boundary}</div>
      {notice && <p role="status" className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">{notice}</p>}
    </Card>
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <Card>
        <h3 className="font-semibold">Audit target</h3>
        {data.target.available ? <><p className="mt-2 break-all text-sm">{data.target.url}</p><p className="mt-1 text-xs text-muted">Source: {data.target.source}</p></> : <p className="mt-2 text-sm text-warning">Register an enabled public health check or server primary URL first.</p>}
        <label className="mt-4 block text-xs text-muted">Target phrases (optional, comma-separated)<Field className="mt-1" value={keywords} maxLength={800} placeholder="deployment platform, server monitoring" onChange={(event) => setKeywords(event.target.value)} /></label>
        <label className="mt-3 block text-xs text-muted">Maximum pages<Select aria-label="Maximum pages" className="mt-1" value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value))}>{[1, 5, 10, 15, 25].map((value) => <option key={value} value={value}>{value}</option>)}</Select></label>
        <p className="mt-2 text-xs text-muted">Uses the sitemap and same-origin links. Phrase checks cover titles, descriptions, and H1 headings; this is not ranking research.</p>
        <Button className="mt-3 w-full" disabled={!data.target.available || scan.isPending || keywords.split(",").filter((item) => item.trim()).length > 10} onClick={() => scan.mutate()}><SearchCheck className="h-4 w-4" />{scan.isPending ? "Auditing…" : "Run read-only audit"}</Button>
      </Card>
      <Card><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-success" /><h3 className="font-semibold">Capability status</h3></div><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted">Site audit</dt><dd>Sitemap and same-origin crawl, capped at {data.capabilities.maximumPages} pages</dd></div><div><dt className="text-muted">Automatic changes</dt><dd>Disabled</dd></div><div><dt className="text-muted">Keyword research</dt><dd>Not configured; no fabricated volume data</dd></div><div><dt className="text-muted">Performance</dt><dd>HTTP timing only; not Core Web Vitals</dd></div></dl></Card>
    </div>
    {result ? <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="SEO category scores">{categories.map(([key, label]) => <Card key={key}><div className="flex items-center justify-between"><span className="text-sm text-muted">{label}</span><Gauge className="h-4 w-4 text-primary" /></div><div className="mt-2 text-2xl font-bold">{result.categoryScores[key]}</div><Badge tone={scoreTone(result.categoryScores[key])}>{result.categoryScores[key] >= 90 ? "healthy" : "review"}</Badge></Card>)}</section>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Findings</h3><p className="text-xs text-muted">Revision {result.revision} · {new Date(result.createdAt).toLocaleString()} · final URL {result.finalUrl}</p></div><Badge tone={result.findings.some((finding) => finding.severity === "critical") ? "danger" : result.findings.length ? "warning" : "success"}>{result.findings.length} finding{result.findings.length === 1 ? "" : "s"}</Badge></div>
        {result.findings.length ? <div className="mt-3 space-y-3">{result.findings.map((finding) => <article key={finding.code} className="rounded-md border border-border p-3"><div className="flex flex-wrap items-center gap-2"><Badge tone={severityTone(finding.severity)}>{finding.severity}</Badge><Badge>{finding.category}</Badge><h4 className="font-semibold">{finding.title}</h4></div><p className="mt-2 text-sm">{finding.summary}</p><p className="mt-2 text-sm text-muted"><strong className="text-text">Recommendation:</strong> {finding.recommendation}</p><details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Evidence</summary><pre className="mt-1 overflow-auto rounded bg-background p-2">{JSON.stringify(finding.evidence, null, 2)}</pre></details></article>)}</div> : <p className="mt-3 text-sm text-success">No findings were generated by this bounded audit. Continue validating with Search Console and real-user performance data.</p>}
      </Card>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Audited pages</h3><p className="text-xs text-muted">{result.crawl ? `${result.crawl.pagesAudited} of ${result.crawl.pagesDiscovered} discovered · ${result.crawl.durationMs} ms${result.crawl.timedOut ? " · scheduling limit reached" : ""}` : "Legacy single-page audit"}</p></div><Badge>{result.pages.length} page{result.pages.length === 1 ? "" : "s"}</Badge></div>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-muted"><tr><th className="border-b border-border p-2">Page</th><th className="border-b border-border p-2">Status</th><th className="border-b border-border p-2">Title</th><th className="border-b border-border p-2">H1</th><th className="border-b border-border p-2">Findings</th><th className="border-b border-border p-2">Time</th></tr></thead><tbody>{result.pages.map((crawlPage) => <tr key={crawlPage.url} className="border-b border-border/60"><td className="max-w-xs break-all p-2">{crawlPage.finalUrl}</td><td className="p-2"><Badge tone={crawlPage.status >= 200 && crawlPage.status < 400 ? "success" : "danger"}>{crawlPage.status || "failed"}</Badge></td><td className="p-2">{crawlPage.title || "Missing"}</td><td className="p-2">{crawlPage.h1Count}</td><td className="p-2">{crawlPage.findingCount}</td><td className="p-2">{crawlPage.responseTimeMs} ms</td></tr>)}</tbody></table></div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2"><Card><h3 className="font-semibold">Captured evidence</h3><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{Object.entries(result.evidence).filter(([, value]) => value !== undefined).map(([key, value]) => <div key={key}><dt className="text-muted">{key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</dt><dd className="break-all">{String(value)}</dd></div>)}</dl></Card><Card><h3 className="font-semibold">Audit history</h3><ol className="mt-3 space-y-2 text-sm">{data.history.map((item) => <li key={item.id} className="flex items-center justify-between rounded border border-border p-2"><span>Revision {item.revision} · score {item.score}</span><time className="text-xs text-muted">{new Date(item.createdAt).toLocaleString()}</time></li>)}</ol></Card></div>
    </> : <Card><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 text-warning" /><div><h3 className="font-semibold">No SEO evidence yet</h3><p className="mt-1 text-sm text-muted">Run the first read-only audit to establish a baseline. No website changes will be made.</p></div></div></Card>}
  </div>;
}
