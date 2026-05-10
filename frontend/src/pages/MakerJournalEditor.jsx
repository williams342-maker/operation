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
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Save, Trash2, ExternalLink, Sparkles } from "lucide-react";
import {
  createMakerJournalPost, fetchMyMakerJournalPosts,
  deleteMakerJournalPost, fetchMakerMe,
} from "../lib/api";

const MIN_TITLE = 6;
const MIN_EXCERPT = 20;
const MIN_BODY = 100;

export default function MakerJournalEditor() {
  const navigate = useNavigate();
  const [maker, setMaker] = useState(null);
  const [form, setForm] = useState({ title: "", cover: "", excerpt: "", body: "" });
  const [saving, setSaving] = useState(false);
  const [posts, setPosts] = useState([]);

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
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] grain pt-24 pb-32" data-testid="maker-journal-editor">
      <div className="max-w-4xl mx-auto px-6">
        <Link
          to="/maker/dashboard"
          className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition mb-8"
          data-testid="back-to-dashboard"
        >
          <ArrowLeft size={12} /> Back to dashboard
        </Link>

        <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#ff4500] mb-3 flex items-center gap-2">
          <Sparkles size={12} /> Write For The Journal
        </div>
        <h1 className="font-display text-4xl sm:text-5xl md:text-6xl uppercase leading-[0.95] mb-4">
          Tell your<br /><span className="text-[#ff4500]">story.</span>
        </h1>
        <p className="font-mono text-sm text-[#a3a3a3] max-w-2xl leading-relaxed mb-12">
          Posts publish straight to <span className="text-[#e5e5e5]">/journal</span> under your shop name —
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

          <Field
            label="Body"
            hint={`Full post. Blank lines = new paragraph. ${wordCount} words · ~${readMin} min read · min ${MIN_BODY} chars.`}
            value={form.body}
            onChange={(v) => set({ body: v })}
            testId="journal-body"
            multiline
            rows={16}
            placeholder="Open with the question your buyer is wondering, then walk through the answer like you're talking shop."
          />

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={submit}
              disabled={saving || issues.length > 0}
              className="px-5 py-3 border border-[#ff4500] bg-[#ff4500] text-black font-mono text-xs uppercase tracking-[0.22em] font-bold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#ff5a1a] transition"
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
          <section className="mt-20 pt-10 border-t border-[#262626]" data-testid="journal-mine">
            <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#a3a3a3] mb-6">
              ◆ Your published posts ({posts.length})
            </div>
            <ul className="divide-y divide-[#1f1f1f] border border-[#1f1f1f]">
              {posts.map((p) => (
                <li
                  key={p.slug}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  data-testid={`journal-mine-row-${p.slug}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm text-[#e5e5e5] truncate">{p.title}</div>
                    <div className="font-mono text-[10px] text-[#525252] mt-0.5">
                      {(p.created_at || "").slice(0, 10)} · {p.read_min || "—"} min read
                    </div>
                  </div>
                  <Link
                    to={`/journal/${p.slug}`}
                    className="px-2.5 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5"
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
  const cls = "w-full bg-[#0d0d0d] border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5] placeholder:text-[#525252] transition";
  return (
    <div className="space-y-2">
      <label className="block font-mono text-[10px] uppercase tracking-[0.28em] text-[#a3a3a3]">
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
      {hint && <p className="font-mono text-[10px] text-[#525252]">{hint}</p>}
    </div>
  );
}
