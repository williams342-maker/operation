/**
 * iter335.17 — Maker-side rank card.
 *
 * Compact card on the maker dashboard that surfaces the maker's current
 * rank + week-over-week delta. Pairs with the public /makers
 * leaderboard to close the gamification feedback loop ("you're #12 ↑3
 * this week — keep going").
 *
 * Self-hides when:
 *   • Admin disabled the leaderboard (503 from endpoint), OR
 *   • Maker has zero activity (on_leaderboard=false) — shows a
 *     "make your first sale to enter the leaderboard" CTA instead.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, ArrowUp, ArrowDown, Minus, Sparkles } from "lucide-react";
import { fetchMakerLeaderboardRank } from "../../lib/api";

function DeltaPill({ delta }) {
  if (delta === null || delta === undefined) {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-cyan-700/50 text-cyan-300 font-mono text-[9px] uppercase tracking-[0.22em]"
        data-testid="maker-rank-delta-new"
      >
        <Sparkles size={9} /> NEW
      </span>
    );
  }
  if (delta > 0) {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-emerald-700/50 text-emerald-300 font-mono text-[9px] uppercase tracking-[0.22em]"
        data-testid="maker-rank-delta-up"
      >
        <ArrowUp size={9} /> ↑{delta}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-red-700/50 text-red-300 font-mono text-[9px] uppercase tracking-[0.22em]"
        data-testid="maker-rank-delta-down"
      >
        <ArrowDown size={9} /> ↓{Math.abs(delta)}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-line text-ink-muted font-mono text-[9px] uppercase tracking-[0.22em]"
      data-testid="maker-rank-delta-flat"
    >
      <Minus size={9} /> held
    </span>
  );
}

export default function MakerRankCard() {
  const [data, setData] = useState(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchMakerLeaderboardRank();
        if (!cancelled) setData(r);
      } catch (e) {
        // 503 = admin disabled it. Any other error = silent hide.
        if (!cancelled) setHidden(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (hidden || !data) return null;

  // No activity yet — show a small CTA instead of a rank pill.
  if (!data.on_leaderboard) {
    return (
      <div
        className="border border-line bg-gradient-to-br from-[#0a0a0a] to-amber-950/10 p-4 flex items-center gap-4"
        data-testid="maker-rank-card-empty"
      >
        <Trophy size={28} className="text-ink-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-muted mb-1">
            Workshop leaderboard
          </div>
          <div className="font-display text-base text-ink leading-tight">
            Make your first sale to enter the rankings.
          </div>
        </div>
        <Link
          to="/makers"
          className="px-3 py-2 border border-line hover:border-amber-400 text-ink-muted hover:text-amber-300 font-mono text-[9px] uppercase tracking-[0.22em] whitespace-nowrap"
          data-testid="maker-rank-cta"
        >
          See leaders →
        </Link>
      </div>
    );
  }

  return (
    <div
      className="border border-amber-700/30 bg-gradient-to-br from-amber-950/10 to-transparent p-4 flex items-center gap-4"
      data-testid="maker-rank-card"
    >
      <Trophy size={28} className="text-amber-300 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-300">
            Your rank · last {data.window_days} days
          </span>
          <DeltaPill delta={data.delta} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl md:text-4xl text-ink leading-none tabular-nums" data-testid="maker-rank-value">
            #{data.rank}
          </span>
          <span className="font-mono text-[10px] text-ink-muted">
            of {data.total_makers}
          </span>
        </div>
        <div className="font-mono text-[10px] text-ink-muted mt-1">
          Score <span className="text-ink tabular-nums">{data.score.toLocaleString()}</span>
          {data.prev_score > 0 && (
            <> · prev <span className="text-ink-muted tabular-nums">{data.prev_score.toLocaleString()}</span></>
          )}
        </div>
      </div>
      <Link
        to="/makers"
        className="px-3 py-2 border border-amber-700/40 hover:border-amber-400 text-amber-300 hover:bg-amber-950/30 font-mono text-[9px] uppercase tracking-[0.22em] whitespace-nowrap"
        data-testid="maker-rank-link-leaderboard"
      >
        See full board →
      </Link>
    </div>
  );
}
