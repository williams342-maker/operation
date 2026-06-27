import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, X, Send, Sparkles, AlertTriangle } from "lucide-react";
import { useLocation } from "react-router-dom";
import { helpChat, helpReportIssue } from "../lib/api";

// iter312 — Onboarding-focused Help & Support AI chat.
// Distinct from `AIAssistant.jsx` (buyer concierge for product Q&A).
// This widget answers platform-mechanics: Stripe Connect, listing schema,
// pricing, custom orders, payouts, returns, etc. Auto-detects user role
// from localStorage tokens so answers tailor to maker vs buyer vs visitor.
//
// iter413ct — Repositioned from a support-ticket UX to a marketplace
// concierge UX. Display strings are centralised in ASSISTANT_BRAND so
// the eventual permanent rebrand is a one-line change. Header label is
// intentionally neutral ("AI Marketplace Assistant") until the user
// finalises the long-term brand name.

// ▸▸▸ Brand surface — single source of truth. Change once when the
// permanent name is chosen; do NOT inline these strings elsewhere.
const ASSISTANT_BRAND = {
  // Header label shown in the widget chrome. Keep neutral until the
  // permanent name is locked.
  header_label: "AI Marketplace Assistant",
  // Eyebrow under the header. Stays the same across rebrands.
  header_sub: (role) => `Role: ${role}`,
  // Welcome message — one greeting for everyone. Tone: welcoming,
  // value-forward, both-audiences.
  welcome: (
    "Hi! I'm Crafters Market's AI Marketplace Assistant. I can help you " +
    "discover handmade products, answer questions about buying or selling, " +
    "recommend makers, or help you start selling on Crafters Market."
  ),
};

// iter413ct — Starter prompts repositioned around discovery + maker
// onboarding. Same five chips render for every role; the assistant
// itself tailors the answer based on USER ROLE in the system prompt.
const STARTER_HINTS = [
  "Help me find the perfect handmade gift",
  "Recommend handmade wall art",
  "Find makers near me",
  "Explain how custom orders work",
  "Help me open my own shop",
];

function detectRole() {
  try {
    if (localStorage.getItem("cm_admin_jwt")) return "admin";
    if (localStorage.getItem("cm_maker_jwt")) return "maker";
    if (localStorage.getItem("cm_buyer_jwt") || localStorage.getItem("cm_community_jwt")) return "buyer";
  } catch (_e) { /* ignore */ }
  return "visitor";
}

function roleGreeting(_role) {
  return ASSISTANT_BRAND.welcome;
}

export default function HelpSupportWidget() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(detectRole());
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem("cm_help_messages");
      if (saved) return JSON.parse(saved);
    } catch (_e) { /* fall through */ }
    return [{ role: "assistant", text: roleGreeting(detectRole()) }];
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(() => localStorage.getItem("cm_help_session"));
  // iter413cq — bug-report cue tracking + modal state
  const [bugCueOpen, setBugCueOpen] = useState(false);
  const [reportModal, setReportModal] = useState(false);
  const [reportDraft, setReportDraft] = useState("");
  const [reportEmail, setReportEmail] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportResult, setReportResult] = useState(null); // {ok, id, error}
  const scrollRef = useRef(null);

  // Refresh role on every route change — covers post-login transitions.
  useEffect(() => { setRole(detectRole()); }, [location.pathname]);

  useEffect(() => {
    try { localStorage.setItem("cm_help_messages", JSON.stringify(messages.slice(-40))); }
    catch (_e) { /* quota */ }
  }, [messages]);

  useEffect(() => {
    if (sessionId) localStorage.setItem("cm_help_session", sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const send = async (overrideText) => {
    const text = (overrideText ?? draft).trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await helpChat({
        message: text,
        session_id: sessionId,
        page_url: location.pathname,
        user_role: role,
      });
      if (res?.session_id) setSessionId(res.session_id);
      setMessages((m) => [...m, { role: "assistant", text: res.reply }]);
      // iter413cq — server flags bug-flavored exchanges. Surface the
      // "Report Issue" CTA inline below the latest assistant message.
      setBugCueOpen(Boolean(res?.report_issue_cue));
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "I'm having trouble reaching the server right now — try again in a moment, or email team@craftersmarket.org." },
      ]);
      setBugCueOpen(false);
    } finally { setBusy(false); }
  };

  const resetChat = () => {
    setMessages([{ role: "assistant", text: roleGreeting(role) }]);
    setSessionId(null);
    setBugCueOpen(false);
    setReportResult(null);
    localStorage.removeItem("cm_help_session");
    localStorage.removeItem("cm_help_messages");
  };

  // iter413cq — derive listing/maker context from the current URL so
  // the bug report carries it automatically. Routes:
  //   /shop/<slug> → listing_slug
  //   /makers/<slug> → maker_slug
  const listingCtx = useMemo(() => {
    const path = location.pathname || "";
    const shop = path.match(/^\/shop\/([^/?#]+)/);
    const maker = path.match(/^\/makers?\/([^/?#]+)/);
    return {
      listing_slug: shop ? shop[1] : null,
      maker_slug: maker ? maker[1] : null,
    };
  }, [location.pathname]);

  const openReportModal = () => {
    setReportDraft("");
    setReportEmail("");
    setReportResult(null);
    setReportModal(true);
  };

  const submitReport = async (e) => {
    e?.preventDefault?.();
    const desc = reportDraft.trim();
    if (desc.length < 4 || reportSending) return;
    setReportSending(true);
    // Capture the last few turns as the AI diagnosis context.
    const tail = messages.slice(-6).map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      text: (m.text || "").slice(0, 4000),
    }));
    const payload = {
      description: desc,
      session_id: sessionId,
      user_role: role,
      page_url: location.pathname + (location.search || ""),
      listing_slug: listingCtx.listing_slug,
      maker_slug: listingCtx.maker_slug,
      user_agent: (typeof navigator !== "undefined" && navigator.userAgent) || null,
      viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : null,
      reporter_email: reportEmail.trim() || null,
      conversation: tail,
    };
    try {
      const res = await helpReportIssue(payload);
      setReportResult({ ok: true, id: res?.id });
      // Surface confirmation in the chat too.
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "Thanks — your report is in. Our team will follow up at the email on file or via this chat. Reference ID: " + (res?.id || "n/a"),
        },
      ]);
      setBugCueOpen(false);
    } catch (err) {
      setReportResult({
        ok: false,
        error:
          err?.response?.data?.detail ||
          "Couldn't send the report just now. Try again in a moment or email team@craftersmarket.org.",
      });
    } finally {
      setReportSending(false);
    }
  };

  // Hide on admin/maker dashboard root paths if a user prefers focus — opt-out
  // by checking ?nohelp=1 in URL. Default: always visible.
  const params = new URLSearchParams(location.search);
  if (params.get("nohelp") === "1") return null;

  const hints = STARTER_HINTS;

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close marketplace assistant" : "Open marketplace assistant"}
        data-testid="help-widget-toggle"
        className="fixed bottom-24 right-24 z-[60] bg-paper text-brand w-12 h-12 flex items-center justify-center border-2 border-cyan-700/70 hover:border-cyan-400 hover:rotate-3 transition-all shadow-[0_0_20px_rgba(34,211,238,0.25)]"
      >
        {open ? <X size={20} /> : <HelpCircle size={20} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-44 right-4 sm:right-24 z-[60] w-[min(92vw,400px)] h-[min(70vh,560px)] bg-paper border border-cyan-900/60 flex flex-col"
            data-testid="help-widget-panel"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-900/60 bg-cyan-950/20">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-brand" />
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand" data-testid="help-widget-brand">
                    {ASSISTANT_BRAND.header_label}
                  </div>
                  <div className="font-mono text-[9px] text-ink-muted uppercase tracking-[0.18em]">
                    {ASSISTANT_BRAND.header_sub(role)}
                  </div>
                </div>
              </div>
              <button
                onClick={resetChat}
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted hover:text-brand"
                data-testid="help-widget-reset"
                title="Start a new chat"
              >
                ↻ New
              </button>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm"
              data-testid="help-widget-messages"
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[88%] font-mono text-[12px] leading-relaxed ${
                    m.role === "user"
                      ? "ml-auto bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] border border-[color-mix(in_srgb,var(--brand)_45%,transparent)] text-ink px-3 py-2"
                      : "mr-auto bg-surface border border-line text-ink px-3 py-2 whitespace-pre-wrap"
                  }`}
                  data-testid={`help-msg-${m.role}`}
                >
                  {m.text}
                </div>
              ))}
              {busy && (
                <div
                  className="mr-auto bg-surface border border-line text-ink-muted font-mono text-[12px] px-3 py-2 animate-pulse"
                  data-testid="help-msg-thinking"
                >
                  Thinking…
                </div>
              )}

              {/* iter413cq — Report Issue CTA when the assistant flags a bug */}
              {bugCueOpen && !busy && (
                <div
                  className="mr-auto max-w-[88%] border border-[color-mix(in_srgb,var(--brand)_45%,transparent)] bg-[color-mix(in_srgb,var(--brand)_10%,transparent)] px-3 py-2 flex items-center gap-2"
                  data-testid="help-widget-report-cta-wrap"
                >
                  <AlertTriangle size={14} className="text-brand shrink-0" />
                  <div className="font-mono text-[11px] text-ink flex-1">
                    Looks like a bug. Want to send a structured report to our team?
                  </div>
                  <button
                    onClick={openReportModal}
                    className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand hover:text-brand-hover border border-brand px-2 py-1"
                    data-testid="help-widget-report-cta"
                  >
                    Report Issue
                  </button>
                </div>
              )}

              {/* Starter hints — only show when conversation is fresh */}
              {messages.length === 1 && (
                <div className="pt-2 space-y-1.5" data-testid="help-widget-hints">
                  <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted mb-1">
                    Try asking
                  </div>
                  {hints.map((h, i) => (
                    <button
                      key={i}
                      onClick={() => send(h)}
                      className="block w-full text-left font-mono text-[11px] text-brand hover:text-brand-hover hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] border border-line px-2 py-1.5 transition-colors"
                      data-testid={`help-widget-hint-${i}`}
                    >
                      → {h}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              className="border-t border-cyan-900/60 px-3 py-2.5 flex items-center gap-2 bg-paper"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask anything…"
                disabled={busy}
                className="flex-1 bg-transparent font-mono text-[12px] text-ink placeholder:text-ink-muted focus:outline-none disabled:opacity-50"
                data-testid="help-widget-input"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                aria-label="Send"
                className="text-brand hover:text-brand disabled:opacity-30 disabled:cursor-not-allowed"
                data-testid="help-widget-send"
              >
                <Send size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* iter413cq — Report Issue modal */}
      <AnimatePresence>
        {reportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4"
            data-testid="help-widget-report-modal-backdrop"
            onClick={() => !reportSending && setReportModal(false)}
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="w-[min(96vw,520px)] bg-paper border border-cyan-900/60 max-h-[85vh] overflow-y-auto"
              data-testid="help-widget-report-modal"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-900/60 bg-cyan-950/20">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-brand" />
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand">
                    Report Issue
                  </div>
                </div>
                <button
                  onClick={() => !reportSending && setReportModal(false)}
                  aria-label="Close report"
                  className="text-ink-muted hover:text-brand"
                  data-testid="help-widget-report-close"
                >
                  <X size={16} />
                </button>
              </div>

              {!reportResult?.ok && (
                <form onSubmit={submitReport} className="px-4 py-3 space-y-3">
                  <div className="font-mono text-[11px] text-ink-muted leading-relaxed">
                    We&apos;ll include the chat context, the current page, your browser and viewport so engineering can reproduce it.
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted space-y-0.5">
                    <div data-testid="help-report-meta-page">Page: <span className="text-ink normal-case tracking-normal">{location.pathname || "/"}</span></div>
                    <div data-testid="help-report-meta-role">Role: <span className="text-ink normal-case tracking-normal">{role}</span></div>
                    {listingCtx.listing_slug && (
                      <div data-testid="help-report-meta-listing">Listing: <span className="text-ink normal-case tracking-normal">{listingCtx.listing_slug}</span></div>
                    )}
                    {listingCtx.maker_slug && (
                      <div data-testid="help-report-meta-maker">Maker: <span className="text-ink normal-case tracking-normal">{listingCtx.maker_slug}</span></div>
                    )}
                  </div>
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">What&apos;s broken?</span>
                    <textarea
                      value={reportDraft}
                      onChange={(e) => setReportDraft(e.target.value)}
                      rows={4}
                      maxLength={4000}
                      required
                      placeholder="Describe what you tried and what happened…"
                      className="mt-1 w-full bg-surface border border-line text-ink font-mono text-[12px] px-2 py-1.5 focus:outline-none focus:border-brand"
                      data-testid="help-widget-report-textarea"
                    />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">Your email (optional — so we can follow up)</span>
                    <input
                      type="email"
                      value={reportEmail}
                      onChange={(e) => setReportEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="mt-1 w-full bg-surface border border-line text-ink font-mono text-[12px] px-2 py-1.5 focus:outline-none focus:border-brand"
                      data-testid="help-widget-report-email"
                    />
                  </label>
                  {reportResult?.error && (
                    <div className="font-mono text-[11px] text-rose-400" data-testid="help-widget-report-error">
                      {reportResult.error}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setReportModal(false)}
                      disabled={reportSending}
                      className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted hover:text-brand disabled:opacity-50 px-2 py-1"
                      data-testid="help-widget-report-cancel"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={reportSending || reportDraft.trim().length < 4}
                      className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand border border-brand hover:bg-brand hover:text-paper disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 transition-colors"
                      data-testid="help-widget-report-submit"
                    >
                      {reportSending ? "Sending…" : "Send Report"}
                    </button>
                  </div>
                </form>
              )}

              {reportResult?.ok && (
                <div className="px-4 py-6 space-y-3" data-testid="help-widget-report-success">
                  <div className="font-mono text-[12px] text-emerald-400 uppercase tracking-[0.18em]">
                    Report received
                  </div>
                  <div className="font-mono text-[11px] text-ink">
                    Thanks — we&apos;ve logged your report. Reference ID:
                    <span className="block mt-1 text-ink-muted break-all">{reportResult.id}</span>
                  </div>
                  <button
                    onClick={() => setReportModal(false)}
                    className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand border border-brand hover:bg-brand hover:text-paper px-3 py-1.5 transition-colors"
                    data-testid="help-widget-report-done"
                  >
                    Close
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
