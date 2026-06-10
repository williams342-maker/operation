import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, X, Send, Sparkles } from "lucide-react";
import { useLocation } from "react-router-dom";
import { helpChat } from "../lib/api";

// iter312 — Onboarding-focused Help & Support AI chat.
// Distinct from `AIAssistant.jsx` (buyer concierge for product Q&A).
// This widget answers platform-mechanics: Stripe Connect, listing schema,
// pricing, custom orders, payouts, returns, etc. Auto-detects user role
// from localStorage tokens so answers tailor to maker vs buyer vs visitor.

const STARTER_HINTS = {
  visitor: [
    "How do custom orders work?",
    "What's the shipping cost?",
    "How do I sell on Crafters Market?",
  ],
  buyer: [
    "How do I track my order?",
    "Can I cancel a custom order?",
    "What's the return policy?",
  ],
  maker: [
    "How do I connect Stripe?",
    "What's the GPC path field?",
    "How does Crafters Plus pay back?",
  ],
  admin: [
    "How do I purge seed clips?",
    "Where do I check feed health?",
  ],
};

function detectRole() {
  try {
    if (localStorage.getItem("cm_admin_jwt")) return "admin";
    if (localStorage.getItem("cm_maker_jwt")) return "maker";
    if (localStorage.getItem("cm_buyer_jwt") || localStorage.getItem("cm_community_jwt")) return "buyer";
  } catch (_e) { /* ignore */ }
  return "visitor";
}

function roleGreeting(role) {
  const lines = {
    visitor: "Hi — I'm Crafters Market Help. Ask anything about ordering, selling, or how the platform works.",
    buyer: "Hi — I'm Crafters Market Help. Order questions, returns, custom orders — I've got you.",
    maker: "Hey — Maker Help here. Stripe Connect, listings, payouts, GPC paths, Plus subscription — fire away.",
    admin: "Ops console help. Ask about seed tools, feed health, admin endpoints.",
  };
  return lines[role] || lines.visitor;
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
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "I'm having trouble reaching the server right now — try again in a moment, or email team@craftersmarket.org." },
      ]);
    } finally { setBusy(false); }
  };

  const resetChat = () => {
    setMessages([{ role: "assistant", text: roleGreeting(role) }]);
    setSessionId(null);
    localStorage.removeItem("cm_help_session");
    localStorage.removeItem("cm_help_messages");
  };

  // Hide on admin/maker dashboard root paths if a user prefers focus — opt-out
  // by checking ?nohelp=1 in URL. Default: always visible.
  const params = new URLSearchParams(location.search);
  if (params.get("nohelp") === "1") return null;

  const hints = STARTER_HINTS[role] || STARTER_HINTS.visitor;

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close help" : "Open help & support"}
        data-testid="help-widget-toggle"
        className="fixed bottom-24 right-24 z-[60] bg-paper text-cyan-300 w-12 h-12 flex items-center justify-center border-2 border-cyan-700/70 hover:border-cyan-400 hover:rotate-3 transition-all shadow-[0_0_20px_rgba(34,211,238,0.25)]"
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
                <Sparkles size={14} className="text-cyan-300" />
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-400">
                    Help &amp; Support
                  </div>
                  <div className="font-mono text-[9px] text-ink-muted uppercase tracking-[0.18em]">
                    Role: {role}
                  </div>
                </div>
              </div>
              <button
                onClick={resetChat}
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted hover:text-cyan-300"
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
                      ? "ml-auto bg-cyan-900/30 border border-cyan-800/60 text-cyan-50 px-3 py-2"
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
                      className="block w-full text-left font-mono text-[11px] text-cyan-300/80 hover:text-cyan-100 hover:bg-cyan-950/30 border border-cyan-900/40 px-2 py-1.5 transition-colors"
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
                className="text-cyan-300 hover:text-cyan-100 disabled:opacity-30 disabled:cursor-not-allowed"
                data-testid="help-widget-send"
              >
                <Send size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
