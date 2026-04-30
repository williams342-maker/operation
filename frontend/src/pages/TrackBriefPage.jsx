import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Search } from "lucide-react";
import Barcode from "../components/Barcode";
import { http } from "../lib/api";

/**
 * Public brief tracker — anyone with the 10-digit tracking number can
 * land here and see the brief's status. No PII; sanitised by the
 * `/api/custom-orders/track/{n}` endpoint. Buyers receive their tracking
 * number in the confirmation email and can come back at any time.
 */
export default function TrackBriefPage() {
  const { trackingNumber } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(trackingNumber || "");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!trackingNumber) {
      setData(null); setErr("");
      return;
    }
    setLoading(true); setErr("");
    http.get(`/custom-orders/track/${trackingNumber}`)
      .then((r) => setData(r.data))
      .catch((e) => {
        setData(null);
        setErr(e?.response?.status === 404
          ? "We couldn't find a brief with that tracking number. Double-check the digits."
          : (e?.response?.data?.detail || "Lookup failed."));
      })
      .finally(() => setLoading(false));
  }, [trackingNumber]);

  const onSubmit = (e) => {
    e.preventDefault();
    const cleaned = input.replace(/\D/g, "");
    if (cleaned.length !== 10) {
      setErr("Tracking number must be 10 digits.");
      return;
    }
    navigate(`/track/${cleaned}`);
  };

  return (
    <div className="min-h-[70vh] bg-[#0a0a0a] text-[#e5e5e5] grain px-4 py-12 md:py-16" data-testid="track-page">
      <div className="max-w-2xl mx-auto">
        <header className="mb-8">
          <Link to="/" className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]">
            ← Back to Crafters Market
          </Link>
          <h1 className="font-display text-4xl md:text-5xl mt-3 uppercase">Track your brief.</h1>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 leading-relaxed">
            Enter the 10-digit tracking number from your custom-order confirmation email
            to see where your project stands.
          </p>
        </header>

        <form onSubmit={onSubmit} className="flex gap-2 mb-8" data-testid="track-form">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0123456789"
            inputMode="numeric"
            maxLength={10}
            className="flex-1 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm tracking-widest"
            data-testid="track-input"
          />
          <button
            type="submit"
            className="btn-industrial btn-primary inline-flex items-center gap-2"
            data-testid="track-submit"
          >
            <Search size={16} /> Track
          </button>
        </form>

        {loading && (
          <p className="font-mono text-xs text-[#525252]" data-testid="track-loading">
            Looking up brief…
          </p>
        )}

        {err && !loading && (
          <div className="border border-red-400/40 px-4 py-3 font-mono text-xs text-red-400" data-testid="track-error">
            {err}
          </div>
        )}

        {data && !loading && <BriefStatusCard data={data} />}
      </div>
    </div>
  );
}

function BriefStatusCard({ data }) {
  const STAGES = [
    { key: "submitted", label: "Submitted", at: data.submitted_at },
    { key: "quoted",    label: "Quoted",    at: data.quoted_at },
    { key: "assigned",  label: "Routed to a maker", at: data.assigned_at,
                        meta: data.assigned_maker_name && `→ ${data.assigned_maker_name}` },
    { key: "accepted",  label: "Maker accepted",   at: null },
    { key: "in_progress", label: "In progress",    at: null },
    { key: "won_bid",   label: "Won the bid",      at: data.won_bid_at },
    { key: "completed", label: "Completed",        at: null },
  ];
  const STAGE_INDEX = {
    submitted: 0, quoted: 1, assigned: 2, accepted: 3,
    in_progress: 4, won_bid: 5, completed: 6, declined: -1,
  };
  const currentIndex = STAGE_INDEX[data.status] ?? 0;
  const declined = data.status === "declined";

  return (
    <div className="border border-[#262626] p-5 md:p-6" data-testid="track-card">
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#1f1f1f] mb-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
            ◆ {data.project_type}
          </div>
          <div className="font-display text-2xl mt-1">{data.material}</div>
          <div className="font-mono text-[11px] text-[#a3a3a3] mt-2">
            Submitted {new Date(data.submitted_at).toLocaleDateString()}
          </div>
        </div>
        <div className="border border-[#1f1f1f] px-3 py-2 bg-[#0a0a0a]" title={`Tracking #${data.tracking_number}`}>
          <Barcode value={data.tracking_number} height={36} width={1.5} fontSize={11} testId={`track-barcode-${data.tracking_number}`} />
        </div>
      </div>

      <ol className="space-y-3" data-testid="track-stages">
        {STAGES.map((s, i) => {
          const reached = !declined && i <= currentIndex;
          const current = !declined && i === currentIndex;
          return (
            <li key={s.key} className="flex items-start gap-3" data-testid={`track-stage-${s.key}`}>
              <span className={`mt-1 inline-block w-3 h-3 rounded-full shrink-0 ${
                current
                  ? "bg-[#ff4500] ring-2 ring-[#ff4500]/40"
                  : reached
                    ? "bg-emerald-400"
                    : "bg-[#262626]"
              }`} />
              <div className="flex-1">
                <div className={`font-mono text-xs uppercase tracking-[0.22em] ${
                  reached ? "text-[#e5e5e5]" : "text-[#525252]"
                }`}>
                  {s.label}
                  {current && <span className="text-[#ff4500] ml-2">· current</span>}
                </div>
                {reached && s.at && (
                  <div className="font-mono text-[10px] text-[#a3a3a3] mt-0.5">
                    {new Date(s.at).toLocaleString()}
                  </div>
                )}
                {reached && s.meta && (
                  <div className="font-mono text-[10px] text-cyan-400 mt-0.5">{s.meta}</div>
                )}
              </div>
            </li>
          );
        })}
        {declined && (
          <li className="flex items-start gap-3" data-testid="track-stage-declined">
            <span className="mt-1 inline-block w-3 h-3 rounded-full shrink-0 bg-red-400" />
            <div>
              <div className="font-mono text-xs uppercase tracking-[0.22em] text-red-400">
                Maker declined
              </div>
              <div className="font-mono text-[10px] text-[#a3a3a3] mt-0.5">
                We're routing your brief to another maker — stand by.
              </div>
            </div>
          </li>
        )}
      </ol>

      {data.reddit_post_url && (
        <a
          href={data.reddit_post_url}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-5 pt-5 border-t border-[#1f1f1f] font-mono text-[11px] text-orange-400 hover:underline"
          data-testid="track-reddit-link"
        >
          ↗ Also broadcasted on r/{data.reddit_subreddit}
        </a>
      )}
    </div>
  );
}
