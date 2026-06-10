import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/**
 * FoundersWall
 * -------------
 * Public roll-call of every active Founder. Renders an avatar grid with
 * each Founder's number, name, and shop link. Beta testers get the
 * dual-badge marker (emerald dot). Veteran-owned makers get a star.
 *
 * This is the single most powerful trust signal on /founders: a maker
 * about to apply sees real shops already in, picks one, clicks
 * through, lands on a real product page with the ◆ Founding Maker
 * #003 badge — and the abstract pitch becomes concrete. Hand-wavy
 * "be a founder" becomes "look, here's Sarah, she's #002, she's
 * shipping orders."
 */
const API = process.env.REACT_APP_BACKEND_URL;

export default function FoundersWall({ testId = "founders-wall" }) {
  const [founders, setFounders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/founders/list?limit=100`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.founders) setFounders(d.founders);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return null;
  if (founders.length === 0) return null;

  return (
    <section
      className="border border-line bg-paper p-6 md:p-10 my-12"
      data-testid={testId}
    >
      <div className="mb-8">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-2">
          ◆ Meet the makers already in
        </div>
        <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[0.95] text-ink">
          The Founders Wall.
        </h2>
        <p className="text-ink-muted mt-4 text-sm leading-relaxed max-w-2xl">
          Every approved Founder is listed here — numbered, named, badged.
          Click any name to visit their shop and see the ◆ Founding Maker badge
          on every product card.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {founders.map((f) => (
          <Link
            key={f.slug}
            to={`/makers/${f.slug}`}
            className="group border border-line bg-surface hover:border-brand transition-colors p-4 flex flex-col items-start"
            data-testid={`founders-wall-${f.slug}`}
          >
            <div className="flex items-center gap-2 mb-3">
              {f.avatar_url ? (
                <img
                  src={f.avatar_url}
                  alt={f.name || f.shop_name}
                  className="w-10 h-10 object-cover bg-paper"
                />
              ) : (
                <div className="w-10 h-10 bg-surface flex items-center justify-center font-display text-lg text-ink-muted">
                  {(f.shop_name || f.name || "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {f.is_beta_tester && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                    title="Beta Tester"
                  />
                )}
                {f.is_veteran_owned && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-[#facc15]"
                    title="Veteran-Owned"
                  />
                )}
              </div>
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-brand">
              {f.founder_status === "inaugural" ? "Inaugural" : "12-month"} · #{String(f.founder_number || 0).padStart(3, "0")}
            </div>
            <div className="font-display text-base leading-tight text-ink mt-1 group-hover:text-brand transition-colors truncate w-full">
              {f.shop_name || f.name}
            </div>
            {f.location && (
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted mt-1 truncate w-full">
                {f.location}
              </div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
