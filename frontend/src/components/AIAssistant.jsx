import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send } from "lucide-react";
import { useLocation } from "react-router-dom";
import { aiChat, aiSubmitBrief } from "../lib/api";
import { useConfirm } from "../hooks/useConfirm";

const STARTER = {
  role: "assistant",
  text:
    "Hi — I'm the Crafters Market helper. I can answer product questions, walk you through " +
    "the marketplace, or capture a custom-order brief. What can I help with?",
};

export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem("cm_ai_messages");
      return saved ? JSON.parse(saved) : [STARTER];
    } catch {
      return [STARTER];
    }
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmModal] = useConfirm();
  const [sessionId, setSessionId] = useState(() => localStorage.getItem("cm_ai_session"));
  const scrollRef = useRef(null);
  const location = useLocation();

  // Persist conversation across navigations / reloads
  useEffect(() => {
    try { localStorage.setItem("cm_ai_messages", JSON.stringify(messages.slice(-50))); }
    catch { /* ignore quota */ }
  }, [messages]);

  useEffect(() => {
    if (sessionId) localStorage.setItem("cm_ai_session", sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await aiChat({
        message: text,
        session_id: sessionId,
        page_context: `User is on ${location.pathname}`,
      });
      setSessionId(res.session_id);
      setMessages((m) => [...m, { role: "assistant", text: res.reply }]);
      maybeOfferBriefSubmit(text, res.reply);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Hmm — I lost the connection. Try again in a moment." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  // If the assistant says "sending this brief", we look for a buyer email + name in
  // the conversation and POST it to /api/ai/submit-brief.
  const maybeOfferBriefSubmit = async (lastUser, reply) => {
    if (!/sending this brief|send this brief|sending it to the team/i.test(reply)) return;
    const all = [...messages, { role: "user", text: lastUser }, { role: "assistant", text: reply }]
      .map((m) => m.text)
      .join("\n");
    const email = (all.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0];
    if (!email) return;
    const draftPayload = {
      name: (all.match(/name(?:'s| is|:)?\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/) || [])[1] || "Customer",
      email,
      project_type: "Custom from AI assistant",
      material: (all.match(/(steel|wood|oak|aluminum|acrylic|leather|brass)/i) || [])[1] || "TBD",
      size: (all.match(/(\d{1,3}\s?(?:in|inch|"|cm|ft|foot))/i) || [])[1] || "",
      budget: (all.match(/\$\d+(?:[,.]\d+)?/) || [])[0] || "",
      description: lastUser.slice(0, 600),
    };
    try {
      await aiSubmitBrief(draftPayload);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "✓ Brief sent to the team. They'll reply with a free quote within 24 hours.",
          system: true,
        },
      ]);
    } catch {
      /* silent */
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      {confirmModal}
      {/* Floating launcher — positioned above the Emergent badge so it doesn't get covered */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-24 right-6 z-[60] bg-brand text-black w-14 h-14 flex items-center justify-center border-2 border-brand hover:rotate-3 transition-transform shadow-[0_0_24px_rgba(255,69,0,0.45)]"
        aria-label={open ? "Close assistant" : "Open assistant"}
        data-testid="ai-launcher"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-44 right-4 sm:right-6 z-[60] w-[min(92vw,420px)] h-[min(70vh,580px)] bg-paper border border-line flex flex-col"
            data-testid="ai-panel"
          >
            <div className="px-5 py-4 border-b border-line flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand">
                  ◆ AI Assistant · online
                </div>
                <div className="font-display text-xl mt-1">Workshop Helper</div>
              </div>
              <div className="flex items-center">
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: "Start a fresh conversation?",
                    body: "Clears the chat history. Your previous messages will be gone.",
                    confirmLabel: "Start fresh",
                    tone: "warn",
                    testId: "confirm-ai-reset",
                  });
                  if (ok) {
                    localStorage.removeItem("cm_ai_session");
                    localStorage.removeItem("cm_ai_messages");
                    setSessionId(null);
                    setMessages([STARTER]);
                  }
                }}
                aria-label="Reset"
                className="text-ink-muted hover:text-brand mr-3 font-mono text-[10px] uppercase tracking-[0.22em]"
                data-testid="ai-reset"
              >
                reset
              </button>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-ink-muted hover:text-brand"
              >
                <X size={18} />
              </button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3" data-testid="ai-messages">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] ${
                    m.role === "user"
                      ? "ml-auto bg-brand/10 border-brand/30"
                      : m.system
                      ? "border-brand/40 bg-brand/5 mx-auto text-center"
                      : "border-line bg-surface"
                  } border px-3 py-2 font-mono text-[13px] text-ink leading-relaxed whitespace-pre-wrap`}
                >
                  {m.text}
                </div>
              ))}
              {/* Empty state escape hatch — surface the human chat option so
                  shoppers know they have a real-person option. Only renders
                  when the user hasn't sent a message yet. */}
              {messages.length <= 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    window.dispatchEvent(new CustomEvent("cm:open-live-chat", { detail: { channel: "help" } }));
                  }}
                  data-testid="ai-talk-to-human"
                  className="block mx-auto mt-2 px-3 py-1.5 border border-line hover:border-brand hover:text-brand text-ink-muted font-mono text-[10px] uppercase tracking-[0.22em] transition"
                >
                  ◆ Talk to a real person →
                </button>
              )}
              {busy && (
                <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted">
                  ◆ thinking…
                </div>
              )}
            </div>

            <div className="border-t border-line p-3 flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                rows={2}
                placeholder="Ask anything — products, custom orders, shipping…"
                disabled={busy}
                className="flex-1 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink resize-none"
                data-testid="ai-input"
              />
              <button
                onClick={send}
                disabled={busy || !draft.trim()}
                className="self-stretch bg-brand text-black px-4 disabled:opacity-50"
                aria-label="Send"
                data-testid="ai-send"
              >
                <Send size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
