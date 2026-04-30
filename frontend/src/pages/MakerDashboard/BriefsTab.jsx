import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Inbox, ExternalLink } from "lucide-react";
import { fetchMakerBriefs, updateMakerBrief } from "../../lib/api";
import Barcode from "../../components/Barcode";

/**
 * Maker Briefs Tab — admin-routed custom-order briefs for this maker.
 * Each row shows the buyer's brief + admin note; the maker can:
 *   - Accept   → tells the admin "I'll take this on"
 *   - Decline  → tells the admin "Not a fit, route elsewhere"
 *   - Mark in-progress / completed once the work moves forward
 * Buyer contact (email) is shown so the maker can reach out directly,
 * OR the maker can reply via the Messages tab thread the admin opened.
 */
export default function BriefsTab() {
  const [briefs, setBriefs] = useState(null);

  const reload = () => fetchMakerBriefs().then(setBriefs).catch(() => setBriefs([]));
  useEffect(() => { reload(); }, []);

  if (briefs === null) {
    return (
      <p className="font-mono text-xs text-[#525252]" data-testid="briefs-loading">
        Loading briefs…
      </p>
    );
  }

  const open = briefs.filter((b) => !b.maker_response_status || b.maker_response_status === "pending");
  const active = briefs.filter((b) => ["accepted", "in_progress"].includes(b.maker_response_status));
  const closed = briefs.filter((b) => ["declined", "completed", "won_bid"].includes(b.maker_response_status));

  return (
    <div className="space-y-6" data-testid="briefs-tab">
      <header className="pb-6 border-b border-[#262626]">
        <h2 className="font-display text-3xl md:text-4xl uppercase">Custom Briefs.</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2">
          Custom-order briefs that an admin routed to your shop. Accept the ones you can take
          on; decline the rest so they get routed to another maker.
        </p>
      </header>

      <Section title="New" testId="briefs-new" empty="No new briefs awaiting your reply.">
        {open.map((b) => <BriefCard key={b.id} brief={b} onChange={reload} />)}
      </Section>

      {active.length > 0 && (
        <Section title="Active" testId="briefs-active">
          {active.map((b) => <BriefCard key={b.id} brief={b} onChange={reload} />)}
        </Section>
      )}

      {closed.length > 0 && (
        <Section title="Past" testId="briefs-closed">
          {closed.map((b) => <BriefCard key={b.id} brief={b} onChange={reload} dim />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, testId, children, empty }) {
  const arr = React.Children.toArray(children);
  return (
    <section data-testid={testId}>
      <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">
        {title} <span className="text-[#525252]">· {arr.length}</span>
      </h3>
      {arr.length === 0 ? (
        empty ? (
          <p className="font-mono text-xs text-[#525252] flex items-center gap-2"
             data-testid={`${testId}-empty`}>
            <Inbox size={14} /> {empty}
          </p>
        ) : null
      ) : (
        <div className="space-y-3">{arr}</div>
      )}
    </section>
  );
}

function BriefCard({ brief, onChange, dim = false }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  const status = brief.maker_response_status || "pending";

  const handleAction = async (next) => {
    setBusy(next);
    try {
      await updateMakerBrief(brief.id, {
        status: next,
        note: note.trim() || undefined,
      });
      toast.success(`Brief ${next.replace("_", " ")}.`);
      setNote("");
      await onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Action failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <article
      className={`border border-[#262626] hover:border-[#ff4500] transition p-4 md:p-5 ${dim ? "opacity-60" : ""}`}
      data-testid={`brief-${brief.id}`}
    >
      <header className="flex items-start justify-between gap-3 pb-3 border-b border-[#1f1f1f]">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
            ◆ {brief.project_type}
          </div>
          <div className="font-display text-xl mt-1">{brief.material} · {brief.size || "size open"}</div>
          <div className="font-mono text-[11px] text-[#a3a3a3] mt-1">
            From {brief.name} ·{" "}
            <a href={`mailto:${brief.email}`} className="underline hover:text-[#ff4500]">
              {brief.email}
            </a>
          </div>
        </div>
        <div className="text-right shrink-0 flex flex-col items-end gap-2">
          <div className="font-display text-2xl text-[#ff4500]">{brief.budget || "open"}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
            Budget · {brief.timeline || "flexible"}
          </div>
          {brief.tracking_number && (
            <div className="border border-[#1f1f1f] px-2 py-1 bg-[#0a0a0a]" title={`Tracking #${brief.tracking_number}`}>
              <Barcode
                value={brief.tracking_number}
                height={28}
                width={1.3}
                fontSize={9}
                testId={`brief-barcode-${brief.id}`}
              />
            </div>
          )}
        </div>
      </header>

      <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-3 whitespace-pre-wrap">
        {brief.description}
      </p>

      {brief.assignment_note && (
        <div className="mt-3 px-3 py-2 border-l-2 border-cyan-400/50 bg-cyan-400/5">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400 mb-1">
            Admin note
          </div>
          <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed">{brief.assignment_note}</p>
        </div>
      )}

      {brief.reddit_post_url && (
        <a
          href={brief.reddit_post_url}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-3 font-mono text-[11px] text-orange-400 hover:underline"
          data-testid={`brief-reddit-link-${brief.id}`}
        >
          <ExternalLink size={11} /> Also broadcasted on r/{brief.reddit_subreddit}
        </a>
      )}

      <div className="mt-4 pt-4 border-t border-[#1f1f1f] flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          Status:
        </span>
        <span
          className={`font-mono text-[11px] uppercase tracking-[0.22em] px-2 py-1 border ${
            status === "won_bid"
              ? "border-yellow-400/60 text-yellow-400 bg-yellow-400/5"
              : status === "accepted" || status === "in_progress"
                ? "border-emerald-400/40 text-emerald-400"
                : status === "completed"
                  ? "border-emerald-400/40 text-emerald-400"
                  : status === "declined"
                    ? "border-red-400/30 text-red-400"
                    : "border-[#ff4500]/40 text-[#ff4500]"
          }`}
          data-testid={`brief-status-${brief.id}`}
        >
          {status === "won_bid" ? "🎯 won the bid" : status}
        </span>
        {brief.assigned_at && (
          <span className="font-mono text-[10px] text-[#525252] ml-auto">
            Routed {new Date(brief.assigned_at).toLocaleDateString()}
          </span>
        )}
      </div>

      {(status === "pending" || status === "accepted" || status === "in_progress") && (
        <div className="mt-3 pt-3 border-t border-[#1f1f1f] space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional note back to the admin / buyer"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
            data-testid={`brief-note-${brief.id}`}
          />
          <div className="flex gap-2 flex-wrap">
            {status === "pending" && (
              <>
                <button
                  onClick={() => handleAction("accepted")}
                  disabled={!!busy}
                  className="btn-industrial btn-primary disabled:opacity-50"
                  data-testid={`brief-accept-${brief.id}`}
                >
                  {busy === "accepted" ? "Accepting…" : "Accept brief"}
                </button>
                <button
                  onClick={() => handleAction("declined")}
                  disabled={!!busy}
                  className="px-4 py-2 border border-[#262626] hover:border-red-400 hover:text-red-400 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                  data-testid={`brief-decline-${brief.id}`}
                >
                  {busy === "declined" ? "Declining…" : "Decline"}
                </button>
              </>
            )}
            {status === "accepted" && (
              <button
                onClick={() => handleAction("in_progress")}
                disabled={!!busy}
                className="btn-industrial btn-primary disabled:opacity-50"
                data-testid={`brief-inprogress-${brief.id}`}
              >
                {busy === "in_progress" ? "Updating…" : "Mark in progress"}
              </button>
            )}
            {(status === "accepted" || status === "in_progress") && (
              <>
                <button
                  onClick={() => handleAction("won_bid")}
                  disabled={!!busy}
                  className="px-4 py-2 border border-yellow-400/60 text-yellow-400 hover:bg-yellow-400/10 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                  data-testid={`brief-won-${brief.id}`}
                  title="Mark this brief as a won bid — converts the lead into a tracked sale for admin analytics."
                >
                  {busy === "won_bid" ? "Updating…" : "🎯 Won the bid"}
                </button>
                <button
                  onClick={() => handleAction("completed")}
                  disabled={!!busy}
                  className="px-4 py-2 border border-emerald-400/40 text-emerald-400 hover:bg-emerald-400/10 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                  data-testid={`brief-complete-${brief.id}`}
                >
                  {busy === "completed" ? "Updating…" : "Mark completed"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
