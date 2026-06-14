import React, { useState } from "react";
import { Mail, MapPin, Instagram, Send, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useStructuredData } from "../lib/seo";
import { sendContactMessage } from "../lib/api";
import { trackConversion } from "../lib/googleAdsConversions";

const TOPICS = [
  { id: "general", label: "General question" },
  { id: "custom_order", label: "Custom-order inquiry" },
  { id: "order_help", label: "Help with an existing order" },
  { id: "maker_program", label: "Maker program" },
  { id: "press", label: "Press / media" },
  { id: "partnership", label: "Partnership / wholesale" },
  { id: "bug", label: "Found a bug" },
  { id: "other", label: "Something else" },
];

export default function ContactPage() {
  useStructuredData({
    title: "Contact · Crafters Market — Email, Address & Custom Inquiries",
    description: "Get in touch with the Crafters Market team. Email, social, and direct custom-order line — usually replies inside 24 hours.",
    url: "https://craftersmarket.org/contact",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ContactPage",
      url: "https://craftersmarket.org/contact",
      isPartOf: { "@type": "WebSite", "@id": "https://craftersmarket.org/#website" },
      mainEntity: {
        "@type": "Organization",
        "@id": "https://craftersmarket.org/#org",
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer service",
          email: "team@craftersmarket.org",
          areaServed: "US",
          availableLanguage: ["English"],
        },
      },
    },
  });

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="contact-page">
      <div className="max-w-[1100px] mx-auto px-4 md:px-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
          ◆ Get in Touch
        </div>
        <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] uppercase mb-12">
          Contact <span className="text-outline-orange">Us.</span>
        </h1>

        <div className="grid md:grid-cols-2 gap-10">
          <div className="space-y-6">
            <Block icon={<Mail />} title="Email" value="team@craftersmarket.org" href="mailto:team@craftersmarket.org" />
            <Block icon={<MapPin />} title="Service area" value="Continental US — ships nationwide" />
            <Block icon={<Instagram />} title="Instagram" value="@craftersmarket" href="https://instagram.com/" />

            <div className="pt-6 border-t border-line">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
                Custom orders
              </div>
              <a href="/custom-order" className="btn-industrial btn-primary inline-flex" data-testid="contact-custom-link">
                Start a custom brief →
              </a>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
                Want to sell?
              </div>
              <a href="/apply" className="btn-industrial inline-flex border border-line hover:border-brand" data-testid="contact-apply-link">
                Apply to the maker program →
              </a>
            </div>
          </div>

          <div className="border border-line p-6 md:p-10 bg-surface h-fit space-y-6">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">
                ◆ Send us a message
              </div>
              <h3 className="font-display text-3xl mb-2 leading-tight">
                We reply within 24 hours, weekdays.
              </h3>
              <p className="font-mono text-xs text-ink-muted leading-relaxed mb-6">
                Use the form below — it lands directly in our team inbox and you'll get an instant confirmation reply.
              </p>
            </div>
            <ContactForm />
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");  // honeypot
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.includes("@") || message.trim().length < 8) {
      toast.error("Please fill in name, a valid email, and a message (8+ chars).");
      return;
    }
    setBusy(true);
    try {
      await sendContactMessage({
        name: name.trim(), email: email.trim(),
        topic, subject: subject.trim(), message: message.trim(),
        website,  // honeypot — should always be empty for real users
      });
      setDone(true);
      toast.success("Message received — we'll reply within 24 hours.");
      // iter413ac — Google Ads `lead_contact` conversion. Topic is sent
      // as event_label so the Ads dashboard can split "custom_order"
      // leads from generic "general" inquiries when reporting ROAS.
      try {
        trackConversion("lead_contact", { event_label: topic || "general" });
      } catch { /* analytics best-effort */ }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="border border-emerald-500/40 bg-emerald-500/5 p-5" data-testid="contact-form-success">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-700">
          <Check size={14} /> Message sent
        </div>
        <p className="font-mono text-sm text-ink mt-3 leading-relaxed">
          Thanks {name.split(" ")[0]} — we'll be back at <span className="text-brand">{email}</span> within 24 business hours. A confirmation copy is on its way to your inbox now.
        </p>
        <button
          type="button"
          onClick={() => {
            setDone(false); setName(""); setEmail(""); setTopic("general");
            setSubject(""); setMessage("");
          }}
          className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand"
          data-testid="contact-form-send-another"
        >
          Send another →
        </button>
      </div>
    );
  }

  const inputCls = "w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2.5 font-mono text-sm text-ink";
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="contact-form" noValidate>
      {/* Honeypot field — hidden via CSS, real users never see it. */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        style={{ position: "absolute", left: "-9999px", height: 0, opacity: 0 }}
        aria-hidden="true"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Name *</span>
          <input
            type="text" required value={name} onChange={(e) => setName(e.target.value)}
            className={`${inputCls} mt-1`} data-testid="contact-form-name"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Email *</span>
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className={`${inputCls} mt-1`} placeholder="you@studio.com" data-testid="contact-form-email"
          />
        </label>
      </div>
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Topic</span>
        <select
          value={topic} onChange={(e) => setTopic(e.target.value)}
          className={`${inputCls} mt-1`} data-testid="contact-form-topic"
        >
          {TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Subject (optional)</span>
        <input
          type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
          className={`${inputCls} mt-1`} placeholder="Quick summary" data-testid="contact-form-subject"
        />
      </label>
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Message *</span>
        <textarea
          required rows={6} value={message} onChange={(e) => setMessage(e.target.value)}
          className={`${inputCls} mt-1 resize-none leading-relaxed`}
          placeholder="Tell us what you're working on or how we can help…"
          data-testid="contact-form-message"
        />
      </label>
      <button
        type="submit" disabled={busy}
        className="btn-industrial btn-primary w-full justify-center disabled:opacity-50"
        data-testid="contact-form-submit"
      >
        {busy ? (<><Loader2 size={14} className="animate-spin" /> Sending…</>) : (<><Send size={14} /> Send message</>)}
      </button>
      <p className="font-mono text-[10px] text-ink-muted leading-relaxed">
        We use this form to reply to you — your email is never shared, sold, or added to any marketing list.
      </p>
    </form>
  );
}

const Block = ({ icon, title, value, href }) => {
  const inner = (
    <>
      <span className="text-brand">{icon}</span>
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">{title}</div>
        <div className="font-display text-2xl text-ink mt-1">{value}</div>
      </div>
    </>
  );
  return href ? (
    <a href={href} className="flex items-start gap-4 hover:text-brand transition" data-testid={`contact-${title.toLowerCase()}`}>{inner}</a>
  ) : (
    <div className="flex items-start gap-4">{inner}</div>
  );
};
