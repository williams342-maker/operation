/**
 * iter335.15 — Maker Leaderboard widget.
 *
 * Top 10 makers by a rolling 30-day "Workshop Score". Mounted at the
 * top of /makers above the grid. Self-hides when:
 *   • The admin has toggled `leaderboard_enabled` OFF
 *     (endpoint returns 503 → we set hidden=true).
 *   • The window has no eligible makers (zero scores everywhere).
 *
 * The top-3 get an emphasized "podium" treatment with rank medals;
 * 4-10 render as a compact strip. Each card links to the maker's
 * profile.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, Star, Sparkles, ShoppingBag, TrendingUp } from "lucide-react";
import { fetchMakerLeaderboard } from "../lib/api";

const BADGE_TONE = {
  "Top Seller":         { c: "border-amber-400/60 text-amber-300 bg-amber-400/5",  icon: Trophy },
  "Reviewer Favorite":  { c: "border-yellow-400/60 text-yellow-300 bg-yellow-400/5", icon: Star },
  "Rising":             { c: "border-emerald-400/60 text-emerald-300 bg-emerald-400/5", icon: TrendingUp },
  "On the Rise":        { c: "border-emerald-400/60 text-emerald-300 bg-emerald-400/5", icon: TrendingUp },
  "Workshop Hero":      { c: "border-cyan-400/60 text-cyan-300 bg-cyan-400/5", icon: Sparkles },
  "New":                { c: "border-line text-ink-muted bg-surface/30", icon: Sparkles },
};

const MEDAL_BY_RANK = { 1: "🥇", 2: "🥈", 3: "🥉" };

function Badge({ name }) {
  const cfg = BADGE_TONE[name] || BADGE_TONE["Workshop Hero"];
  const I = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 border font-mono text-[9px] uppercase tracking-[0.22em] ${cfg.c}`}>
      <I size={9} />
      {name}
    </span>
  );
}

function dollars(cents) {
  return (Number(cents || 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function MakerLeaderboard() {
  const [data, setData] = useState(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchMakerLeaderboard();
        if (!cancelled) setData(r);
      } catch (e) {
        // 503 = admin disabled the feature. Anything else = silent
        // failure (widget is non-critical, never break the page).
        if (!cancelled) setHidden(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (hidden) return null;
  if (!data) return null;
  if (!data.makers || data.makers.length === 0) return null;

  const podium = data.makers.slice(0, 3);
  const strip = data.makers.slice(3);

  return (
    <section
      className="mb-12 border border-amber-700/30 bg-gradient-to-br from-amber-950/10 to-transparent p-5 md:p-7"
      data-testid="maker-leaderboard"
    >
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-300 mb-1 flex items-center gap-1.5">
            <Trophy size={11} /> ◆ Workshop Leaderboard · Last {data.window_days || 30} days
          </div>
          <h2 className="font-display text-2xl md:text-3xl uppercase">Top makers · climbing the bench</h2>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          Ranked by Workshop Score
        </div>
      </div>

      {/* Podium — top 3 */}
      <div className="grid sm:grid-cols-3 gap-3 mb-3">
        {podium.map((m) => (
          <Link
            key={m.slug}
            to={`/makers/${m.slug}`}
            className="group border border-line hover:border-amber-400/60 bg-paper p-4 transition-all relative overflow-hidden"
            data-testid={`leaderboard-podium-${m.slug}`}
          >
            <div className="absolute top-3 right-3 font-display text-3xl">
              {MEDAL_BY_RANK[m.rank]}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-300 mb-2">
              Rank · #{m.rank}
            </div>
            <div className="font-display text-xl md:text-2xl text-ink group-hover:text-amber-200 transition leading-tight pr-10 mb-2">
              {m.name}
            </div>
            <div className="mb-3">
              <Badge name={m.badge} />
            </div>
            <div className="grid grid-cols-3 gap-1 text-[10px] font-mono">
              <div>
                <div className="text-ink font-display text-lg tabular-nums">{m.orders}</div>
                <div className="text-ink-muted uppercase tracking-[0.18em] text-[9px]">Orders</div>
              </div>
              <div>
                <div className="text-ink font-display text-lg tabular-nums">${dollars(m.revenue_cents)}</div>
                <div className="text-ink-muted uppercase tracking-[0.18em] text-[9px]">Revenue</div>
              </div>
              <div>
                <div className="text-ink font-display text-lg tabular-nums">{m.reviews}</div>
                <div className="text-ink-muted uppercase tracking-[0.18em] text-[9px]">Reviews</div>
              </div>
            </div>
            <div className="mt-3 font-mono text-[9px] uppercase tracking-[0.22em] text-amber-300/70 flex items-center gap-1">
              <Sparkles size={9} /> Score {m.score.toLocaleString()}
            </div>
          </Link>
        ))}
      </div>

      {/* Strip — ranks 4-10 */}
      {strip.length > 0 && (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2"
          data-testid="leaderboard-strip"
        >
          {strip.map((m) => (
            <Link
              key={m.slug}
              to={`/makers/${m.slug}`}
              className="border border-line hover:border-amber-400/40 bg-paper p-2.5 transition"
              data-testid={`leaderboard-row-${m.slug}`}
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className="font-mono text-[10px] text-amber-300/80">#{m.rank}</span>
                <span className="font-mono text-[9px] text-ink-muted tabular-nums">{m.score.toLocaleString()}</span>
              </div>
              <div className="font-display text-sm text-ink truncate leading-tight">{m.name}</div>
              <div className="mt-1 flex items-center gap-2 font-mono text-[9px] text-ink-muted">
                <span className="inline-flex items-center gap-0.5">
                  <ShoppingBag size={8} /> {m.orders}
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <Star size={8} /> {m.reviews}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
