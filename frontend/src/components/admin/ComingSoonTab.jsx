/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState, useCallback } from "react";
import { useConfirm } from "../../hooks/useConfirm";

// iter112 — Coming-Soon waitlist admin tab.
// Lists every category we collect waitlist signups for (Neon & Light,
// Furniture, etc.), their pending vs. notified counts, and a launch
// button that emails everyone PENDING for that category in one go.
// Idempotent: rows already notified are skipped, so re-clicks are no-ops.

const API = process.env.REACT_APP_BACKEND_URL;

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}`,
  };
}

export default function ComingSoonTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busyCat, setBusyCat] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [confirm, confirmModal] = useConfirm();

  const refresh = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch(`${API}/api/admin/coming-soon/waitlist`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e.message || "Load failed");
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const launch = async (category) => {
    // Step 1: dry-run — confirm count before pulling the trigger.
    setBusyCat(category);
    setErr("");
    try {
      const dry = await fetch(`${API}/api/admin/coming-soon/launch`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ category, dry_run: true }),
      }).then((r) => r.json());

      if (!dry.ok) {
        setErr(`Dry-run failed: ${dry.error || "unknown"}`);
        setBusyCat("");
        return;
      }
      if (dry.would_notify === 0) {
        setLastResult({ category, ok: true, notified: 0, reason: "no_pending" });
        setBusyCat("");
        return;
      }

      // Step 2: confirm with the operator. Themed modal matches the rest
      // of the admin surface so destructive email blasts feel deliberate.
      const ok = await confirm({
        title: `Launch ${category}?`,
        body: `${dry.would_notify} pending subscriber${dry.would_notify === 1 ? "" : "s"} will receive a one-shot launch email. Not undoable — already-notified rows are skipped on retry, so a failed single send is safe to re-run.`,
        confirmLabel: "🚀 Launch",
        tone: "danger",
        testId: `confirm-coming-soon-launch-${category}`,
      });
      if (!ok) {
        setBusyCat("");
        return;
      }

      // Step 3: real send.
      const result = await fetch(`${API}/api/admin/coming-soon/launch`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ category, dry_run: false }),
      }).then((r) => r.json());
      setLastResult({ category, ...result });
      await refresh();
    } catch (e) {
      setErr(e.message || "Launch failed");
    } finally {
      setBusyCat("");
    }
  };

  if (err) return <div className="font-mono text-sm text-red-400" data-testid="coming-soon-err">{err}</div>;
  if (!data) return <div className="font-mono text-xs text-[#525252]">Loading…</div>;

  const cats = data.categories || [];
  const stats = data.by_category || {};

  return (
    <div className="space-y-6" data-testid="admin-coming-soon-tab">
      {confirmModal}
      <header>
        <h2 className="font-display text-3xl text-[#e5e5e5]">Coming-Soon waitlists</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl">
          Every category collects email signups via the public Coming-Soon CTA. When
          you&rsquo;re ready to open one, click <b className="text-[#ff4500]">Launch</b> &mdash; we&rsquo;ll fire one
          announcement email to every pending subscriber and stamp them as notified
          so re-clicks don&rsquo;t double-email anyone.
        </p>
      </header>

      {/* Per-category launch grid */}
      <div className="grid md:grid-cols-2 gap-3" data-testid="coming-soon-categories">
        {cats.length === 0 && (
          <div className="font-mono text-xs text-[#525252]">No categories configured.</div>
        )}
        {cats.map((cat) => {
          const s = stats[cat] || { total: 0, pending: 0, notified: 0 };
          const isBusy = busyCat === cat;
          const empty = s.pending === 0;
          return (
            <div
              key={cat}
              className="border border-[#262626] p-4 flex flex-col gap-3"
              data-testid={`coming-soon-cat-${cat}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display text-lg text-[#e5e5e5]">{cat}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                    <span>{s.total} total</span>
                    <span className="text-[#525252]">·</span>
                    <span className={s.pending > 0 ? "text-[#ff4500]" : "text-[#525252]"}>
                      {s.pending} pending
                    </span>
                    <span className="text-[#525252]">·</span>
                    <span className="text-emerald-400">{s.notified} notified</span>
                  </div>
                </div>
                <button
                  onClick={() => launch(cat)}
                  disabled={isBusy || empty}
                  data-testid={`coming-soon-launch-${cat}`}
                  className={`
                    shrink-0 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] font-bold border transition disabled:opacity-40
                    ${empty
                      ? "border-[#262626] text-[#525252]"
                      : "border-[#ff4500] bg-[#ff4500]/5 text-[#ff4500] hover:bg-[#ff4500] hover:text-[#0a0a0a]"}
                  `}
                  title={empty ? "No pending subscribers — nothing to send" : `Launch ${cat}`}
                >
                  {isBusy ? "Launching…" : empty ? "✓ All notified" : "🚀 Launch"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Most-recent launch result */}
      {lastResult && (
        <div className="border border-[#262626] p-4" data-testid="coming-soon-last-result">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
            Last launch
          </div>
          {lastResult.ok ? (
            lastResult.notified > 0 ? (
              <div className="font-mono text-sm text-emerald-400">
                ✓ {lastResult.notified} subscriber{lastResult.notified === 1 ? "" : "s"} notified for <b>{lastResult.category}</b>.
              </div>
            ) : (
              <div className="font-mono text-sm text-[#a3a3a3]">
                ◆ {lastResult.category} had no pending subscribers — nothing sent.
              </div>
            )
          ) : (
            <div className="font-mono text-sm text-red-400">
              ✕ Launch failed for {lastResult.category}: {lastResult.error || "unknown"}
            </div>
          )}
        </div>
      )}

      {/* Recent signups feed */}
      <details className="border border-[#262626] p-4">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
                 data-testid="coming-soon-recent-toggle">
          ↓ Recent signups · {data.total} total
        </summary>
        <table className="w-full mt-3 font-mono text-xs text-[#a3a3a3]">
          <thead>
            <tr className="border-b border-[#262626]">
              <th className="text-left pb-2 font-bold uppercase tracking-[0.22em] text-[10px]">Email</th>
              <th className="text-left pb-2 font-bold uppercase tracking-[0.22em] text-[10px]">Category</th>
              <th className="text-left pb-2 font-bold uppercase tracking-[0.22em] text-[10px]">Joined</th>
              <th className="text-left pb-2 font-bold uppercase tracking-[0.22em] text-[10px]">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data.recent || []).map((r, i) => (
              <tr key={`${r.email}-${r.category}-${i}`} className="border-b border-[#1a1a1a]">
                <td className="py-1.5 text-[#e5e5e5]">{r.email}</td>
                <td className="py-1.5">{r.category}</td>
                <td className="py-1.5 text-[#525252]">{(r.joined_at || "").slice(0, 16).replace("T", " ")}</td>
                <td className="py-1.5">
                  {r.notified_at
                    ? <span className="text-emerald-400">✓ notified</span>
                    : <span className="text-[#ff4500]">pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
