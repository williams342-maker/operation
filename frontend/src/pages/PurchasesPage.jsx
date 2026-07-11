/**
 * iter453 — Buyer Purchases page. Signed-in buyers can re-download every
 * digital file they've ever purchased (fresh signed links minted on
 * demand) and see their download history. Legitimate customers never
 * lose access.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Download, Clock, FileText, RefreshCw } from "lucide-react";
import { API, http } from "../lib/api";

const buyerAuth = () => {
  const t = localStorage.getItem("cm_buyer_jwt");
  return t ? { Authorization: `Bearer ${t}` } : null;
};

const fmtBytes = (n) => !n ? "" : n < 1024 * 1024
  ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState(null);
  const [err, setErr] = useState(null);
  const [links, setLinks] = useState({});       // session_id → [{file_id, token…}]
  const [history, setHistory] = useState({});   // session_id → rows
  const auth = buyerAuth();

  useEffect(() => {
    if (!auth) return;
    http.get("/buyer/purchases", { headers: auth })
      .then((r) => setPurchases(r.data.purchases || []))
      .catch((e) => setErr(e?.response?.status === 401
        ? "signin" : "Could not load your purchases."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function freshLinks(sessionId) {
    try {
      const r = await http.post(`/buyer/purchases/${sessionId}/download-links`, {}, { headers: auth });
      setLinks((l) => ({ ...l, [sessionId]: r.data.links || [] }));
      toast.success("Fresh download links ready — valid for 30 days.");
    } catch { toast.error("Could not generate links."); }
  }

  async function loadHistory(sessionId) {
    if (history[sessionId]) { setHistory((h) => ({ ...h, [sessionId]: null })); return; }
    try {
      const r = await http.get(`/buyer/purchases/${sessionId}/download-history`, { headers: auth });
      setHistory((h) => ({ ...h, [sessionId]: r.data.history || [] }));
    } catch { toast.error("Could not load history."); }
  }

  if (!auth || err === "signin") {
    return (
      <div className="pt-40 pb-24 min-h-screen grain text-center px-4" data-testid="purchases-signin-gate">
        <h1 className="font-display text-4xl text-ink mb-4">Your Purchases</h1>
        <p className="font-mono text-xs text-ink-muted max-w-md mx-auto leading-relaxed">
          Sign in with the email you used at checkout to re-download your
          digital purchases anytime — even years later.
        </p>
        <Link to="/community/login?next=/purchases"
              className="btn-industrial btn-primary mt-6 inline-flex"
              data-testid="purchases-signin-btn">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="pt-32 pb-24 min-h-screen grain">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="font-display text-4xl sm:text-5xl text-ink mb-2">Your Purchases</h1>
        <p className="font-mono text-xs text-ink-muted mb-10">
          Digital files you've bought — re-download anytime.
        </p>

        {err && err !== "signin" && <p className="font-mono text-xs text-red-400">{err}</p>}
        {!purchases && !err && <p className="font-mono text-xs text-ink-muted">Loading…</p>}
        {purchases && purchases.length === 0 && (
          <div className="border border-dashed border-line p-10 text-center" data-testid="purchases-empty">
            <p className="font-mono text-xs text-ink-muted">
              No digital purchases on this account yet —{" "}
              <Link to="/shop" className="text-brand hover:underline">browse the shop</Link>.
            </p>
          </div>
        )}

        <div className="space-y-6">
          {(purchases || []).map((p) => {
            const l = links[p.session_id];
            const hist = history[p.session_id];
            return (
              <div key={p.session_id} className="border border-line bg-paper p-5"
                   data-testid={`purchase-${p.session_id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <div>
                    <div className="font-mono text-sm text-ink">{p.summary || "Digital order"}</div>
                    <div className="font-mono text-[10px] text-ink-muted mt-0.5">
                      {(p.created_at || "").slice(0, 10)} · ${Number(p.amount || 0).toFixed(2)}
                      · order {p.session_id.slice(-8)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => freshLinks(p.session_id)}
                            className="border border-brand text-brand hover:bg-brand hover:text-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition inline-flex items-center gap-1.5"
                            data-testid={`purchase-links-btn-${p.session_id}`}>
                      <RefreshCw size={11} /> Get download links
                    </button>
                    <button onClick={() => loadHistory(p.session_id)}
                            className="border border-line text-ink-muted hover:text-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition inline-flex items-center gap-1.5"
                            data-testid={`purchase-history-btn-${p.session_id}`}>
                      <Clock size={11} /> History
                    </button>
                  </div>
                </div>

                <ul className="divide-y divide-line/60 border border-line/60">
                  {p.files.map((f) => {
                    const link = (l || []).find((x) => x.file_id === f.file_id);
                    return (
                      <li key={f.file_id} className="flex items-center gap-3 px-3 py-2.5"
                          data-testid={`purchase-file-${f.file_id}`}>
                        <FileText size={13} className="text-brand shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-xs text-ink truncate">{f.filename}</div>
                          <div className="font-mono text-[9.5px] text-ink-muted">
                            {f.product_title} · {f.ext} {fmtBytes(f.size_bytes)} ·
                            downloaded {f.downloads || 0}×
                          </div>
                        </div>
                        {link ? (
                          <a href={`${API}/checkout/downloads/${link.token}`}
                             className="bg-brand hover:bg-brand-hover text-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition inline-flex items-center gap-1.5"
                             data-testid={`purchase-download-${f.file_id}`}>
                            <Download size={11} /> Download
                          </a>
                        ) : (
                          <span className="font-mono text-[9.5px] text-ink-muted">
                            Get links to download
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {hist && (
                  <div className="mt-3 border-t border-line pt-3" data-testid={`purchase-history-${p.session_id}`}>
                    <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted mb-2">
                      Download history
                    </div>
                    {hist.length === 0 ? (
                      <p className="font-mono text-[10px] text-ink-muted">No downloads yet.</p>
                    ) : (
                      <ul className="space-y-1">
                        {hist.slice(0, 20).map((h, i) => (
                          <li key={i} className="font-mono text-[10px] text-ink-muted">
                            {(h.at || "").replace("T", " ").slice(0, 16)} · {h.filename} · v{h.version || 1}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
