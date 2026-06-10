import React, { useEffect, useState } from "react";
import { X, Send } from "lucide-react";
import { toast } from "sonner";
import { startMessageThread, communityMe } from "../lib/api";
import useModalA11y from "../hooks/useModalA11y";

/** Compose-message modal. Buyers can reach a maker without signing in —
 *  if they ARE signed in we pre-fill name/email from their community profile.
 *  Used from MakerDetail (and ProductDetail in a future iteration). */
export default function ContactMakerModal({ maker, productSlug = null, prefillBody = "", onClose }) {
  const ref = useModalA11y(onClose);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState(
    productSlug ? `Question about: ${productSlug}` : `Question for ${maker?.name || ""}`,
  );
  const [body, setBody] = useState(prefillBody || "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    // Best-effort prefill from community profile if signed in.
    if (localStorage.getItem("cm_buyer_jwt")) {
      communityMe().then((u) => {
        setEmail(u?.email || "");
        setName(u?.name || "");
      }).catch(() => {});
    }
  }, []);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!email || !/.+@.+\..+/.test(email)) {
      toast.error("A valid email is required so we can route the reply.");
      return;
    }
    if (!body.trim()) {
      toast.error("Add a message to send.");
      return;
    }
    setSending(true);
    try {
      await startMessageThread({
        maker_slug: maker.slug,
        subject: subject.trim().slice(0, 140),
        body: body.trim(),
        sender_email: email.trim().toLowerCase(),
        sender_name: name.trim() || null,
        product_slug: productSlug || null,
      });
      setSent(true);
      toast.success(`Sent to ${maker.name}.`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't send the message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        className="relative w-full max-w-xl bg-paper border border-line mx-4 max-h-[90vh] overflow-y-auto"
        data-testid="contact-maker-modal"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-1">
              ◆ Direct Message
            </div>
            <h2 className="font-display text-2xl uppercase">Message {maker?.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:text-brand text-ink-muted"
            aria-label="Close"
            data-testid="contact-modal-close"
          >
            <X size={18} />
          </button>
        </div>

        {sent ? (
          <div className="p-8 text-center" data-testid="contact-modal-success">
            <div className="border border-emerald-700 bg-emerald-900/20 px-5 py-4 inline-block mx-auto">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-300 mb-1">
                ✓ Message delivered
              </div>
              <p className="font-mono text-xs text-emerald-200">
                {maker?.name} was notified by email. Replies arrive at <strong>{email}</strong>.
              </p>
            </div>
            <div className="mt-6">
              <button
                onClick={onClose}
                className="btn-industrial btn-primary inline-flex"
                data-testid="contact-modal-done"
              >
                Done →
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="p-6 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Your name (optional)">
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  maxLength={120} placeholder="Casey M."
                  className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
                  data-testid="contact-name-input"
                />
              </Field>
              <Field label="Email *">
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  required maxLength={200} placeholder="you@example.com"
                  className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
                  data-testid="contact-email-input"
                />
              </Field>
            </div>
            <Field label="Subject">
              <input
                type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
                maxLength={140} placeholder={`Question for ${maker?.name || "the maker"}`}
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
                data-testid="contact-subject-input"
              />
            </Field>
            <Field label="Message *">
              <textarea
                rows={6} value={body} onChange={(e) => setBody(e.target.value)}
                maxLength={4000} required
                placeholder="What would you like to know? Custom sizes, materials, lead time, etc."
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm resize-y"
                data-testid="contact-body-input"
              />
              <div className="text-right font-mono text-[10px] text-ink-muted mt-1">{body.length} / 4000</div>
            </Field>
            <p className="font-mono text-[10px] text-ink-muted leading-relaxed">
              ◆ Replies arrive at the email above. We deliver via Postmark — check your spam folder if you don&apos;t see one within a day.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button" onClick={onClose}
                className="px-4 py-2 border border-line hover:border-brand font-mono text-[11px] uppercase tracking-[0.22em]"
                data-testid="contact-cancel"
              >
                Cancel
              </button>
              <button
                type="submit" disabled={sending || !body.trim() || !email.trim()}
                className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
                data-testid="contact-send-btn"
              >
                <Send size={14} /> {sending ? "Sending…" : "Send message"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
