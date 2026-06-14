/**
 * iter347 — Admin: AI Ad-Creative Workshop.
 *
 * Phase 3 of admin-creates-ads roadmap. Admin picks a product or maker,
 * we generate platform-ready ad copy (Google/Meta/Pinterest) + optional
 * Nano Banana image variants. Each variant has a click-to-copy button
 * so admin can paste straight into the Google/Meta UI.
 *
 * The output is also persisted to ad_creative_drafts so admin can come
 * back later. Drafts list lives in the same card.
 *
 * Mounted near the top of AdsTab.jsx.
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Sparkles, Loader2, Copy, Check, X, Trash2, Download, Search, Image as ImageIcon, History, Send, ExternalLink, AlertTriangle,
} from "lucide-react";
import {
  adminSearchAdSubjects,
  adminGenerateAdCreative,
  adminListAdCreativeDrafts,
  adminGetAdCreativeDraft,
  adminDeleteAdCreativeDraft,
  adminAdCreativeGooglePreflight,
  adminPushDraftToGoogle,
  adminAdCreativeMetaPreflight,
  adminPushDraftToMeta,
  adminAdCreativeMicrosoftPreflight,
  adminPushDraftToMicrosoft,
  fetchSeoWins,
} from "../../lib/api";
import { useConfirm } from "../../hooks/useConfirm";

const CHANNELS = [
  { id: "google_search", label: "Google Search" },
  { id: "meta_feed",     label: "Meta (FB + IG)" },
  { id: "pinterest",     label: "Pinterest" },
];

const TONES = [
  "professional", "playful", "rustic", "premium", "urgent", "minimal",
];

export default function AdCreativeWorkshopCard() {
  const [view, setView] = useState("compose"); // "compose" | "drafts"
  const [subjectQuery, setSubjectQuery] = useState("");
  const [subjects, setSubjects] = useState({ products: [], makers: [], site: [] });
  const [selected, setSelected] = useState(null); // { type, slug, title, image_url }
  const [channels, setChannels] = useState(["google_search", "meta_feed"]);
  const [tone, setTone] = useState("professional");
  const [genImages, setGenImages] = useState(false);
  const [numVariants, setNumVariants] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [confirm, confirmModal] = useConfirm();

  // Search subjects (debounced).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await adminSearchAdSubjects(subjectQuery, 8);
        if (!cancelled) setSubjects(r);
      } catch {
        if (!cancelled) setSubjects({ products: [], makers: [], site: [] });
      }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [subjectQuery]);

  const [reloadDraftsKey, setReloadDraftsKey] = useState(0);

  useEffect(() => {
    if (view !== "drafts") return;
    let cancelled = false;
    (async () => {
      setLoadingDrafts(true);
      try {
        const r = await adminListAdCreativeDrafts(20);
        if (!cancelled) setDrafts(r.drafts || []);
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.detail || "Failed to load drafts.");
      } finally {
        if (!cancelled) setLoadingDrafts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [view, reloadDraftsKey]);

  const reloadDrafts = () => setReloadDraftsKey((k) => k + 1);

  // iter355 — Reference-asset selection state. Multi-select up to 4 IDs;
  // passed to /admin/ad-creative/generate so Nano Banana uses them as
  // style anchors and the copy LLM aligns its tone with the references.
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const toggleAsset = useCallback((id) => {
    setSelectedAssetIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 4) {
        toast.error("Max 4 reference assets per generation.");
        return cur;
      }
      return [...cur, id];
    });
  }, []);

  const toggleChannel = useCallback((id) => {
    setChannels((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));
  }, []);

  // iter379 — Proven GSC queries from the SEO wins rollup, offered as
  // toggle chips. Selected ones are sent as `seo_keywords` so the copy
  // model writes around terms Google already ranks the site for.
  const [seoQueries, setSeoQueries] = useState([]);
  const [seoKeywords, setSeoKeywords] = useState([]);
  useEffect(() => {
    fetchSeoWins()
      .then((w) => setSeoQueries((w?.top_queries || []).slice(0, 10)))
      .catch(() => {});
  }, []);
  const toggleSeoKeyword = useCallback((q) => {
    setSeoKeywords((cur) =>
      cur.includes(q) ? cur.filter((x) => x !== q) : [...cur, q].slice(0, 10));
  }, []);

  const onGenerate = async () => {
    if (!selected) { toast.error("Pick a product or maker first."); return; }
    if (channels.length === 0) { toast.error("Select at least one channel."); return; }
    setGenerating(true);
    setResult(null);
    try {
      const r = await adminGenerateAdCreative({
        subject_type: selected.type,
        subject_slug: selected.slug,
        channels,
        tone,
        generate_images: genImages,
        num_image_variants: genImages ? numVariants : 0,
        reference_asset_ids: selectedAssetIds,
        seo_keywords: seoKeywords,
      });
      setResult(r);
      toast.success(
        `Generated ${channels.length} channel variants` +
        (selectedAssetIds.length ? ` · ${selectedAssetIds.length} ref(s)` : "") +
        (seoKeywords.length ? ` · ${seoKeywords.length} proven quer${seoKeywords.length === 1 ? "y" : "ies"}` : "") +
        (genImages ? ` + ${r?.draft?.images?.length || 0} images` : "")
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const onLoadDraft = async (draftId) => {
    try {
      const r = await adminGetAdCreativeDraft(draftId);
      setResult(r);
      setSelected({
        type: r.draft.subject_type,
        slug: r.draft.subject_slug,
        title: r.draft.subject_title,
        image_url: r.draft.subject_image,
      });
      setChannels(r.draft.channels || []);
      setTone(r.draft.tone || "professional");
      setView("compose");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load draft.");
    }
  };

  const onDeleteDraft = async (draft) => {
    const ok = await confirm({
      title: `Delete draft for "${draft.subject_title}"?`,
      body: "Permanently removes the copy + image variants.",
      confirmLabel: "Delete draft",
      tone: "warn",
      testId: `confirm-delete-draft-${draft.draft_id}`,
    });
    if (!ok) return;
    try {
      await adminDeleteAdCreativeDraft(draft.draft_id);
      toast.success("Draft deleted.");
      reloadDrafts();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed.");
    }
  };

  return (
    <div className="border border-line p-4 md:p-5" data-testid="ad-creative-workshop-card">
      {confirmModal}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-2 flex items-center gap-1.5">
            <Sparkles size={12} /> ◆ AI Ad-Creative Workshop
          </div>
          <h3 className="font-display text-2xl uppercase mb-1">Copy + Image Factory</h3>
          <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl">
            Pick a product or maker → AI writes platform-compliant ad copy (Google/Meta/Pinterest) within their character limits + optional Nano Banana image variants. Click-to-copy any line. Drafts are saved automatically.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView("compose")}
            className={`px-3 py-2 border font-mono text-[10px] uppercase tracking-[0.22em] ${view === "compose" ? "border-cyan-400 text-brand bg-cyan-950/30" : "border-line text-ink-muted hover:border-ink-muted"}`}
            data-testid="ad-creative-view-compose"
          >
            Compose
          </button>
          <button
            onClick={() => setView("drafts")}
            className={`px-3 py-2 border font-mono text-[10px] uppercase tracking-[0.22em] flex items-center gap-1 ${view === "drafts" ? "border-cyan-400 text-brand bg-cyan-950/30" : "border-line text-ink-muted hover:border-ink-muted"}`}
            data-testid="ad-creative-view-drafts"
          >
            <History size={11} /> Drafts
          </button>
        </div>
      </div>

      {view === "compose" && (
        <ComposeView
          subjectQuery={subjectQuery}
          setSubjectQuery={setSubjectQuery}
          subjects={subjects}
          selected={selected}
          setSelected={setSelected}
          channels={channels}
          toggleChannel={toggleChannel}
          tone={tone}
          setTone={setTone}
          genImages={genImages}
          setGenImages={setGenImages}
          numVariants={numVariants}
          setNumVariants={setNumVariants}
          onGenerate={onGenerate}
          generating={generating}
          result={result}
          selectedAssetIds={selectedAssetIds}
          toggleAsset={toggleAsset}
          seoQueries={seoQueries}
          seoKeywords={seoKeywords}
          toggleSeoKeyword={toggleSeoKeyword}
        />
      )}

      {view === "drafts" && (
        <DraftsView
          drafts={drafts}
          loading={loadingDrafts}
          onLoad={onLoadDraft}
          onDelete={onDeleteDraft}
        />
      )}
    </div>
  );
}

function ComposeView(props) {
  const {
    subjectQuery, setSubjectQuery, subjects, selected, setSelected,
    channels, toggleChannel, tone, setTone,
    genImages, setGenImages, numVariants, setNumVariants,
    onGenerate, generating, result,
    selectedAssetIds, toggleAsset,
    seoQueries, seoKeywords, toggleSeoKeyword,
  } = props;

  return (
    <div className="space-y-4">
      {/* Subject picker */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
          1. Subject
        </div>
        {selected ? (
          <div className="border border-cyan-700/50 bg-cyan-950/10 p-3 flex items-center gap-3" data-testid="ad-creative-selected-subject">
            {selected.image_url && (
              <img src={selected.image_url} alt="" className="w-12 h-12 object-cover" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-display text-base text-ink truncate">{selected.title}</div>
              <div className="font-mono text-[10px] text-brand uppercase tracking-[0.22em]">
                {selected.type} · {selected.slug}
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="p-1.5 text-ink-muted hover:text-ink"
              data-testid="ad-creative-clear-subject"
              aria-label="Clear subject"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
                type="text"
                value={subjectQuery}
                onChange={(e) => setSubjectQuery(e.target.value)}
                placeholder="Search products, makers, or the marketplace itself…"
                className="w-full bg-paper border border-line focus:border-cyan-400 pl-9 pr-3 py-2 font-mono text-sm text-ink outline-none"
                data-testid="ad-creative-subject-search"
              />
            </div>
            {/* iter413r — Site/brand-level subject. Shown first when
                present so admin can run self-promoting marketplace ads
                without scrolling past products/makers. */}
            <SubjectGrid label="Marketplace (brand-level)" items={subjects.site || []} onPick={setSelected} testId="site" />
            <SubjectGrid label="Products" items={subjects.products} onPick={setSelected} testId="products" />
            <SubjectGrid label="Makers"   items={subjects.makers}   onPick={setSelected} testId="makers" />
          </div>
        )}
      </div>

      {/* Channels + tone */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
            2. Channels
          </div>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((ch) => {
              const on = channels.includes(ch.id);
              return (
                <button
                  key={ch.id}
                  onClick={() => toggleChannel(ch.id)}
                  className={`px-3 py-2 border font-mono text-[10px] uppercase tracking-[0.22em] ${on ? "border-cyan-400 text-brand bg-cyan-950/30" : "border-line text-ink-muted hover:border-ink-muted"}`}
                  data-testid={`ad-creative-channel-${ch.id}`}
                >
                  {ch.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
            3. Tone
          </div>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="w-full bg-paper border border-line focus:border-cyan-400 px-3 py-2 font-mono text-sm text-ink outline-none"
            data-testid="ad-creative-tone"
          >
            {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* iter379 — Proven Google queries (from GSC via SEO wins) */}
      {seoQueries.length > 0 && (
        <div data-testid="ad-creative-seo-queries">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
            ✦ Proven Google queries <span className="text-ink-muted/70 normal-case tracking-normal">— terms you already rank for; selected ones get woven into the copy</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {seoQueries.map((q) => {
              const on = seoKeywords.includes(q.query);
              return (
                <button
                  key={q.query}
                  onClick={() => toggleSeoKeyword(q.query)}
                  className={`px-3 py-1.5 border font-mono text-[11px] ${on ? "border-brand text-brand bg-brand/10" : "border-line text-ink-muted hover:border-ink-muted"}`}
                  data-testid={`ad-creative-seo-kw-${q.query.replace(/\s+/g, "-")}`}
                  title={`${q.clicks} clicks · ${q.impressions} impressions · avg position ${q.position}`}
                >
                  {on ? "✓ " : ""}{q.query} <span className="opacity-60">({q.clicks})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Image options */}
      <div className="border border-line p-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox" checked={genImages}
            onChange={(e) => setGenImages(e.target.checked)}
            className="accent-cyan-400"
            data-testid="ad-creative-gen-images"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink flex items-center gap-1.5">
            <ImageIcon size={11} /> Generate image variants (Nano Banana · adds ~30-60s)
          </span>
        </label>
        {genImages && (
          <label className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Variants:</span>
            <select
              value={numVariants}
              onChange={(e) => setNumVariants(Number(e.target.value))}
              className="bg-paper border border-line focus:border-cyan-400 px-2 py-1 font-mono text-xs text-ink outline-none"
              data-testid="ad-creative-num-variants"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
        )}
      </div>

      <ReferenceAssetUploader
        selectedIds={selectedAssetIds}
        onToggleSelect={toggleAsset}
      />

      <button
        onClick={onGenerate}
        disabled={generating || !selected || channels.length === 0}
        className="w-full sm:w-auto px-5 py-2.5 bg-cyan-400 text-[#0a0a0a] font-mono text-xs uppercase tracking-[0.22em] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 justify-center"
        data-testid="ad-creative-generate"
      >
        {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {generating ? "Generating…" : "Generate ad creative"}
      </button>

      {result && <CreativeResult result={result} />}
    </div>
  );
}

function SubjectGrid({ label, items, onPick, testId }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted mb-1.5">{label}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {items.map((it) => (
          <button
            key={`${it.type}-${it.slug}`}
            onClick={() => onPick(it)}
            className="text-left border border-line hover:border-cyan-400 p-2 flex items-center gap-2 group"
            data-testid={`ad-creative-pick-${testId}-${it.slug}`}
          >
            {it.image_url ? (
              <img src={it.image_url} alt="" className="w-10 h-10 object-cover shrink-0" />
            ) : (
              <div className="w-10 h-10 bg-surface shrink-0" />
            )}
            <div className="font-mono text-[11px] text-ink truncate group-hover:text-brand">{it.title}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreativeResult({ result }) {
  const draft = result.draft;
  const spec = result.channel_spec || {};
  const channels = draft.channels || [];
  const hasGoogle = channels.includes("google_search");
  const hasMeta = channels.includes("meta_feed");
  const googleHeadlines = ((draft.copy || {}).google_search || {}).headlines || [];
  const googleHeadlineCount = googleHeadlines.filter((x) => x).length;
  const metaHeadlines = ((draft.copy || {}).meta_feed || {}).headlines || [];
  const metaPrimary = ((draft.copy || {}).meta_feed || {}).primary_texts || [];
  const metaReady = metaHeadlines.filter((x) => x).length > 0 && metaPrimary.filter((x) => x).length > 0;

  return (
    <div className="mt-2 border border-cyan-900/50 bg-cyan-950/10 p-4 space-y-5" data-testid="ad-creative-result">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
          ◆ Generated · draft {draft.draft_id}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasGoogle && (
            <PushToChannelButton
              draft={draft}
              channel={GOOGLE_CHANNEL}
              ready={googleHeadlineCount >= 3}
              readyHint={googleHeadlineCount >= 3 ? "" : `Need ≥3 Google headlines (have ${googleHeadlineCount})`}
              headlineCount={googleHeadlineCount}
            />
          )}
          {hasGoogle && (
            <PushToChannelButton
              draft={draft}
              channel={MICROSOFT_CHANNEL}
              ready={googleHeadlineCount >= 3}
              readyHint={googleHeadlineCount >= 3 ? "" : `Need ≥3 google_search headlines for Microsoft RSA (have ${googleHeadlineCount})`}
              headlineCount={googleHeadlineCount}
            />
          )}
          {hasMeta && (
            <PushToChannelButton
              draft={draft}
              channel={META_CHANNEL}
              ready={metaReady}
              readyHint={metaReady ? "" : "Need ≥1 Meta headline + ≥1 primary text"}
              headlineCount={metaHeadlines.filter((x) => x).length}
            />
          )}
        </div>
      </div>

      {Object.entries(draft.copy || {}).map(([ch, fields]) => (
        <ChannelBlock key={ch} channel={ch} fields={fields} spec={spec[ch]} />
      ))}

      {(draft.images?.length || 0) > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-2 flex items-center gap-1.5">
            <ImageIcon size={11} /> Image variants ({draft.images.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {draft.images.map((src, i) => (
              <div key={src} className="border border-line p-2" data-testid={`ad-creative-image-${i}`}>
                <img src={src} alt={`variant ${i + 1}`} className="w-full aspect-square object-cover" />
                <a
                  href={src} download
                  className="mt-2 w-full px-2 py-1 border border-line hover:border-cyan-400 text-ink-muted hover:text-brand font-mono text-[9px] uppercase tracking-[0.22em] flex items-center justify-center gap-1"
                  data-testid={`ad-creative-image-download-${i}`}
                >
                  <Download size={10} /> Download
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// iter349 — channel configs for the generic push button below.
const GOOGLE_CHANNEL = {
  id: "google",
  label: "Google Ads",
  brandColor: "blue",
  preflight: adminAdCreativeGooglePreflight,
  push: adminPushDraftToGoogle,
  hasKeywords: true,
  // What this channel will create — used to render the "this will create"
  // summary inside the push modal.
  createsLabel: ({ headlineCount, keywords }) => [
    "1 Campaign (Search, PAUSED)",
    "1 Ad Group",
    `1 Responsive Search Ad with ${headlineCount} headlines from this draft`,
    `${keywords ? keywords.split(",").filter(Boolean).length : "auto-derived"} broad-match keywords`,
  ],
  openLinkLabel: "Open in Google Ads",
  openLinkField: "google_ads_url",
  // Map the result.push payload to a list of "Label: value" lines.
  successFields: (push) => [
    ["External campaign ID", push?.external_campaign_id],
    ["Headlines pushed", push?.headline_count],
    ["Descriptions pushed", push?.description_count],
    ["Daily budget", `$${((push?.daily_budget_cents || 0) / 100).toFixed(2)}`],
  ],
  fixHint: (
    <>
      Fix: open the <strong>Google Ads</strong> connection card below in this same tab, complete OAuth, and confirm your developer token is at Basic or Standard tier.
    </>
  ),
};

const META_CHANNEL = {
  id: "meta",
  label: "Meta Ads",
  brandColor: "blue",
  preflight: adminAdCreativeMetaPreflight,
  push: adminPushDraftToMeta,
  hasKeywords: false,
  createsLabel: () => [
    "1 Campaign (OUTCOME_TRAFFIC, PAUSED)",
    "1 Ad Set (USA · link-clicks · PAUSED)",
    "1 Link-ad Creative (uses Meta headline + primary text from this draft)",
    "1 Ad (PAUSED)",
  ],
  openLinkLabel: "Open in Meta Ads Manager",
  openLinkField: "meta_ads_url",
  successFields: (push) => [
    ["External campaign ID", push?.external_campaign_id],
    ["Creative kind", push?.creative_kind || "link"],
    ["Headlines pushed", push?.headline_count],
    ["Primary texts pushed", push?.primary_text_count],
    ["Daily budget", `$${((push?.daily_budget_cents || 0) / 100).toFixed(2)}`],
  ],
  fixHint: (
    <>
      Fix: open the <strong>Meta Ads</strong> connection card below in this same tab, reconnect after Meta App Review approves <code className="font-mono">ads_management</code> scope.
    </>
  ),
};

const MICROSOFT_CHANNEL = {
  id: "microsoft",
  label: "Microsoft Ads",
  brandColor: "blue",
  preflight: adminAdCreativeMicrosoftPreflight,
  push: adminPushDraftToMicrosoft,
  hasKeywords: true,
  createsLabel: ({ headlineCount, keywords }) => [
    "1 Campaign (Bing Search, PAUSED)",
    "1 Ad Group",
    `1 Responsive Search Ad with ${headlineCount} headlines (reuses google_search copy)`,
    `${keywords ? keywords.split(",").filter(Boolean).length : "auto-derived"} broad-match keywords`,
  ],
  openLinkLabel: "Open in Microsoft Advertising",
  openLinkField: "microsoft_ads_url",
  successFields: (push) => [
    ["External campaign ID", push?.external_campaign_id],
    ["Headlines pushed", push?.headline_count],
    ["Descriptions pushed", push?.description_count],
    ["Daily budget", `$${((push?.daily_budget_cents || 0) / 100).toFixed(2)}`],
  ],
  fixHint: (
    <>
      Fix: open the <strong>Microsoft Ads</strong> connection card below in this same tab, complete OAuth, and ensure <code className="font-mono">BING_CUSTOMER_ID</code> + <code className="font-mono">BING_ACCOUNT_ID</code> env vars are set.
    </>
  ),
};

function PushToChannelButton({ draft, channel, ready, readyHint, headlineCount }) {
  const [open, setOpen] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [budget, setBudget] = useState(10); // dollars/day
  const [keywords, setKeywords] = useState("");
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState(null);
  // iter355 — Meta only: optional video creative selection.
  const [videoAssets, setVideoAssets] = useState([]);
  const [videoAssetId, setVideoAssetId] = useState(null);
  const isMetaChannel = channel.id === "meta";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await channel.preflight();
        if (!cancelled) setPreflight(r);
      } catch (e) {
        if (!cancelled) setPreflight({ eligible: false, reason: e?.response?.data?.detail || "Preflight failed." });
      }
    })();
    return () => { cancelled = true; };
  }, [open, channel]);

  // iter355 — fetch uploaded video assets when the Meta push modal opens
  // so the admin can attach one as a video creative (or leave it null
  // to push a static link creative as before).
  useEffect(() => {
    if (!open || !isMetaChannel) return;
    const API = process.env.REACT_APP_BACKEND_URL;
    const token = localStorage.getItem("cm_admin_jwt") || "";
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/admin/ad-creative/uploads?limit=50`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        setVideoAssets((j.assets || []).filter((a) => a.kind === "video"));
      } catch {
        /* silent — feature degrades to link creative */
      }
    })();
    return () => { cancelled = true; };
  }, [open, isMetaChannel]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setPushing(true);
    try {
      const payload = { daily_budget_cents: Math.round(budget * 100) };
      if (channel.hasKeywords) {
        payload.keywords = keywords.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (isMetaChannel && videoAssetId) {
        payload.video_asset_id = videoAssetId;
      }
      const r = await channel.push(draft.draft_id, payload);
      setResult(r);
      toast.success(`Campaign created in PAUSED state. Activate it inside ${channel.label} when ready.`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Push failed.");
    } finally { setPushing(false); }
  };

  const testIdBase = `ad-creative-push-${channel.id}`;

  return (
    <>
      <button
        onClick={() => { setOpen(true); setResult(null); }}
        disabled={!ready}
        className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-ink font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        data-testid={testIdBase}
        title={ready ? `Push to ${channel.label}` : readyHint}
      >
        <Send size={11} /> Push to {channel.label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] bg-paper/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid={`push-${channel.id}-modal`}>
          <div className="w-full max-w-lg bg-paper border border-blue-500/50 p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-blue-700 mb-1">
                  ◆ Push to {channel.label}
                </div>
                <h4 className="font-display text-xl uppercase">{draft.subject_title}</h4>
                <p className="font-mono text-[10px] text-ink-muted mt-1">
                  Campaign will be created in <strong className="text-brand">PAUSED</strong> state. No spend until you activate it inside {channel.label}.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-ink-muted hover:text-ink"
                data-testid={`push-${channel.id}-close`}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {!preflight && (
              <p className="font-mono text-xs text-ink-muted py-4">Checking {channel.label} eligibility…</p>
            )}

            {preflight && !preflight.eligible && (
              <div className="border border-amber-700/50 bg-amber-950/20 p-3 my-3 flex items-start gap-2" data-testid={`push-${channel.id}-not-eligible`}>
                <AlertTriangle size={14} className="text-brand mt-0.5 shrink-0" />
                <div className="font-mono text-xs text-ink leading-relaxed">
                  <div className="font-bold mb-1">Can&rsquo;t push right now</div>
                  <div>{preflight.reason || `${channel.label} not connected.`}</div>
                  <div className="mt-2 text-ink-muted">{channel.fixHint}</div>
                </div>
              </div>
            )}

            {preflight && preflight.eligible && !result && (
              <form onSubmit={onSubmit} className="space-y-3 mt-2" data-testid={`push-${channel.id}-form`}>
                <div className="border border-line p-2 font-mono text-[10px] text-ink-muted">
                  This will create:
                  <ul className="mt-1 ml-3 list-disc text-ink">
                    {channel.createsLabel({ headlineCount, keywords }).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>

                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Daily budget (USD)</span>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-mono text-sm text-ink-muted">$</span>
                    <input
                      type="number" min={5} max={200} step={1}
                      value={budget} onChange={(e) => setBudget(Number(e.target.value))}
                      className="flex-1 bg-paper border border-line focus:border-blue-400 px-3 py-2 font-mono text-sm text-ink outline-none"
                      required
                      data-testid={`push-${channel.id}-budget`}
                    />
                    <span className="font-mono text-[10px] text-ink-muted">/day · clamps $5-$200</span>
                  </div>
                </label>

                {channel.hasKeywords && (
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Keywords (optional · comma-separated)</span>
                    <input
                      type="text" maxLength={500}
                      value={keywords} onChange={(e) => setKeywords(e.target.value)}
                      placeholder="leave empty to auto-derive from product title"
                      className="mt-1 w-full bg-paper border border-line focus:border-blue-400 px-3 py-2 font-mono text-sm text-ink outline-none"
                      data-testid={`push-${channel.id}-keywords`}
                    />
                  </label>
                )}

                {isMetaChannel && (
                  <div data-testid="push-meta-video-picker">
                    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">
                      Video creative (optional)
                      <span className="text-ink-muted/60"> · pick a video from Workshop uploads to push a VIDEO ad instead of a link ad</span>
                    </div>
                    {videoAssets.length === 0 ? (
                      <p className="font-mono text-[10px] text-ink-muted border border-dashed border-line px-3 py-2">
                        No videos uploaded yet. Upload an MP4/MOV/WEBM in the
                        Workshop&rsquo;s <em>Reference assets</em> section to push a video creative.
                      </p>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-44 overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => setVideoAssetId(null)}
                          className={`px-2 py-2 border font-mono text-[10px] uppercase tracking-[0.18em] ${
                            !videoAssetId
                              ? "border-cyan-400 text-brand bg-cyan-950/20"
                              : "border-line text-ink-muted hover:border-ink-muted"
                          }`}
                          data-testid="push-meta-video-none"
                        >
                          No video
                          <div className="text-[9px] mt-0.5 normal-case tracking-normal">link creative</div>
                        </button>
                        {videoAssets.map((a) => {
                          const selected = videoAssetId === a.id;
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => setVideoAssetId(a.id)}
                              className={`relative border ${
                                selected ? "border-cyan-400" : "border-line hover:border-ink-muted"
                              } overflow-hidden group`}
                              data-testid={`push-meta-video-${a.id}`}
                              title={a.original_filename || a.id}
                            >
                              <video
                                src={a.url}
                                muted
                                playsInline
                                preload="metadata"
                                className="w-full aspect-square object-cover"
                              />
                              <div className="absolute inset-x-0 bottom-0 bg-paper/80 px-1 py-0.5 font-mono text-[9px] text-ink truncate">
                                {(a.original_filename || a.id).slice(0, 22)}
                              </div>
                              {selected && (
                                <div className="absolute top-1 right-1 w-4 h-4 bg-cyan-400 text-ink rounded-full flex items-center justify-center">
                                  <Check size={10} />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {videoAssetId && (
                      <p className="font-mono text-[10px] text-brand mt-1">
                        ⚠ Video upload + Meta processing can take 1–3 minutes. Keep this tab open.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button" onClick={() => setOpen(false)}
                    className="px-3 py-2 border border-line hover:border-ink-muted font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted"
                    data-testid={`push-${channel.id}-cancel`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit" disabled={pushing}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-ink font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
                    data-testid={`push-${channel.id}-submit`}
                  >
                    {pushing ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                    {pushing ? "Creating…" : "Create campaign"}
                  </button>
                </div>
              </form>
            )}

            {result && (
              <div className="space-y-3 mt-2 border border-emerald-700/40 bg-emerald-950/10 p-3" data-testid={`push-${channel.id}-success`}>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-700 flex items-center gap-1.5">
                  <Check size={11} /> Campaign created (PAUSED)
                </div>
                <div className="font-mono text-xs text-ink">{result.message}</div>
                <div className="font-mono text-[10px] text-ink-muted space-y-0.5">
                  {channel.successFields(result.push).map(([k, v]) => (
                    <div key={k}>{k}: <span className="text-brand">{v}</span></div>
                  ))}
                </div>
                {result[channel.openLinkField] && (
                  <a
                    href={result[channel.openLinkField]} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 border border-blue-500 text-blue-700 hover:bg-blue-500 hover:text-ink font-mono text-[10px] uppercase tracking-[0.22em] transition"
                    data-testid={`push-${channel.id}-open-link`}
                  >
                    {channel.openLinkLabel} <ExternalLink size={11} />
                  </a>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="ml-2 px-3 py-2 border border-line hover:border-ink-muted font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ChannelBlock({ channel, fields, spec }) {
  const channelLabel = spec?.label || channel;
  return (
    <div className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="font-display text-lg text-brand mb-2">{channelLabel}</div>
      <div className="space-y-3">
        {(spec?.fields || []).map((f) => (
          <div key={f.key}>
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted mb-1">
              {f.label} · {f.count}× ≤{f.max} chars
            </div>
            <div className="space-y-1">
              {(fields[f.key] || []).map((text, i) => (
                <CopyRow key={`${channel}-${f.key}-${i}`} text={text} max={f.max} testId={`copy-${channel}-${f.key}-${i}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CopyRow({ text, max, testId }) {
  const [copied, setCopied] = useState(false);
  const isEmpty = !text;
  const over = text && text.length > max;
  const onCopy = async () => {
    if (isEmpty) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard not available.");
    }
  };
  return (
    <div className="flex items-center gap-2 group">
      <div
        className={`flex-1 px-2 py-1.5 font-mono text-sm border ${isEmpty ? "border-red-900/40 bg-red-950/10 text-red-600 italic" : "border-line bg-paper text-ink"}`}
        data-testid={testId}
      >
        {isEmpty ? "(empty — regenerate)" : text}
      </div>
      <div className={`font-mono text-[9px] tabular-nums w-12 text-right ${over ? "text-red-400" : "text-ink-muted"}`}>
        {(text?.length || 0)}/{max}
      </div>
      <button
        onClick={onCopy}
        disabled={isEmpty}
        className="px-2 py-1.5 border border-line hover:border-cyan-400 text-ink-muted hover:text-brand disabled:opacity-30 disabled:hover:border-line"
        title="Copy"
        data-testid={`${testId}-btn`}
      >
        {copied ? <Check size={12} className="text-emerald-700" /> : <Copy size={12} />}
      </button>
    </div>
  );
}

function DraftsView({ drafts, loading, onLoad, onDelete }) {
  if (loading) return <p className="font-mono text-xs text-ink-muted">Loading drafts…</p>;
  if (drafts.length === 0) {
    return (
      <p className="font-mono text-xs text-ink-muted" data-testid="ad-creative-drafts-empty">
        No drafts yet. Generate your first one from the Compose tab.
      </p>
    );
  }
  return (
    <div className="border border-line divide-y divide-line" data-testid="ad-creative-drafts-list">
      {drafts.map((d) => (
        <div key={d.draft_id} className="p-3 flex items-center gap-3 flex-wrap" data-testid={`ad-creative-draft-row-${d.draft_id}`}>
          {d.subject_image && (
            <img src={d.subject_image} alt="" className="w-10 h-10 object-cover" />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-display text-base text-ink truncate">{d.subject_title}</div>
            <div className="font-mono text-[10px] text-ink-muted flex flex-wrap gap-2 mt-0.5">
              <span className="text-brand">{d.subject_type}</span>
              <span>·</span>
              <span>{(d.channels || []).join(", ")}</span>
              <span>·</span>
              <span>tone: {d.tone}</span>
              {(d.images?.length || 0) > 0 && (
                <>
                  <span>·</span>
                  <span className="text-brand">{d.images.length} image{d.images.length === 1 ? "" : "s"}</span>
                </>
              )}
            </div>
            <div className="font-mono text-[9px] text-ink-muted mt-0.5">{d.created_at}</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onLoad(d.draft_id)}
              className="px-2 py-1 border border-cyan-700/50 hover:border-cyan-400 text-brand font-mono text-[9px] uppercase tracking-[0.22em]"
              data-testid={`ad-creative-load-${d.draft_id}`}
            >
              Open
            </button>
            <button
              onClick={() => onDelete(d)}
              className="px-2 py-1 border border-line hover:border-red-500 hover:text-red-600 text-ink-muted font-mono text-[9px] uppercase tracking-[0.22em]"
              data-testid={`ad-creative-delete-${d.draft_id}`}
              title="Delete"
            >
              <Trash2 size={10} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}


/**
 * iter354 — Reference-asset uploader.
 *
 * Lets admins drop pre-shot product photos / lifestyle videos into the
 * workshop so generated ad copy can be informed by the actual creative
 * that will run. Files persist server-side regardless of whether a
 * draft has been generated yet (standalone library). Future: attach to
 * specific drafts via the optional `draft_id` form field.
 *
 * Caps: 50 MB per file · MIME-allowlist enforced server-side. The
 * preview URL is hot-link safe (cryptographically random asset IDs).
 */
function ReferenceAssetUploader({ selectedIds = [], onToggleSelect }) {
  const API = process.env.REACT_APP_BACKEND_URL;
  const [assets, setAssets] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const adminToken = () => localStorage.getItem("cm_admin_jwt") || "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/admin/ad-creative/uploads?limit=20`, {
        headers: { Authorization: `Bearer ${adminToken()}` },
      });
      if (r.ok) setAssets((await r.json()).assets || []);
    } finally { setLoading(false); }
  }, [API]);

  useEffect(() => { load(); }, [load]);

  const uploadFiles = async (files) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        if (f.size > 50 * 1024 * 1024) {
          toast.error(`${f.name} exceeds the 50 MB cap.`);
          continue;
        }
        const form = new FormData();
        form.append("file", f);
        const r = await fetch(`${API}/api/admin/ad-creative/uploads`, {
          method: "POST",
          headers: { Authorization: `Bearer ${adminToken()}` },
          body: form,
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          toast.error(`${f.name}: ${j.detail || `HTTP ${r.status}`}`);
        } else {
          toast.success(`Uploaded ${f.name}`);
        }
      }
      await load();
    } finally { setUploading(false); }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    uploadFiles(e.dataTransfer?.files);
  };

  const onPick = (e) => {
    uploadFiles(e.target.files);
    e.target.value = "";
  };

  const deleteAsset = async (id) => {
    const r = await fetch(`${API}/api/admin/ad-creative/uploads/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken()}` },
    });
    if (r.ok) {
      toast.success("Asset deleted.");
      load();
    } else {
      toast.error("Delete failed.");
    }
  };

  return (
    <div className="space-y-2" data-testid="ad-creative-uploads">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
        4. Reference assets <span className="text-ink-muted/60">(optional · click to use up to 4 as generation anchors)</span>
      </div>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={[
          "flex flex-col items-center justify-center gap-1 px-4 py-6 border-2 border-dashed cursor-pointer transition",
          dragOver ? "border-cyan-400 bg-cyan-950/10" : "border-line hover:border-cyan-400/60",
          uploading ? "opacity-60 pointer-events-none" : "",
        ].join(" ")}
        data-testid="ad-creative-upload-dropzone"
      >
        <input
          type="file" multiple
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,video/mpeg"
          onChange={onPick}
          className="hidden"
          data-testid="ad-creative-upload-input"
          disabled={uploading}
        />
        <ImageIcon size={20} className="text-ink-muted" />
        <div className="font-mono text-xs text-ink">
          {uploading ? "Uploading…" : "Drop images or videos here, or click to pick"}
        </div>
        <div className="font-mono text-[10px] text-ink-muted">
          JPG / PNG / WEBP / GIF · MP4 / MOV / WEBM · 50 MB max each
        </div>
      </label>

      {(loading || assets.length > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 mt-2">
          {assets.map((a) => {
            const isSelected = selectedIds.includes(a.id);
            return (
              <div key={a.id}
                   onClick={() => onToggleSelect && onToggleSelect(a.id)}
                   className={[
                     "relative border bg-paper aspect-square overflow-hidden group cursor-pointer transition",
                     isSelected ? "border-brand ring-2 ring-brand/40" : "border-line hover:border-brand/60",
                   ].join(" ")}
                   data-testid={`ad-creative-asset-${a.id}`}>
                {a.kind === "video" ? (
                  <video src={a.url} className="w-full h-full object-cover" muted />
                ) : (
                  <img src={a.url} alt={a.original_filename || a.id}
                       className="w-full h-full object-cover" loading="lazy" />
                )}
                {isSelected && (
                  <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-brand text-paper font-mono text-[9px] uppercase tracking-[0.18em]"
                       data-testid={`ad-creative-asset-selected-${a.id}`}>
                    ◆ Ref {selectedIds.indexOf(a.id) + 1}
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-paper/80 backdrop-blur px-2 py-1 font-mono text-[9px] text-ink truncate">
                  {a.kind === "video" ? "▶ " : ""}{a.original_filename || a.id}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteAsset(a.id); }}
                  className="absolute top-1 right-1 p-1 bg-paper/70 backdrop-blur border border-line text-red-400 hover:bg-red-500 hover:text-paper transition opacity-0 group-hover:opacity-100"
                  title="Delete asset"
                  data-testid={`ad-creative-asset-delete-${a.id}`}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
