import React, { useEffect, useState } from "react";
import {
  ChevronDown, Wallet, FileText, Settings as SettingsIcon, BookOpen,
  Calculator, ScrollText, ExternalLink,
} from "lucide-react";
import {
  fetchMakerPayouts, fetchMakerTransactions,
  stripeConnectOnboard, stripeConnectStatus, stripeConnectDashboardLink,
} from "../../lib/api";
import { StatsSkeleton } from "../../components/Skeleton";

/**
 * Etsy-parity Financials hub.
 *
 * Same Etsy-style left-rail collapsible pattern we use in Help and Settings,
 * scoped to Finances per the user's screenshot reference. Single category
 * "Finances" expands to 7 sub-sections:
 *
 *   - Payment account     → Stripe Connect status + onboarding (existing UI)
 *   - Monthly statements  → downloadable monthly summaries (placeholder UI;
 *                          generation happens server-side as we accumulate data)
 *   - Payment settings    → payout cadence + bank-account routing (Stripe-managed)
 *   - QuickBooks export   → CSV export of all transactions in QB-compatible format
 *   - Xero export         → same data, Xero column layout
 *   - TurboTax export     → annual gross/fees breakdown for self-employed taxes
 *   - Legal & tax info    → 1099-K guidance, sales-tax notes, EIN field
 *
 * The transaction-history section (previously inline below payouts) now
 * lives inside "Payment account" since they're operationally one page on
 * Stripe's side.
 */
const SECTIONS = [
  { id: "payment-account",   label: "Payment account",       icon: Wallet },
  { id: "monthly-statements", label: "Monthly statements",   icon: FileText },
  { id: "payment-settings",  label: "Payment settings",      icon: SettingsIcon },
  { id: "quickbooks",        label: "QuickBooks export",     icon: BookOpen },
  { id: "xero",              label: "Xero export",           icon: BookOpen },
  { id: "turbotax",          label: "TurboTax export",       icon: Calculator },
  { id: "legal-tax",         label: "Legal & tax information", icon: ScrollText },
];

export default function FinancialsTab() {
  const [section, setSection] = useState(SECTIONS[0].id);
  const [open, setOpen] = useState(true); // category open by default — there's only one
  const [payouts, setPayouts] = useState(null);
  const [status, setStatus] = useState(null);
  const [txns, setTxns] = useState(null);

  const refresh = () => Promise.all([
    fetchMakerPayouts().catch(() => ({ payouts: [], pending: 0 })),
    stripeConnectStatus().catch(() => ({ connected: false })),
    fetchMakerTransactions().catch(() => ({ transactions: [] })),
  ]).then(([p, s, t]) => {
    setPayouts(p); setStatus(s); setTxns(t.transactions || []);
  });

  useEffect(() => { refresh(); }, []);

  if (!payouts || !txns) return <StatsSkeleton />;

  return (
    <div className="space-y-8" data-testid="financials-tab">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
          ◆ Shop Manager · Finances
        </div>
        <h1 className="font-display text-3xl md:text-5xl uppercase leading-[0.95]">
          Financials.
        </h1>
        <p className="font-mono text-sm text-[#a3a3a3] mt-2 max-w-2xl">
          Payouts, statements, accounting exports, and tax docs — every penny in one place.
        </p>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-6">
        {/* SUB-NAV */}
        <FinSubNav
          sections={SECTIONS}
          activeId={section}
          onPick={setSection}
          open={open}
          onToggleOpen={() => setOpen((v) => !v)}
        />

        {/* ACTIVE SECTION */}
        <div className="min-w-0" data-testid={`financials-section-${section}`}>
          {section === "payment-account" && (
            <PaymentAccount payouts={payouts} status={status} txns={txns} onRefresh={refresh} />
          )}
          {section === "monthly-statements" && <MonthlyStatements txns={txns} />}
          {section === "payment-settings" && <PaymentSettings status={status} />}
          {section === "quickbooks" && <ExportPanel format="quickbooks" txns={txns} />}
          {section === "xero" && <ExportPanel format="xero" txns={txns} />}
          {section === "turbotax" && <ExportPanel format="turbotax" txns={txns} />}
          {section === "legal-tax" && <LegalTax />}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-nav (single collapsible "Finances" category mirroring the Etsy screenshot)
// ============================================================================
function FinSubNav({ sections, activeId, onPick, open, onToggleOpen }) {
  return (
    <>
      {/* Mobile: select */}
      <div className="lg:hidden">
        <select
          value={activeId}
          onChange={(e) => onPick(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5]"
          data-testid="financials-subnav-mobile"
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Desktop: collapsible */}
      <nav
        className="hidden lg:block bg-[#0d0d0d] border border-[#1f1f1f] p-2 self-start"
        data-testid="financials-subnav"
      >
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          className="w-full text-left px-3 py-2.5 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] transition border-l-2 border-[#ff4500] text-[#e5e5e5] hover:bg-[#161616]"
          data-testid="financials-cat-toggle"
        >
          <Wallet size={14} className="shrink-0" />
          <span className="flex-1 truncate">Finances</span>
          <ChevronDown
            size={12}
            className={`opacity-60 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <ul className="pb-1.5">
            {sections.map((s) => {
              const isActive = s.id === activeId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onPick(s.id)}
                    className={`w-full text-left pl-10 pr-3 py-2 font-mono text-[11px] tracking-[0.04em] transition ${
                      isActive
                        ? "bg-[#ff4500]/10 text-[#ff4500]"
                        : "text-[#a3a3a3] hover:text-[#e5e5e5] hover:bg-[#161616]"
                    }`}
                    data-testid={`financials-subnav-${s.id}`}
                  >
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </>
  );
}

// ============================================================================
// Section: Payment account (Stripe Connect + transaction history)
// ============================================================================
function PaymentAccount({ payouts, status, txns, onRefresh }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const onConnect = async () => {
    setBusy("connect"); setErr("");
    try { const r = await stripeConnectOnboard(); window.location.href = r.url; }
    catch (e) { setErr(e?.response?.data?.detail || "Could not start onboarding."); setBusy(""); }
  };
  const onDashboard = async () => {
    setBusy("dashboard"); setErr("");
    try { const r = await stripeConnectDashboardLink(); window.location.href = r.url; }
    catch (e) { setErr(e?.response?.data?.detail || "Could not open dashboard."); setBusy(""); }
  };

  return (
    <div className="space-y-6">
      <Section title="Payouts via Stripe Connect" testId="payment-account-payouts">
        {!status?.connected ? (
          <>
            <h3 className="font-display text-2xl mb-2 uppercase">Get paid directly.</h3>
            <p className="font-mono text-xs text-[#a3a3a3] mb-4 max-w-xl leading-relaxed">
              Connect a Stripe account so each sale routes straight to your bank.
              Onboarding takes about 5 minutes.
            </p>
            <button
              onClick={onConnect} disabled={busy === "connect"}
              className="btn-industrial btn-primary inline-flex disabled:opacity-50"
              data-testid="financials-connect-btn"
            >
              {busy === "connect" ? "Redirecting…" : "Connect Stripe →"}
            </button>
          </>
        ) : (
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <div className="font-display text-3xl text-[#ff4500] mb-1">
                ${(payouts?.pending || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                Pending payout
              </div>
            </div>
            <button
              onClick={onDashboard} disabled={busy === "dashboard"}
              className="btn-industrial inline-flex justify-center disabled:opacity-50"
              data-testid="financials-dashboard-btn"
            >
              {busy === "dashboard" ? "Redirecting…" : "Open Stripe Dashboard →"}
            </button>
          </div>
        )}
        {err && <p className="font-mono text-xs text-red-400 mt-3" data-testid="financials-err">{err}</p>}
      </Section>

      <Section title="Transaction history" testId="payment-account-txns">
        {!txns.length ? (
          <p className="font-mono text-xs text-[#737373] py-6">
            No transactions yet — they'll appear here after your first sale.
          </p>
        ) : (
          <div className="border border-[#1f1f1f]">
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 border-b border-[#1f1f1f] font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              <div>Description</div><div className="text-right">Amount</div><div className="text-right">Date</div>
            </div>
            {txns.map((t, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 border-b border-[#161616] font-mono text-xs items-center"
                data-testid={`txn-row-${i}`}
              >
                <div className="min-w-0">
                  <div className="text-[#e5e5e5] uppercase tracking-[0.18em] text-[10px]">
                    {t.kind}{t.items_count ? ` · ${t.items_count} items` : ""}
                  </div>
                  <div className="text-[#737373] text-[10px] truncate">{t.reference}</div>
                </div>
                <div className={`text-right font-display text-base ${t.direction === "credit" ? "text-emerald-400" : "text-[#ff4500]"}`}>
                  {t.direction === "credit" ? "+" : "−"}${t.amount.toFixed(2)}
                </div>
                <div className="text-right text-[10px] text-[#737373]">
                  {(t.created_at || "").slice(0, 10)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ============================================================================
// Section: Monthly statements (groups txns by year-month, downloads as CSV)
// ============================================================================
function MonthlyStatements({ txns }) {
  // Group transactions by YYYY-MM. Sum credits/debits per month.
  const byMonth = {};
  txns.forEach((t) => {
    const ym = (t.created_at || "").slice(0, 7);
    if (!ym) return;
    if (!byMonth[ym]) byMonth[ym] = { credits: 0, debits: 0, count: 0 };
    byMonth[ym].count += 1;
    if (t.direction === "credit") byMonth[ym].credits += t.amount;
    else byMonth[ym].debits += t.amount;
  });
  const months = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));

  const downloadCsv = (ym) => {
    const filtered = txns.filter((t) => (t.created_at || "").startsWith(ym));
    const rows = [
      ["Date", "Kind", "Reference", "Direction", "Amount USD"],
      ...filtered.map((t) => [
        (t.created_at || "").slice(0, 10),
        t.kind, t.reference, t.direction, t.amount.toFixed(2),
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `craftersmarket-statement-${ym}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Section title="Monthly statements" testId="monthly-statements">
      <p className="font-mono text-xs text-[#a3a3a3] mb-5 leading-relaxed max-w-xl">
        Download a CSV summary for any month — pairs nicely with your accounting software.
      </p>
      {months.length === 0 ? (
        <p className="font-mono text-xs text-[#737373] py-6">
          No statements yet — your first month will appear after your first sale.
        </p>
      ) : (
        <div className="border border-[#1f1f1f]">
          {months.map(([ym, m]) => (
            <div
              key={ym}
              className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-3 border-b border-[#161616] items-center"
              data-testid={`statement-${ym}`}
            >
              <div className="font-mono text-xs text-[#e5e5e5] uppercase tracking-[0.18em]">{ym}</div>
              <div className="font-display text-base text-emerald-400 text-right">+${m.credits.toFixed(2)}</div>
              <div className="font-display text-base text-[#ff4500] text-right">−${m.debits.toFixed(2)}</div>
              <button
                onClick={() => downloadCsv(ym)}
                className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition"
                data-testid={`statement-download-${ym}`}
              >
                Download CSV
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ============================================================================
// Section: Payment settings (Stripe-managed)
// ============================================================================
function PaymentSettings({ status }) {
  return (
    <Section title="Payment settings" testId="payment-settings">
      <p className="font-mono text-xs text-[#a3a3a3] mb-4 leading-relaxed max-w-xl">
        Payout cadence and bank account routing are managed inside your Stripe dashboard
        — Crafters Market never touches your banking details.
      </p>
      <ul className="space-y-2 mb-5 font-mono text-xs text-[#e5e5e5]">
        <li>• Default cadence: every 2 business days after funds clear (Stripe standard)</li>
        <li>• Switch to weekly or monthly from inside the Stripe dashboard</li>
        <li>• Update your bank account or routing info there too</li>
      </ul>
      {status?.connected ? (
        <a
          href="https://dashboard.stripe.com/express"
          target="_blank"
          rel="noreferrer"
          className="btn-industrial inline-flex items-center gap-2"
          data-testid="payment-settings-stripe"
        >
          Open Stripe Dashboard <ExternalLink size={14} />
        </a>
      ) : (
        <p className="font-mono text-xs text-amber-400">
          ◇ Connect Stripe first (Payment account → Connect Stripe).
        </p>
      )}
    </Section>
  );
}

// ============================================================================
// Section: Generic export panel — covers QuickBooks, Xero, TurboTax
// ============================================================================
const FORMATS = {
  quickbooks: {
    title: "QuickBooks export",
    blurb: "QuickBooks-compatible CSV — drop straight into your QB Online/Self-Employed account under Banking → Upload Transactions.",
    columns: ["Date", "Description", "Amount", "Memo"],
    map: (t) => [
      (t.created_at || "").slice(0, 10),
      t.kind,
      (t.direction === "credit" ? "" : "-") + t.amount.toFixed(2),
      t.reference || "",
    ],
  },
  xero: {
    title: "Xero export",
    blurb: "Xero-compatible CSV — import via Xero → Accounting → Bank Accounts → Import Statement.",
    columns: ["*Date", "*Amount", "Payee", "Description", "Reference"],
    map: (t) => [
      (t.created_at || "").slice(0, 10),
      (t.direction === "credit" ? "" : "-") + t.amount.toFixed(2),
      "Crafters Market",
      t.kind,
      t.reference || "",
    ],
  },
  turbotax: {
    title: "TurboTax export",
    blurb: "Annualized gross/fees breakdown for Schedule C / self-employed tax filing. CSV groups credits as gross income and debits as platform fees.",
    columns: ["Year", "Gross Income", "Platform Fees", "Net"],
    map: null, // computed below
  },
};

function ExportPanel({ format, txns }) {
  const cfg = FORMATS[format];
  const exportFile = () => {
    let rows;
    if (format === "turbotax") {
      const byYear = {};
      txns.forEach((t) => {
        const y = (t.created_at || "").slice(0, 4);
        if (!y) return;
        if (!byYear[y]) byYear[y] = { gross: 0, fees: 0 };
        if (t.direction === "credit") byYear[y].gross += t.amount;
        else byYear[y].fees += t.amount;
      });
      rows = [
        cfg.columns,
        ...Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0])).map(([y, v]) => [
          y, v.gross.toFixed(2), v.fees.toFixed(2), (v.gross - v.fees).toFixed(2),
        ]),
      ];
    } else {
      rows = [cfg.columns, ...txns.map(cfg.map)];
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `craftersmarket-${format}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Section title={cfg.title} testId={`export-${format}`}>
      <p className="font-mono text-xs text-[#a3a3a3] mb-5 leading-relaxed max-w-xl">{cfg.blurb}</p>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
        ◆ Columns
      </div>
      <div className="border border-[#1f1f1f] p-3 mb-5 font-mono text-[11px] text-[#e5e5e5] flex flex-wrap gap-2">
        {cfg.columns.map((c) => (
          <code key={c} className="px-2 py-1 bg-[#161616] text-[#a3a3a3]">{c}</code>
        ))}
      </div>
      <button
        onClick={exportFile}
        disabled={txns.length === 0}
        className="btn-industrial btn-primary disabled:opacity-50"
        data-testid={`export-${format}-btn`}
      >
        Download {cfg.title.replace(" export", "")} CSV
      </button>
      {txns.length === 0 && (
        <p className="font-mono text-xs text-[#737373] mt-3">
          You'll be able to export once you have your first transaction.
        </p>
      )}
    </Section>
  );
}

// ============================================================================
// Section: Legal & tax info
// ============================================================================
function LegalTax() {
  return (
    <Section title="Legal & tax information" testId="legal-tax">
      <ul className="space-y-4 font-mono text-xs text-[#e5e5e5] leading-relaxed">
        <li>
          <div className="text-[#ff4500] uppercase tracking-[0.22em] text-[10px] mb-1">◆ 1099-K reporting</div>
          Crafters Market issues 1099-Ks via Stripe to U.S. sellers who exceed the IRS reporting
          thresholds. The current threshold is $5,000 in gross sales for 2025 (dropping further
          in subsequent years). You'll receive your 1099-K in your Stripe dashboard.
        </li>
        <li>
          <div className="text-[#ff4500] uppercase tracking-[0.22em] text-[10px] mb-1">◆ Sales tax</div>
          We collect and remit U.S. sales tax automatically for marketplace facilitator states.
          You don't need to charge sales tax inside your listings — Stripe handles it at checkout.
        </li>
        <li>
          <div className="text-[#ff4500] uppercase tracking-[0.22em] text-[10px] mb-1">◆ Self-employment tax</div>
          Set aside roughly 25–30% of net income for federal income + self-employment (Social
          Security + Medicare) taxes. A quarterly estimated-tax payment schedule keeps you out
          of penalty territory — talk to a CPA if you're new to this.
        </li>
        <li>
          <div className="text-[#ff4500] uppercase tracking-[0.22em] text-[10px] mb-1">◆ International sellers</div>
          Currently U.S.-only. International seller onboarding is on the roadmap. Sales tax
          handling will differ — we'll notify you in advance.
        </li>
      </ul>
      <p className="font-mono text-[10px] text-[#525252] mt-6 leading-relaxed">
        ◇ This isn't tax advice — for anything specific to your situation, talk to a CPA.
      </p>
    </Section>
  );
}

// ============================================================================
// Shared section wrapper
// ============================================================================
function Section({ title, testId, children }) {
  return (
    <section className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 md:p-6" data-testid={testId}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-3">
        ◆ {title}
      </div>
      {children}
    </section>
  );
}
