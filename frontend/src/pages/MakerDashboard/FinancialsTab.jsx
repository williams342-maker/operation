import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, Wallet, FileText, Settings as SettingsIcon, BookOpen,
  Calculator, ScrollText, ExternalLink, Search, X,
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
 *   - Monthly statements  → downloadable monthly summaries
 *   - Payment settings    → payout cadence + bank-account routing (Stripe-managed)
 *   - QuickBooks export   → CSV export of all transactions in QB-compatible format
 *   - Xero export         → same data, Xero column layout
 *   - TurboTax export     → annual gross/fees breakdown for self-employed taxes
 *   - Legal & tax info    → 1099-K guidance, sales-tax notes, EIN field
 *
 * Live search filters the sub-nav by section label + keyword bag, and the
 * right pane filters dynamic rows (transactions, monthly statements) and
 * highlights matches in static copy. Cmd/Ctrl+K focuses the search; Esc
 * clears it. Mirrors the HelpTab UX so muscle memory carries over.
 */
const SECTIONS = [
  {
    id: "payment-account",
    label: "Payment account",
    icon: Wallet,
    keywords: [
      "stripe", "connect", "payout", "payouts", "bank", "balance", "pending",
      "onboard", "onboarding", "transactions", "history", "ledger", "fees",
    ],
  },
  {
    id: "monthly-statements",
    label: "Monthly statements",
    icon: FileText,
    keywords: ["statement", "month", "monthly", "report", "summary", "csv", "download"],
  },
  {
    id: "payment-settings",
    label: "Payment settings",
    icon: SettingsIcon,
    keywords: ["cadence", "bank", "routing", "weekly", "monthly", "stripe", "settings"],
  },
  {
    id: "quickbooks",
    label: "QuickBooks export",
    icon: BookOpen,
    keywords: ["quickbooks", "qb", "accounting", "csv", "export", "intuit", "self-employed"],
  },
  {
    id: "xero",
    label: "Xero export",
    icon: BookOpen,
    keywords: ["xero", "accounting", "csv", "export", "import", "bank statement"],
  },
  {
    id: "turbotax",
    label: "TurboTax export",
    icon: Calculator,
    keywords: ["turbotax", "tax", "schedule c", "self-employed", "annual", "income", "fees"],
  },
  {
    id: "legal-tax",
    label: "Legal & tax information",
    icon: ScrollText,
    keywords: [
      "1099", "1099-k", "irs", "sales tax", "marketplace facilitator", "ein",
      "self-employment", "international", "legal",
    ],
  },
];

export default function FinancialsTab() {
  const [section, setSection] = useState(SECTIONS[0].id);
  const [open, setOpen] = useState(true); // category open by default
  const [payouts, setPayouts] = useState(null);
  const [status, setStatus] = useState(null);
  const [txns, setTxns] = useState(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);

  const refresh = () => Promise.all([
    fetchMakerPayouts().catch(() => ({ payouts: [], pending: 0 })),
    stripeConnectStatus().catch(() => ({ connected: false })),
    fetchMakerTransactions().catch(() => ({ transactions: [] })),
  ]).then(([p, s, t]) => {
    setPayouts(p); setStatus(s); setTxns(t.transactions || []);
  });

  useEffect(() => { refresh(); }, []);

  // Cmd/Ctrl+K focuses search; Esc clears. Same shortcut as HelpTab so the
  // muscle memory carries over.
  useEffect(() => {
    const onKey = (e) => {
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (cmdK) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Filter sections by label + keywords. Empty query short-circuits.
  const { filteredSections, isSearching, matchCount } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { filteredSections: SECTIONS, isSearching: false, matchCount: 0 };
    const matched = SECTIONS.filter((s) => {
      if (s.label.toLowerCase().includes(q)) return true;
      return (s.keywords || []).some((k) => k.toLowerCase().includes(q));
    });
    return { filteredSections: matched, isSearching: true, matchCount: matched.length };
  }, [query]);

  // When searching, jump active section to the first match so the right pane
  // reflects the filter immediately. Falls back to the original section once
  // the query clears.
  useEffect(() => {
    if (!isSearching) return;
    if (filteredSections.length > 0 && !filteredSections.some((s) => s.id === section)) {
      setSection(filteredSections[0].id);
    }
  }, [isSearching, filteredSections, section]);

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
        {/* SUB-NAV with search */}
        <FinSubNav
          sections={filteredSections}
          activeId={section}
          onPick={setSection}
          open={open}
          onToggleOpen={() => setOpen((v) => !v)}
          query={query}
          setQuery={setQuery}
          searchRef={searchRef}
          isSearching={isSearching}
          matchCount={matchCount}
        />

        {/* ACTIVE SECTION */}
        <div className="min-w-0" data-testid={`financials-section-${section}`}>
          {isSearching && filteredSections.length === 0 ? (
            <NoResults query={query} onClear={() => setQuery("")} />
          ) : (
            <>
              {section === "payment-account" && (
                <PaymentAccount payouts={payouts} status={status} txns={txns} onRefresh={refresh} query={query} />
              )}
              {section === "monthly-statements" && <MonthlyStatements txns={txns} query={query} />}
              {section === "payment-settings" && <PaymentSettings status={status} query={query} />}
              {section === "quickbooks" && <ExportPanel format="quickbooks" txns={txns} query={query} />}
              {section === "xero" && <ExportPanel format="xero" txns={txns} query={query} />}
              {section === "turbotax" && <ExportPanel format="turbotax" txns={txns} query={query} />}
              {section === "legal-tax" && <LegalTax query={query} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-nav (single collapsible "Finances" category mirroring the Etsy screenshot)
// ============================================================================
function FinSubNav({
  sections, activeId, onPick, open, onToggleOpen,
  query, setQuery, searchRef, isSearching, matchCount,
}) {
  return (
    <div className="space-y-3">
      {/* Search box — Cmd/Ctrl+K to focus, Esc to clear. Mirrors HelpTab. */}
      <div className="relative" data-testid="financials-search-wrap">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search finances…"
          aria-label="Search financial sections"
          className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none pl-9 pr-16 py-2.5 font-mono text-xs text-[#e5e5e5] placeholder:text-[#525252]"
          data-testid="financials-search-input"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#a3a3a3] hover:text-[#ff4500] transition"
            aria-label="Clear search"
            data-testid="financials-search-clear"
          >
            <X size={14} />
          </button>
        ) : (
          <kbd className="hidden md:inline-flex absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 border border-[#262626] font-mono text-[9px] uppercase tracking-[0.18em] text-[#525252]">
            ⌘K
          </kbd>
        )}
      </div>
      {isSearching && (
        <div
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] px-1"
          data-testid="financials-search-result-count"
        >
          ◆ {matchCount} match{matchCount === 1 ? "" : "es"}
        </div>
      )}

      {/* Mobile: select */}
      <div className="lg:hidden">
        <select
          value={activeId}
          onChange={(e) => onPick(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5]"
          data-testid="financials-subnav-mobile"
          disabled={sections.length === 0}
        >
          {sections.length === 0 ? (
            <option>No matches</option>
          ) : (
            sections.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))
          )}
        </select>
      </div>

      {/* Desktop: collapsible */}
      <nav
        className="hidden lg:block bg-[#0d0d0d] border border-[#1f1f1f] p-2 self-start"
        data-testid="financials-subnav"
      >
        {sections.length === 0 ? (
          <div
            className="px-3 py-6 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]"
            data-testid="financials-subnav-empty"
          >
            No matches.
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggleOpen}
              aria-expanded={open || isSearching}
              className="w-full text-left px-3 py-2.5 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] transition border-l-2 border-[#ff4500] text-[#e5e5e5] hover:bg-[#161616]"
              data-testid="financials-cat-toggle"
            >
              <Wallet size={14} className="shrink-0" />
              <span className="flex-1 truncate">Finances</span>
              <ChevronDown
                size={12}
                className={`opacity-60 shrink-0 transition-transform ${(open || isSearching) ? "rotate-180" : ""}`}
              />
            </button>
            {(open || isSearching) && (
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
                        <Highlight text={s.label} query={query} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </nav>
    </div>
  );
}

// Empty-state right-pane shown when search returns zero sections.
function NoResults({ query, onClear }) {
  return (
    <div
      className="border border-dashed border-[#262626] p-10 text-center"
      data-testid="financials-no-results"
    >
      <Search size={28} className="mx-auto text-[#525252] mb-3" />
      <h2 className="font-display text-2xl uppercase mb-2">
        No financial sections match "<span className="text-[#ff4500]">{query}</span>"
      </h2>
      <p className="font-mono text-xs text-[#a3a3a3] max-w-md mx-auto mb-5 leading-relaxed">
        Try terms like <span className="text-[#e5e5e5]">stripe</span>, <span className="text-[#e5e5e5]">1099</span>,{" "}
        <span className="text-[#e5e5e5]">quickbooks</span>, or{" "}
        <span className="text-[#e5e5e5]">payout</span>.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition"
        data-testid="financials-no-results-clear"
      >
        Clear search →
      </button>
    </div>
  );
}

// ============================================================================
// Section: Payment account (Stripe Connect + transaction history)
// ============================================================================
function PaymentAccount({ payouts, status, txns, onRefresh, query }) {
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

  // Filter transaction history rows by query — match against kind, reference,
  // direction, and date prefix. Empty query keeps the full list.
  const q = (query || "").trim().toLowerCase();
  const filteredTxns = useMemo(() => {
    if (!q) return txns;
    return txns.filter((t) =>
      [t.kind, t.reference, t.direction, (t.created_at || "").slice(0, 10)]
        .some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }, [txns, q]);

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
        ) : filteredTxns.length === 0 ? (
          <p
            className="font-mono text-xs text-[#737373] py-6"
            data-testid="financials-txns-empty"
          >
            No transactions match "<span className="text-[#ff4500]">{query}</span>".
          </p>
        ) : (
          <div className="border border-[#1f1f1f]">
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 border-b border-[#1f1f1f] font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              <div>Description</div><div className="text-right">Amount</div><div className="text-right">Date</div>
            </div>
            {filteredTxns.map((t, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 border-b border-[#161616] font-mono text-xs items-center"
                data-testid={`txn-row-${i}`}
              >
                <div className="min-w-0">
                  <div className="text-[#e5e5e5] uppercase tracking-[0.18em] text-[10px]">
                    <Highlight text={t.kind} query={query} />{t.items_count ? ` · ${t.items_count} items` : ""}
                  </div>
                  <div className="text-[#737373] text-[10px] truncate">
                    <Highlight text={t.reference} query={query} />
                  </div>
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
function MonthlyStatements({ txns, query }) {
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
  const allMonths = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));

  // Filter by query: match against the YYYY-MM label.
  const q = (query || "").trim().toLowerCase();
  const months = q
    ? allMonths.filter(([ym]) => ym.toLowerCase().includes(q))
    : allMonths;

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
      {allMonths.length === 0 ? (
        <p className="font-mono text-xs text-[#737373] py-6">
          No statements yet — your first month will appear after your first sale.
        </p>
      ) : months.length === 0 ? (
        <p
          className="font-mono text-xs text-[#737373] py-6"
          data-testid="financials-statements-empty"
        >
          No months match "<span className="text-[#ff4500]">{query}</span>".
        </p>
      ) : (
        <div className="border border-[#1f1f1f]">
          {months.map(([ym, m]) => (
            <div
              key={ym}
              className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-3 border-b border-[#161616] items-center"
              data-testid={`statement-${ym}`}
            >
              <div className="font-mono text-xs text-[#e5e5e5] uppercase tracking-[0.18em]">
                <Highlight text={ym} query={query} />
              </div>
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
function PaymentSettings({ status, query }) {
  return (
    <Section title="Payment settings" testId="payment-settings">
      <p className="font-mono text-xs text-[#a3a3a3] mb-4 leading-relaxed max-w-xl">
        <Highlight
          text="Payout cadence and bank account routing are managed inside your Stripe dashboard — Crafters Market never touches your banking details."
          query={query}
        />
      </p>
      <ul className="space-y-2 mb-5 font-mono text-xs text-[#e5e5e5]">
        <li>• <Highlight text="Default cadence: every 2 business days after funds clear (Stripe standard)" query={query} /></li>
        <li>• <Highlight text="Switch to weekly or monthly from inside the Stripe dashboard" query={query} /></li>
        <li>• <Highlight text="Update your bank account or routing info there too" query={query} /></li>
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

function ExportPanel({ format, txns, query }) {
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
      <p className="font-mono text-xs text-[#a3a3a3] mb-5 leading-relaxed max-w-xl">
        <Highlight text={cfg.blurb} query={query} />
      </p>
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
function LegalTax({ query }) {
  const items = [
    {
      heading: "1099-K reporting",
      body: "Crafters Market issues 1099-Ks via Stripe to U.S. sellers who exceed the IRS reporting thresholds. The current threshold is $5,000 in gross sales for 2025 (dropping further in subsequent years). You'll receive your 1099-K in your Stripe dashboard.",
    },
    {
      heading: "Sales tax",
      body: "We collect and remit U.S. sales tax automatically for marketplace facilitator states. You don't need to charge sales tax inside your listings — Stripe handles it at checkout.",
    },
    {
      heading: "Self-employment tax",
      body: "Set aside roughly 25–30% of net income for federal income + self-employment (Social Security + Medicare) taxes. A quarterly estimated-tax payment schedule keeps you out of penalty territory — talk to a CPA if you're new to this.",
    },
    {
      heading: "International sellers",
      body: "Currently U.S.-only. International seller onboarding is on the roadmap. Sales tax handling will differ — we'll notify you in advance.",
    },
  ];
  return (
    <Section title="Legal & tax information" testId="legal-tax">
      <ul className="space-y-4 font-mono text-xs text-[#e5e5e5] leading-relaxed">
        {items.map((it) => (
          <li key={it.heading}>
            <div className="text-[#ff4500] uppercase tracking-[0.22em] text-[10px] mb-1">
              ◆ <Highlight text={it.heading} query={query} />
            </div>
            <Highlight text={it.body} query={query} />
          </li>
        ))}
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

// Highlights case-insensitive occurrences of `query` in `text`. Identical
// to the HelpTab implementation — kept inline rather than extracted to a
// shared util because it's 15 lines and copy-paste reads cleaner here.
function Highlight({ text, query }) {
  if (!query || !query.trim() || !text) return text || null;
  const q = query.trim().toLowerCase();
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = String(text).split(re);
  return (
    <>
      {parts.map((p, i) =>
        p && p.toLowerCase() === q ? (
          <mark key={i} className="bg-[#ff4500]/30 text-[#ffe5d6] px-0.5 rounded-sm">
            {p}
          </mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </>
  );
}
