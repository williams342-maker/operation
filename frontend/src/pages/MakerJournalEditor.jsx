/**
 * Maker Journal Editor — `/maker/journal/new`
 *
 * Lets a signed-in maker compose a journal post that lands directly on
 * the public /journal feed. The form is intentionally minimal:
 *   • Title
 *   • Cover image URL (optional — defaults to the maker's shop cover)
 *   • Excerpt — 1–2 sentence hook shown on the journal index
 *   • Body — full post (markdown welcome, but rendered as plain text
 *     in the current JournalDetail view, so paragraphs use blank lines)
 *
 * Surfaces the maker's own past posts beneath the form so they can edit
 * cadence at a glance and delete typos. No moderation queue — vetted
 * makers publish directly. Admin can audit via `created_by_maker`.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Save, Trash2, ExternalLink, Sparkles, ImagePlus, Loader2 } from "lucide-react";
import {
  createMakerJournalPost, fetchMyMakerJournalPosts,
  deleteMakerJournalPost, fetchMakerMe, uploadMakerJournalImage,
} from "../lib/api";

const MIN_TITLE = 6;
const MIN_EXCERPT = 20;
const MIN_BODY = 100;

export default function MakerJournalEditor() {
  const navigate = useNavigate();
  const [maker, setMaker] = useState(null);
  const [form, setForm] = useState({ title: "", cover: "", excerpt: "", body: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [posts, setPosts] = useState([]);
  const bodyRef = useRef(null);
  const fileInputRef = useRef(null);

  // Auth check + initial loads. Bounce to maker login if no JWT — the
  // API would 401 anyway, but the bounce makes the UX nicer.
  useEffect(() => {
    if (!localStorage.getItem("cm_maker_jwt")) {
      navigate("/maker/login?next=/maker/journal/new", { replace: true });
      return;
    }
    fetchMakerMe().then(setMaker).catch(() => {});
    fetchMyMakerJournalPosts().then(setPosts).catch(() => setPosts([]));
  }, [navigate]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Title-level validation surface — drives the disabled state on the
  // submit button without yelling at the maker mid-typing.
  const issues = useMemo(() => {
    const out = [];
    if (form.title.trim().length < MIN_TITLE) out.push(`Title needs ≥ ${MIN_TITLE} chars`);
    if (form.excerpt.trim().length < MIN_EXCERPT) out.push(`Excerpt needs ≥ ${MIN_EXCERPT} chars`);
    if (form.body.trim().length < MIN_BODY) out.push(`Body needs ≥ ${MIN_BODY} chars`);
    if (form.cover.trim() && !/^https?:\/\//i.test(form.cover.trim())) out.push("Cover must start with https://");
    return out;
  }, [form]);

  const wordCount = useMemo(
    () => (form.body.trim().match(/\w+/g) || []).length,
    [form.body],
  );
  const readMin = Math.max(1, Math.ceil(wordCount / 225));

  // Insert markdown image syntax at the textarea cursor, falling back
  // to appending at end of body. Wraps in blank lines so the image
  // renders as its own block in JournalBody (a paragraph that is just
  // an image gets rendered as a standalone <img>).
  const insertAtCursor = (snippet) => {
    const ta = bodyRef.current;
    const cur = form.body;
    if (!ta) {
      set({ body: cur + (cur ? "\n\n" : "") + snippet });
      return;
    }
    const start = ta.selectionStart ?? cur.length;
    const end = ta.selectionEnd ?? cur.length;
    // Add surrounding blank lines so the embed becomes its own paragraph
    const before = cur.slice(0, start);
    const after = cur.slice(end);
    const needsLeadGap = before && !before.endsWith("\n\n");
    const needsTrailGap = after && !after.startsWith("\n\n");
    const next = before
      + (needsLeadGap ? "\n\n" : "")
      + snippet
      + (needsTrailGap ? "\n\n" : "")
      + after;
    set({ body: next });
    // Restore caret right after the inserted snippet so the maker can
    // keep typing without scrolling back.
    requestAnimationFrame(() => {
      const caret = next.length - after.length - (needsTrailGap ? 2 : 0);
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  };

  const handleImageFile = async (file) => {
    if (!file?.type?.startsWith("image/")) {
      toast.error("Only image files are supported here.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image too large — keep under 8MB.");
      return;
    }
    setUploading(true);
    try {
      const { url } = await uploadMakerJournalImage(file);
      insertAtCursor(`![](${url})`);
      toast.success("Image inserted.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Image upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (issues.length > 0) {
      toast.error(issues[0]);
      return;
    }
    setSaving(true);
    try {
      const created = await createMakerJournalPost({
        title: form.title.trim(),
        excerpt: form.excerpt.trim(),
        body: form.body.trim(),
        cover: form.cover.trim() || null,
      });
      toast.success("Post published — landed on /journal.");
      // Land the maker on their fresh post so they can verify how it reads
      navigate(`/journal/${created.slug}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't publish — try again.");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (slug) => {
    if (!window.confirm("Delete this post permanently? This can't be undone.")) return;
    try {
      await deleteMakerJournalPost(slug);
      setPosts((p) => p.filter((x) => x.slug !== slug));
      toast.success("Post deleted.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed.");
    }
  };

  return (
    <div className="min-h-screen bg-paper text-ink grain pt-24 pb-32" data-testid="maker-journal-editor">
      <div className="max-w-4xl mx-auto px-6">
        <Link
          to="/maker/dashboard"
          className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition mb-8"
          data-testid="back-to-dashboard"
        >
          <ArrowLeft size={12} /> Back to dashboard
        </Link>

        <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-brand mb-3 flex items-center gap-2">
          <Sparkles size={12} /> Write For The Journal
        </div>
        <h1 className="font-display text-4xl sm:text-5xl md:text-6xl uppercase leading-[0.95] mb-4">
          Tell your<br /><span className="text-brand">story.</span>
        </h1>
        <p className="font-mono text-sm text-ink-muted max-w-2xl leading-relaxed mb-12">
          Posts publish straight to <span className="text-ink">/journal</span> under your shop name —
          {maker?.name ? ` "${maker.name}"` : ""}.
          Buyers find you organically. The strongest entries share a build process,
          a finishing technique, or what made you choose this craft.
        </p>

        {/* ---------- Form ---------- */}
        <div className="space-y-8">
          <Field
            label="Title"
            hint="6+ chars · Use a strong hook ('How We Pick A Patina', not 'My Process')"
            value={form.title}
            onChange={(v) => set({ title: v })}
            testId="journal-title"
            placeholder="How We Pick A Patina That Ages With The House"
          />

          <Field
            label="Cover image URL (optional)"
            hint="Public https:// URL — leave blank to fall back to your shop cover."
            value={form.cover}
            onChange={(v) => set({ cover: v })}
            testId="journal-cover"
            placeholder="https://images.unsplash.com/…"
          />

          <Field
            label="Excerpt"
            hint={`The 1-2 sentence hook on the index. Currently ${form.excerpt.length} chars (min ${MIN_EXCERPT}).`}
            value={form.excerpt}
            onChange={(v) => set({ excerpt: v })}
            testId="journal-excerpt"
            multiline
            rows={3}
            placeholder="Why we left raw steel outside for a year and what survived."
          />

          {/* Body field with drag-drop image upload. We intentionally
              built this inline (not via the shared <Field>) because the
              dropzone state / file-input wiring is too coupled to the
              textarea ref + insertAtCursor utility to abstract cleanly. */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <label className="block font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted">
                Body
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand inline-flex items-center gap-1.5 disabled:opacity-50 transition"
                data-testid="journal-image-button"
              >
                {uploading ? <Loader2 size={11} className="animate-spin" /> : <ImagePlus size={11} />}
                {uploading ? "Uploading…" : "Insert image"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageFile(f);
                  e.target.value = "";
                }}
                data-testid="journal-image-input"
              />
            </div>
            <div
              className={`relative ${dragOver ? "ring-2 ring-[#ff4500] ring-offset-2 ring-offset-[#0a0a0a]" : ""} transition`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = Array.from(e.dataTransfer.files || []).find((x) => x.type.startsWith("image/"));
                if (f) handleImageFile(f);
              }}
            >
              <textarea
                ref={bodyRef}
                value={form.body}
                onChange={(e) => set({ body: e.target.value })}
                rows={16}
                className="w-full bg-surface border border-line focus:border-brand outline-none px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-muted resize-y leading-relaxed transition"
                placeholder="Open with the question your buyer is wondering, then walk through the answer like you're talking shop."
                data-testid="journal-body"
                onPaste={(e) => {
                  // Pasted images (screenshot-from-clipboard workflow)
                  // also flow through the same upload pipeline.
                  const f = Array.from(e.clipboardData?.files || []).find((x) => x.type.startsWith("image/"));
                  if (f) { e.preventDefault(); handleImageFile(f); }
                }}
              />
              {dragOver && (
                <div className="absolute inset-0 bg-brand/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                  <div className="font-mono text-xs uppercase tracking-[0.22em] text-brand flex items-center gap-2">
                    <ImagePlus size={14} /> Drop image to insert
                  </div>
                </div>
              )}
            </div>
            <p className="font-mono text-[10px] text-ink-muted">
              Full post. Blank lines = new paragraph. Drop or paste images to embed inline. {wordCount} words · ~{readMin} min read · min {MIN_BODY} chars.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={submit}
              disabled={saving || issues.length > 0}
              className="px-5 py-3 border border-brand bg-brand text-black font-mono text-xs uppercase tracking-[0.22em] font-bold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-hover transition"
              data-testid="journal-submit"
            >
              <Save size={13} /> {saving ? "Publishing…" : "Publish post"}
            </button>
            {issues.length > 0 && (
              <span className="font-mono text-[10px] text-amber-400" data-testid="journal-issues">
                ⚠ {issues[0]}
              </span>
            )}
          </div>
        </div>

        {/* ---------- Existing posts ---------- */}
        {posts.length > 0 && (
          <section className="mt-20 pt-10 border-t border-line" data-testid="journal-mine">
            <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-ink-muted mb-6">
              ◆ Your published posts ({posts.length})
            </div>
            <ul className="divide-y divide-[#1f1f1f] border border-line">
              {posts.map((p) => (
                <li
                  key={p.slug}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  data-testid={`journal-mine-row-${p.slug}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm text-ink truncate">{p.title}</div>
                    <div className="font-mono text-[10px] text-ink-muted mt-0.5">
                      {(p.created_at || "").slice(0, 10)} · {p.read_min || "—"} min read
                    </div>
                  </div>
                  <Link
                    to={`/journal/${p.slug}`}
                    className="px-2.5 py-1.5 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5"
                    data-testid={`journal-mine-view-${p.slug}`}
                  >
                    <ExternalLink size={11} /> View
                  </Link>
                  <button
                    onClick={() => onDelete(p.slug)}
                    className="px-2.5 py-1.5 border border-red-900/60 text-red-300 hover:border-red-500 hover:text-red-200 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5"
                    data-testid={`journal-mine-delete-${p.slug}`}
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, value, onChange, testId, placeholder, multiline, rows = 3 }) {
  const cls = "w-full bg-surface border border-line focus:border-brand outline-none px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-muted transition";
  return (
    <div className="space-y-2">
      <label className="block font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className={`${cls} resize-y leading-relaxed`}
          placeholder={placeholder}
          data-testid={testId}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
          placeholder={placeholder}
          data-testid={testId}
        />
      )}
      {hint && <p className="font-mono text-[10px] text-ink-muted">{hint}</p>}
    </div>
  );
}
