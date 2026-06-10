/**
 * Social auto-post status card (iter271).
 *
 * Shows the maker their current eligibility tier (inaugural founder /
 * regular founder / Plus / none) for Crafters Market's branded
 * social auto-posting on Instagram, Pinterest, and Facebook. When
 * eligible, the maker sees how many listings are pending + recently
 * posted. When NOT eligible, they see a Founder/Plus upgrade CTA.
 */
import React, { useEffect, useState } from "react";
import { Sparkles, Lock, Instagram, Facebook, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import Section from "./Section";

const API = process.env.REACT_APP_BACKEND_URL;

const TIER_LABEL = {
  inaugural_founder: "Inaugural Founder",
  founder: "Founder member",
  plus: "Plus subscriber",
  none: "Not enabled",
};
const TIER_COLOR = {
  inaugural_founder: "#22d3ee",
  founder: "#ff4500",
  plus: "#ff4500",
  none: "#737373",
};

export default function SocialAutoPostSection() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const jwt = localStorage.getItem("cm_maker_jwt");
    if (!jwt) { setErr("Sign in required."); return; }
    fetch(`${API}/api/maker/social-auto-post/status`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setErr(e.message || "Couldn't load status."));
  }, []);

  if (err) {
    return (
      <Section title="Crafters Market Social" testId="social-auto-post-section">
        <p className="font-mono text-xs text-red-400">{err}</p>
      </Section>
    );
  }
  if (!data) {
    return (
      <Section title="Crafters Market Social" testId="social-auto-post-section">
        <p className="font-mono text-xs text-ink-muted">Loading…</p>
      </Section>
    );
  }

  const elig = data.eligibility || {};
  const tierColor = TIER_COLOR[elig.tier] || "#737373";
  const tierLabel = TIER_LABEL[elig.tier] || "Unknown";

  return (
    <Section
      title="Crafters Market Social"
      testId="social-auto-post-section"
    >
      <p className="font-mono text-xs text-ink-muted mb-5 max-w-2xl leading-relaxed">
        When you publish a listing, Crafters Market can auto-post it to our
        branded Instagram, Pinterest, and Facebook accounts — buyer reach
        without you lifting a finger.
      </p>

      {/* Eligibility status pill */}
      <div
        className="border border-line bg-paper p-4 mb-5 flex items-start gap-3"
        data-testid="social-auto-post-status-pill"
      >
        {elig.eligible ? (
          <Sparkles size={18} style={{ color: tierColor }} className="mt-0.5 shrink-0" />
        ) : (
          <Lock size={18} className="text-ink-muted mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: tierColor }}>
            ◆ {tierLabel}
          </div>
          <div className="text-ink mt-1 text-sm" data-testid="social-auto-post-reason">
            {elig.reason}
          </div>
          {!elig.eligible && elig.upsell && (
            <div className="font-mono text-[11px] text-ink-muted mt-2 leading-relaxed" data-testid="social-auto-post-upsell">
              {elig.upsell}
            </div>
          )}
        </div>
      </div>

      {/* Channels we post to (always shown so makers see the value prop) */}
      <div className="mb-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
          ◆ Channels we'll post to
        </div>
        <div className="flex flex-wrap gap-2 font-mono text-[11px]">
          <span className="px-2.5 py-1 border border-line text-ink flex items-center gap-1.5">
            <Instagram size={11} /> @crafters_market1
          </span>
          <span className="px-2.5 py-1 border border-line text-ink flex items-center gap-1.5">
            <ExternalLink size={11} /> Pinterest · team2598
          </span>
          <span className="px-2.5 py-1 border border-line text-ink flex items-center gap-1.5">
            <Facebook size={11} /> Crafters Market
          </span>
        </div>
      </div>

      {/* Eligible: show queue counts */}
      {elig.eligible && data.queue_summary && (
        <div className="grid grid-cols-3 gap-3 mb-5" data-testid="social-auto-post-counts">
          <CountTile label="Pending"   value={data.queue_summary.pending}   color="#ff4500" />
          <CountTile label="Published" value={data.queue_summary.published} color="#22c55e" />
          <CountTile label="Skipped"   value={data.queue_summary.skipped}   color="#737373" />
        </div>
      )}

      {/* Eligible: list recent pending posts */}
      {elig.eligible && data.recent_pending?.length > 0 && (
        <div className="border border-line divide-y divide-line" data-testid="social-auto-post-pending-list">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted px-3 py-2 bg-paper">
            ◆ Up next on our socials
          </div>
          {data.recent_pending.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
              {p.image_url && (
                <img src={p.image_url} alt="" className="w-10 h-10 object-cover" loading="lazy" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-ink truncate">{p.product_title}</div>
                <div className="font-mono text-[10px] text-ink-muted">
                  Queued {new Date(p.queued_at).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Not eligible: upgrade CTAs */}
      {!elig.eligible && (
        <div className="flex flex-wrap gap-3 mt-2" data-testid="social-auto-post-upgrade-ctas">
          <Link
            to="/maker/dashboard?tab=upgrade"
            className="px-4 py-2 border border-brand text-brand hover:bg-brand hover:text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] transition"
            data-testid="social-auto-post-upgrade-to-plus"
          >
            Upgrade to Plus · $12/mo →
          </Link>
          <Link
            to="/founder"
            className="px-4 py-2 border border-line text-ink hover:border-ink-muted font-mono text-[10px] uppercase tracking-[0.22em] transition"
            data-testid="social-auto-post-claim-founder"
          >
            Claim a Founder slot →
          </Link>
        </div>
      )}
    </Section>
  );
}

function CountTile({ label, value, color }) {
  return (
    <div className="border border-line bg-paper p-3 text-center">
      <div className="font-display text-2xl text-ink leading-none" style={{ color: value ? color : undefined }}>
        {value}
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted mt-1.5">
        {label}
      </div>
    </div>
  );
}
