import React, { useEffect, useState } from "react";
import { fetchAdminPlusMembers } from "../../lib/api";
import { formatDate } from "./_shared";

// Directory of Crafters Plus subscribers ($12/mo). Shows Stripe subscription
// metadata + 30d ROI so the admin can spot churn-risk / high-value shops.
export default function PlusMembersTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await fetchAdminPlusMembers();
        setRows(data);
      } catch (e) {
        setErr(e?.response?.data?.detail || "Failed to load Plus members.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const mrr = rows.length * 12;
  const totalGmv30 = rows.reduce((s, r) => s + (r.gmv_30d || 0), 0);

  return (
    <div className="space-y-4" data-testid="plus-members-tab">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400">◆ Paid Members</div>
        <h2 className="font-display text-3xl md:text-4xl mt-1">Crafters Plus Subscribers</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border border-[#262626] p-4" data-testid="plus-stat-count">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Active</div>
          <div className="font-display text-4xl mt-1 text-[#e5e5e5]">{rows.length}</div>
        </div>
        <div className="border border-[#262626] p-4" data-testid="plus-stat-mrr">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">MRR</div>
          <div className="font-display text-4xl mt-1 text-emerald-400">${mrr}</div>
        </div>
        <div className="border border-[#262626] p-4" data-testid="plus-stat-gmv">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">30d GMV</div>
          <div className="font-display text-4xl mt-1 text-[#ff4500]">${totalGmv30.toFixed(0)}</div>
        </div>
        <div className="border border-[#262626] p-4" data-testid="plus-stat-canceling">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Canceling</div>
          <div className="font-display text-4xl mt-1 text-amber-400">{rows.filter((r) => r.cancel_at_period_end).length}</div>
        </div>
      </div>

      {loading && <div className="font-mono text-xs text-[#a3a3a3] py-6">Loading…</div>}
      {err && <div className="font-mono text-xs text-red-400 py-6">{err}</div>}
      {!loading && rows.length === 0 && (
        <div className="font-mono text-xs text-[#a3a3a3] py-6 border border-dashed border-[#262626] text-center" data-testid="plus-empty">
          No Crafters Plus subscribers yet.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-xs" data-testid="plus-members-table">
            <thead>
              <tr className="text-[#a3a3a3] uppercase tracking-[0.22em] text-[10px] border-b border-[#262626]">
                <th className="text-left py-2 pr-3">Studio</th>
                <th className="text-left py-2 pr-3">Email</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-left py-2 pr-3">Started</th>
                <th className="text-left py-2 pr-3">Renews</th>
                <th className="text-right py-2 pr-3">30d GMV</th>
                <th className="text-right py-2">Net value / mo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug} className="border-b border-[#262626] hover:bg-[#121212]" data-testid={`plus-row-${r.slug}`}>
                  <td className="py-3 pr-3">
                    <div className="text-[#e5e5e5]">{r.name || r.slug}</div>
                    <div className="text-[9px] text-[#525252]">/{r.slug}</div>
                  </td>
                  <td className="py-3 pr-3 break-all">
                    <a href={`mailto:${r.email}`} className="text-[#a3a3a3] hover:text-[#ff4500]">{r.email}</a>
                  </td>
                  <td className="py-3 pr-3">
                    <span className={`inline-block px-1.5 py-0.5 border text-[9px] font-bold ${
                      r.cancel_at_period_end
                        ? "border-amber-500/60 text-amber-400"
                        : "border-emerald-500/60 text-emerald-400"
                    }`}>
                      {r.cancel_at_period_end ? "CANCELING" : r.subscription_status?.toUpperCase() || "ACTIVE"}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-[#a3a3a3]">{formatDate(r.started_at)}</td>
                  <td className="py-3 pr-3 text-[#a3a3a3]">{formatDate(r.current_period_end)}</td>
                  <td className="py-3 pr-3 text-right text-[#ff4500]">${(r.gmv_30d || 0).toFixed(2)}</td>
                  <td className={`py-3 text-right ${r.plus_net_value_30d >= 0 ? "text-emerald-400" : "text-[#525252]"}`}>
                    {r.plus_net_value_30d >= 0 ? "+" : ""}${r.plus_net_value_30d?.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="font-mono text-[10px] text-[#525252] mt-3">
            Net value = 1% commission savings on 30d GMV − $12 monthly cost. Negative means Plus isn't paying off yet.
          </p>
        </div>
      )}
    </div>
  );
}
