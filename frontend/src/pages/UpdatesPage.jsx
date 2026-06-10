/**
 * Public "What's New" page — auto-renders the last 20 changelog entries
 * from /api/updates. Refreshes automatically on every redeploy because
 * the backend reads /app/memory/CHANGELOG.md at request time.
 *
 * Aesthetic: industrial timeline. One vertical orange spine on the left;
 * each entry is a card hanging off it with a date pill, title, and
 * plain-English summary. Loud + scannable, no engineering jargon.
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { Sparkles, RefreshCw, ArrowRight, Mail, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useStructuredData } from "../lib/seo";
import { subscribeToUpdates } from "../lib/api";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fmtDate = (yymm) => {
  // "2026-05" → "May 2026"
  if (!yymm || !/^\d{4}-\d{2}$/.test(yymm)) return yymm || "";
  const [y, m] = yymm.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${y}`;
};

export default function UpdatesPage() {
  useStructuredData({
    title: "What's New · Crafters Market",
    description:
      "Recent improvements to Crafters Market — new features, bug fixes, and quality-of-life updates. Refreshed on every release.",
    url: "https://craftersmarket.org/updates",
  });

  const [entries, setEntries] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/updates?limit=20`);
        if (cancelled) return;
        setEntries(r.data?.entries || []);
        setUpdatedAt(r.data?.updated_at || null);
      } catch (e) {
        if (!cancelled) setErr("Couldn't load updates. Try again later.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-paper text-ink grain pt-24 pb-32" data-testid="updates-page">
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="mb-16 md:mb-20">
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-brand mb-4 flex items-center gap-2">
            <Sparkles size={12} /> Updates &amp; Improvements
          </div>
          <h1 className="font-display text-5xl sm:text-7xl md:text-8xl uppercase leading-[0.92] tracking-[-0.02em] mb-6">
            What's<br /><span className="text-brand">New.</span>
          </h1>
          <p className="font-mono text-sm text-ink-muted max-w-xl leading-relaxed">
            Recent improvements to Crafters Market. New features, bug fixes, and quality-of-life updates — refreshed automatically on every release.
          </p>
          {updatedAt && (
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted mt-6 flex items-center gap-2">
              <RefreshCw size={10} />
              Last refreshed {new Date(updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </div>
          )}
        </div>

        {/* Subscribe — capture email so each future redeploy with a new
            CHANGELOG entry triggers a digest. Idempotent on backend. */}
        <SubscribeCard />

        {loading && (
          <div className="font-mono text-xs text-ink-muted" data-testid="updates-loading">Loading…</div>
        )}
        {err && (
          <div className="font-mono text-xs text-red-400" data-testid="updates-error">{err}</div>
        )}

        {!loading && !err && entries.length === 0 && (
          <div className="font-mono text-xs text-ink-muted">No updates yet.</div>
        )}

        {/* Timeline */}
        {!loading && entries.length > 0 && (
          <div className="relative" data-testid="updates-timeline">
            {/* The orange spine running down the left edge */}
            <div
              className="absolute left-[7px] top-3 bottom-3 w-px bg-gradient-to-b from-[#ff4500]/60 via-[#ff4500]/20 to-transparent"
              aria-hidden="true"
            />
            <ul className="space-y-10 md:space-y-12">
              {entries.map((e, i) => (
                <li
                  key={`${e.date}-${e.iter}`}
                  className="relative pl-10"
                  data-testid={`update-entry-${i}`}
                >
                  {/* Spine node */}
                  <span
                    className={`absolute left-0 top-2 w-[15px] h-[15px] border-2 ${
                      i === 0
                        ? "bg-brand border-brand shadow-[0_0_18px_#ff4500]"
                        : "bg-paper border-brand/60"
                    }`}
                    aria-hidden="true"
                  />
                  <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted mb-2">
                    {fmtDate(e.date)}
                    {i === 0 && (
                      <span className="ml-3 px-2 py-0.5 bg-brand/15 border border-brand/40 text-brand tracking-[0.22em]">
                        Latest
                      </span>
                    )}
                  </div>
                  <h2 className="font-display text-2xl sm:text-3xl uppercase leading-[1.05] tracking-[-0.01em] mb-3">
                    {e.title}
                  </h2>
                  {e.blurb && (
                    <p className="font-mono text-[13px] text-ink-muted leading-relaxed">
                      {e.blurb}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer CTA — pull traffic into the beta funnel */}
        <div className="mt-20 pt-12 border-t border-line text-center">
          <p className="font-mono text-xs text-ink-muted mb-6">
            Got an idea or a bug to report?
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/contact"
              className="btn-industrial inline-flex items-center gap-2"
              data-testid="updates-contact-cta"
            >
              Send Feedback <ArrowRight size={14} />
            </Link>
            <Link
              to="/beta"
              className="btn-industrial btn-primary inline-flex items-center gap-2"
              data-testid="updates-beta-cta"
            >
              Join the Beta <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------- subscribe card --------------------
function SubscribeCard() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await subscribeToUpdates(email.trim(), name.trim() || null);
      if (r?.ok) setDone(true);
      else setErr("That doesn't look like a valid email.");
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Couldn't subscribe. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div
        className="mb-16 border border-brand/40 bg-gradient-to-br from-[#1a0a05] to-[#0f0f0f] p-6 md:p-8 flex items-center gap-4"
        data-testid="updates-subscribe-success"
      >
        <CheckCircle2 size={28} className="text-brand shrink-0" />
        <div>
          <div className="font-display text-xl uppercase leading-tight mb-1">You're on the list.</div>
          <p className="font-mono text-xs text-ink-muted leading-relaxed">
            We'll only email you when something new ships. No filler. Unsubscribe in one click any time.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mb-16 border border-line bg-paper p-6 md:p-8"
      data-testid="updates-subscribe-card"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-brand mb-3">
        <Mail size={12} /> Stay in the loop
      </div>
      <h3 className="font-display text-2xl md:text-3xl uppercase leading-tight mb-2">
        Get an email when we ship something new.
      </h3>
      <p className="font-mono text-xs text-ink-muted leading-relaxed mb-5 max-w-xl">
        One short digest only when there's a real update. No marketing. One-click unsubscribe.
      </p>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3" data-testid="updates-subscribe-form">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            maxLength={120}
            className="bg-paper border border-line focus:border-brand outline-none px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-muted"
            data-testid="updates-subscribe-name"
          />
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
            maxLength={200}
            className="bg-paper border border-line focus:border-brand outline-none px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-muted"
            data-testid="updates-subscribe-email"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="btn-industrial btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-50"
          data-testid="updates-subscribe-submit"
        >
          {busy ? "Subscribing…" : "Subscribe"} <ArrowRight size={14} />
        </button>
      </form>
      {err && (
        <div className="mt-3 font-mono text-[11px] text-red-400" data-testid="updates-subscribe-error">
          {err}
        </div>
      )}
    </div>
  );
}
