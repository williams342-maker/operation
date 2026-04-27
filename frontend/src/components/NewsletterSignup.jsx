import React, { useState } from "react";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { subscribeNewsletter } from "../lib/api";

export default function NewsletterSignup() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.includes("@")) {
      toast.error("Drop a real email and we'll holler when something hits.");
      return;
    }
    setSubmitting(true);
    try {
      await subscribeNewsletter(email, "homepage");
      setDone(true);
      toast.success("You're on the list. Welcome.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't subscribe — try again in a bit.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="border-t border-[#262626] bg-[#0a0a0a]"
      data-testid="newsletter-signup"
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 xl:px-12 py-20 grid md:grid-cols-2 gap-10 items-center">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
            ◆ NEW DROPS · NO SPAM
          </div>
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[0.92] tracking-[-0.01em]">
            Get the next <span className="text-outline">drop</span> first.
          </h2>
          <p className="font-mono text-sm text-[#a3a3a3] mt-5 max-w-[44ch]">
            One email a week — fresh listings from approved makers, exclusive
            commission slots, and the occasional discount code. Unsubscribe in one click.
          </p>
        </div>
        <form
          onSubmit={submit}
          className="border border-[#262626] p-6 md:p-8"
          data-testid="newsletter-form"
        >
          {done ? (
            <div className="text-center py-6 space-y-2" data-testid="newsletter-success">
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-emerald-400">
                ◆ Confirmed
              </div>
              <p className="font-mono text-sm text-[#e5e5e5]">
                You're on the list. Watch your inbox for the next drop.
              </p>
            </div>
          ) : (
            <>
              <label className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#525252] block mb-2">
                Email address
              </label>
              <div className="flex border border-[#262626] focus-within:border-[#ff4500] transition">
                <span className="flex items-center px-3 text-[#525252]">
                  <Mail size={14} />
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@workshop.org"
                  className="flex-1 bg-transparent outline-none px-2 py-3 font-mono text-sm text-[#e5e5e5] placeholder:text-[#525252]"
                  data-testid="newsletter-input"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="btn-industrial btn-primary w-full mt-4 disabled:opacity-50"
                data-testid="newsletter-submit"
              >
                {submitting ? "Subscribing…" : "Subscribe"}
              </button>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mt-3">
                ◆ Powered by Kit · We never share your email
              </p>
            </>
          )}
        </form>
      </div>
    </section>
  );
}
