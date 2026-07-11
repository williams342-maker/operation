import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown, Wallet, FileText, Settings as SettingsIcon, BookOpen,
  Calculator, ScrollText, ExternalLink, Search, X, Truck,
} from "lucide-react";
import CreditPacksCard from "./CreditPacksCard";

import {
  fetchMakerPayouts, fetchMakerTransactions, fetchMakerMe, updateMakerProfile,
  stripeConnectOnboard, stripeConnectStatus, stripeConnectDashboardLink,
  fetchMakerShippingLedger, setMakerShippingCadence, setMakerShippingCap,
  fetchShippingAnalytics,
  fetchMakerPayoutSchedule, fetchMakerBilling, fetchMakerSubscription,
  settleMakerLedgerNow, openMakerSubscriptionPortal,
} from "../../lib/api";
import { StatsSkeleton, RowsSkeleton } from "../../components/Skeleton";

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
    id: "shipping",
    label: "Shipping labels",
    icon: Truck,
    keywords: [
      "shipping", "shippo", "label", "tracking", "invoice", "usps", "ups",
      "fedex", "parcel", "carrier", "weekly", "biweekly", "cadence",
    ],
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
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
          ◆ Shop Manager · Finances
        </div>
        <h1 className="font-display text-3xl md:text-5xl uppercase leading-[0.95]">
          Financials.
        </h1>
        <p className="font-mono text-sm text-ink-muted mt-2 max-w-2xl">
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
              {section === "payment-settings" && <PaymentSettings status={status} payouts={payouts} query={query} />}
              {section === "quickbooks" && <ExportPanel format="quickbooks" txns={txns} query={query} />}
              {section === "xero" && <ExportPanel format="xero" txns={txns} query={query} />}
              {section === "turbotax" && <ExportPanel format="turbotax" txns={txns} query={query} />}
              {section === "shipping" && <ShippingPanel query={query} />}
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
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search finances…"
          aria-label="Search financial sections"
          className="w-full bg-paper border border-line focus:border-brand outline-none pl-9 pr-16 py-2.5 font-mono text-xs text-ink placeholder:text-ink-muted"
          data-testid="financials-search-input"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-brand transition"
            aria-label="Clear search"
            data-testid="financials-search-clear"
          >
            <X size={14} />
          </button>
        ) : (
          <kbd className="hidden md:inline-flex absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 border border-line font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
            ⌘K
          </kbd>
        )}
      </div>
      {isSearching && (
        <div
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand px-1"
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
          className="w-full bg-paper border border-line focus:border-brand outline-none px-4 py-3 font-mono text-sm text-ink"
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
        className="hidden lg:block bg-paper border border-line p-2 self-start"
        data-testid="financials-subnav"
      >
        {sections.length === 0 ? (
          <div
            className="px-3 py-6 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted"
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
              className="w-full text-left px-3 py-2.5 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] transition border-l-2 border-brand text-ink hover:bg-surface"
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
                            ? "bg-brand/10 text-brand"
                            : "text-ink-muted hover:text-ink hover:bg-surface"
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
      className="border border-dashed border-line p-10 text-center"
      data-testid="financials-no-results"
    >
      <Search size={28} className="mx-auto text-ink-muted mb-3" />
      <h2 className="font-display text-2xl uppercase mb-2">
        No financial sections match "<span className="text-brand">{query}</span>"
      </h2>
      <p className="font-mono text-xs text-ink-muted max-w-md mx-auto mb-5 leading-relaxed">
        Try terms like <span className="text-ink">stripe</span>, <span className="text-ink">1099</span>,{" "}
        <span className="text-ink">quickbooks</span>, or{" "}
        <span className="text-ink">payout</span>.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="px-4 py-2 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
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

  // Always coerce error.detail to a string — FastAPI returns a list-of-objects
  // for 422 validation errors, and rendering that as a React child blanks the
  // component with "Objects are not valid as a React child".
  const errMsg = (e, fallback) => {
    const d = e?.response?.data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join("; ");
    return fallback;
  };

  const onConnect = async () => {
    setBusy("connect"); setErr("");
    try {
      const r = await stripeConnectOnboard(window.location.origin);
      window.location.href = r.url;
    } catch (e) {
      setErr(errMsg(e, "Could not start onboarding."));
      setBusy("");
    }
  };
  const onDashboard = async () => {
    setBusy("dashboard"); setErr("");
    try {
      const r = await stripeConnectDashboardLink();
      window.location.href = r.url;
    } catch (e) {
      // Backend signals onboarding-incomplete via HTTP 409 with detail.code.
      // Detect either the structured object OR the legacy string fallback,
      // and silently re-launch onboarding instead of dumping a raw error.
      const detail = e?.response?.data?.detail;
      const isIncomplete =
        e?.response?.status === 409 &&
        ((typeof detail === "object" && detail?.code === "onboarding_incomplete") ||
          (typeof detail === "string" && /onboarding/i.test(detail)));
      if (isIncomplete) {
        try {
          const r = await stripeConnectOnboard(window.location.origin);
          window.location.href = r.url;
          return;
        } catch (e2) {
          setErr(errMsg(e2, "Finish your Stripe onboarding to open the dashboard."));
        }
      } else {
        setErr(errMsg(e, "Could not open dashboard."));
      }
      setBusy("");
    }
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
            <p className="font-mono text-xs text-ink-muted mb-4 max-w-xl leading-relaxed">
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
              <div className="font-display text-3xl text-brand mb-1">
                ${(payouts?.pending || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
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
          <p className="font-mono text-xs text-ink-muted py-6">
            No transactions yet — they'll appear here after your first sale.
          </p>
        ) : filteredTxns.length === 0 ? (
          <p
            className="font-mono text-xs text-ink-muted py-6"
            data-testid="financials-txns-empty"
          >
            No transactions match "<span className="text-brand">{query}</span>".
          </p>
        ) : (
          <div className="border border-line">
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 border-b border-line font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
              <div>Description</div><div className="text-right">Amount</div><div className="text-right">Date</div>
            </div>
            {filteredTxns.map((t, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 border-b border-[#161616] font-mono text-xs items-center"
                data-testid={`txn-row-${i}`}
              >
                <div className="min-w-0">
                  <div className="text-ink uppercase tracking-[0.18em] text-[10px]">
                    <Highlight text={t.kind} query={query} />{t.items_count ? ` · ${t.items_count} items` : ""}
                  </div>
                  <div className="text-ink-muted text-[10px] truncate">
                    <Highlight text={t.reference} query={query} />
                  </div>
                </div>
                <div className={`text-right font-display text-base ${t.direction === "credit" ? "text-emerald-700" : "text-brand"}`}>
                  {t.direction === "credit" ? "+" : "−"}${t.amount.toFixed(2)}
                </div>
                <div className="text-right text-[10px] text-ink-muted">
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
      <p className="font-mono text-xs text-ink-muted mb-5 leading-relaxed max-w-xl">
        Download a CSV summary for any month — pairs nicely with your accounting software.
      </p>
      {allMonths.length === 0 ? (
        <p className="font-mono text-xs text-ink-muted py-6">
          No statements yet — your first month will appear after your first sale.
        </p>
      ) : months.length === 0 ? (
        <p
          className="font-mono text-xs text-ink-muted py-6"
          data-testid="financials-statements-empty"
        >
          No months match "<span className="text-brand">{query}</span>".
        </p>
      ) : (
        <div className="border border-line">
          {months.map(([ym, m]) => (
            <div
              key={ym}
              className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-3 border-b border-[#161616] items-center"
              data-testid={`statement-${ym}`}
            >
              <div className="font-mono text-xs text-ink uppercase tracking-[0.18em]">
                <Highlight text={ym} query={query} />
              </div>
              <div className="font-display text-base text-emerald-700 text-right">+${m.credits.toFixed(2)}</div>
              <div className="font-display text-base text-brand text-right">−${m.debits.toFixed(2)}</div>
              <button
                onClick={() => downloadCsv(ym)}
                className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
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
// ============================================================================
// iter441/444 — Financial settings: PayPal payout email, payout method,
// schedule, minimum, hold period + live balance strip
// ============================================================================
function PayPalPayoutCard({ payouts }) {
  const [me, setMe] = useState(null);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [ov, setOv] = useState(null);
  const [minUsd, setMinUsd] = useState("25");

  const loadOverview = () => {
    import("../../lib/api").then(({ fetchMakerPayoutOverview }) =>
      fetchMakerPayoutOverview().then((d) => {
        setOv(d);
        setMinUsd(String(Math.round((d.payout_min_cents || 2500) / 100)));
      }).catch(() => {}));
  };

  useEffect(() => {
    fetchMakerMe().then((m) => {
      setMe(m);
      setEmail(m?.paypal_email || "");
    }).catch(() => {});
    loadOverview();
  }, []);

  const rows = payouts?.payouts || payouts || [];
  const deferredCents = (Array.isArray(rows) ? rows : [])
    .filter((p) => p.provider === "paypal" && ["deferred", "failed"].includes(p.status))
    .reduce((sum, p) => sum + (Number(p.amount_cents) || 0), 0);

  const saveSettings = async (patch) => {
    setSaving(true);
    try {
      const m = await updateMakerProfile(patch);
      setMe(m);
      loadOverview();
      toast.success("Financial settings saved.");
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error((typeof detail === "string" && detail) || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast.error("Please enter a valid PayPal email address.");
      return;
    }
    await saveSettings({ paypal_email: v });
  };

  const usd = (c) => `$${((c || 0) / 100).toFixed(2)}`;
  const stat = (label, value, testId) => (
    <div className="border border-line p-2" data-testid={testId}>
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted">{label}</div>
      <div className="font-mono text-sm text-ink mt-0.5">{value}</div>
    </div>
  );

  return (
    <div className="mb-6" data-testid="paypal-payout-card">
      {deferredCents > 0 && !me?.paypal_email && (
        <div className="border border-amber-400/60 bg-amber-400/5 p-4 mb-3" data-testid="paypal-email-banner">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-amber-600 mb-1">
            ⚠ PayPal payout information required
          </div>
          <p className="font-mono text-xs text-ink">
            Deferred balance: <strong className="text-brand">${(deferredCents / 100).toFixed(2)}</strong>
            {" "}— a buyer paid with PayPal. Add your PayPal email below to receive these funds;
            your balance is held safely until you do.
          </p>
        </div>
      )}
      <div className="border border-line bg-paper p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-2">
          ◆ Financial settings — PayPal payouts
        </div>

        {ov && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4" data-testid="payout-overview-strip">
            {stat("Available", usd(ov.available_cents), "po-available")}
            {stat("Pending", usd(ov.pending_cents), "po-pending")}
            {stat("Next payout", ov.next_payout_date || "manual", "po-next")}
            {stat("Lifetime paid", usd(ov.lifetime_paid_cents), "po-lifetime")}
          </div>
        )}

        <p className="font-mono text-[11px] text-ink-muted leading-relaxed mb-3 max-w-xl">
          When a buyer pays with PayPal, your share accrues here and is paid to your PayPal
          account automatically on your schedule.
        </p>
        {me?.paypal_email && (
          <p className="font-mono text-xs mb-3" data-testid="paypal-email-current">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-2" />
            Payout email on file: <span className="text-ink">{me.paypal_email}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@paypal-email.com"
            className="border border-line bg-paper px-3 py-2 font-mono text-xs w-72"
            data-testid="paypal-email-input"
          />
          <button
            type="button"
            onClick={save}
            disabled={saving || !email.trim()}
            className="border border-brand text-brand px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] hover:bg-brand hover:text-paper disabled:opacity-50 transition"
            data-testid="paypal-email-save-btn"
          >
            {saving ? "Saving…" : me?.paypal_email ? "Update email" : "Save email"}
          </button>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted mb-2">Payout method</div>
            {["stripe", "paypal"].map((v) => (
              <label key={v} className="flex items-center gap-2 font-mono text-xs mb-1 cursor-pointer">
                <input type="radio" name="payout_method" checked={(ov?.payout_method || "paypal") === v}
                       onChange={() => saveSettings({ payout_method: v })}
                       data-testid={`payout-method-${v}`} />
                {v === "stripe" ? "Stripe" : "PayPal"}
              </label>
            ))}
          </div>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted mb-2">Payout frequency</div>
            {["daily", "weekly", "monthly", "manual"].map((v) => (
              <label key={v} className="flex items-center gap-2 font-mono text-xs mb-1 cursor-pointer">
                <input type="radio" name="payout_frequency" checked={(ov?.payout_frequency || "weekly") === v}
                       onChange={() => saveSettings({ payout_frequency: v })}
                       data-testid={`payout-frequency-${v}`} />
                {v[0].toUpperCase() + v.slice(1)}
              </label>
            ))}
          </div>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted mb-2">Minimum automatic payout</div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">$</span>
              <input type="number" min="25" step="1" value={minUsd}
                     onChange={(e) => setMinUsd(e.target.value)}
                     className="border border-line bg-paper px-2 py-1.5 font-mono text-xs w-20"
                     data-testid="payout-min-input" />
              <button type="button" disabled={saving}
                      onClick={() => saveSettings({ payout_min_cents: Math.round((parseFloat(minUsd) || 25) * 100) })}
                      className="border border-line px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] hover:border-brand transition"
                      data-testid="payout-min-save-btn">
                Set
              </button>
            </div>
            <p className="font-mono text-[10px] text-ink-muted mt-2">
              Platform minimum $25 · Orders become eligible after{" "}
              <strong className="text-ink">{ov?.hold_days ?? 7} days</strong> (platform-controlled).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentSettings({ status, payouts, query }) {
  const [schedule, setSchedule] = useState(null);
  const [billing, setBilling] = useState(null);
  const [sub, setSub] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: null, text: "" });

  const reload = React.useCallback(() => {
    fetchMakerPayoutSchedule().then(setSchedule).catch(() => {});
    fetchMakerBilling().then(setBilling).catch(() => {});
    fetchMakerSubscription().then(setSub).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const dollars = (c) => `$${(c / 100).toFixed(2)}`;
  const isPlus = sub?.status === "active";

  const onSettleNow = async () => {
    if (!billing) return;
    setBusy(true);
    setMsg({ kind: null, text: "" });
    try {
      const r = await settleMakerLedgerNow();
      setMsg({
        kind: "ok",
        text: `Invoiced ${dollars(r.amount_cents)} to your card on file (Stripe invoice ${r.invoice_id}). Your ledger is now at $0.`,
      });
      reload();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const text = (typeof detail === "object" && detail?.message) || detail || "Could not settle the balance.";
      setMsg({ kind: "err", text });
    } finally {
      setBusy(false);
    }
  };

  const onOpenPortal = async () => {
    setBusy(true);
    try {
      const { url } = await openMakerSubscriptionPortal();
      window.location.href = url;
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setMsg({ kind: "err", text: (typeof detail === "object" && detail?.message) || detail || "Could not open billing portal." });
      setBusy(false);
    }
  };

  return (
    <Section title="Payment settings" testId="payment-settings">
      {/* iter441 — PayPal payout destination. PayPal-paid orders accrue as
          deferred balances until the maker adds the PayPal email they want
          to be paid at. */}
      <PayPalPayoutCard payouts={payouts} />

      {/* Live payout schedule — pulled from Stripe Account.settings.payouts.schedule
          on every load so the maker sees their actual configured cadence
          (not the platform default). Falls back to env defaults when Stripe
          isn't connected yet. */}
      {schedule && (
        <div
          className="mb-6 border border-line bg-paper p-4"
          data-testid="payment-settings-payout-schedule"
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                Your payout schedule
              </div>
              <div className="font-display text-2xl mt-1 capitalize">
                {schedule.interval}
                {schedule.weekly_anchor && (
                  <span className="text-ink-muted"> · {schedule.weekly_anchor}</span>
                )}
                {schedule.monthly_anchor != null && (
                  <span className="text-ink-muted"> · day {schedule.monthly_anchor}</span>
                )}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-1">
                {schedule.delay_days}-day rolling delay · funds settle{" "}
                {schedule.delay_days <= 2
                  ? "almost immediately"
                  : `${schedule.delay_days} days after each sale`}
                {!schedule.payouts_enabled && (
                  <span className="text-red-400 ml-2">· payouts not yet enabled</span>
                )}
              </div>
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
              {schedule.source === "stripe" ? "Live from Stripe" : "Default schedule"}
            </div>
          </div>
        </div>
      )}

      {/* Pending listing/promo balance — shown for everyone but the
          Settle Now button is Plus-only (free-tier balances drain
          through sale payouts). */}
      {billing && (
        <div
          className="mb-6 border border-line bg-paper p-4"
          data-testid="payment-settings-pending"
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                Pending listing / promo charges
              </div>
              <div className="font-display text-2xl mt-1 text-brand">
                {dollars(billing.pending_charges_cents)}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-1">
                {isPlus
                  ? "Auto-billed to your card · 1st of every month"
                  : "Auto-deducted from your next payout"}
              </div>
            </div>
            {isPlus && billing.pending_charges_cents >= 100 && (
              <button
                type="button"
                onClick={onSettleNow}
                disabled={busy}
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand hover:bg-brand/10 border border-brand/60 px-4 py-2 transition disabled:opacity-50 self-start"
                data-testid="payment-settings-settle-now"
                title="Charge your card on file now instead of waiting for the 1st-of-month sweep"
              >
                {busy ? "Settling…" : "◆ Settle now"}
              </button>
            )}
          </div>
          {msg.text && (
            <div
              className={`mt-3 font-mono text-[10px] leading-relaxed ${
                msg.kind === "ok" ? "text-emerald-700" : "text-red-400"
              }`}
              data-testid="payment-settings-settle-msg"
            >
              {msg.kind === "ok" ? "✓ " : "⊗ "}{msg.text}
            </div>
          )}
        </div>
      )}

      <p className="font-mono text-xs text-ink-muted mb-4 leading-relaxed max-w-xl">
        <Highlight
          text="Bank account routing is managed inside your Stripe dashboard — Crafters Market never touches your banking details. Use the buttons below to change cadence or update payment info."
          query={query}
        />
      </p>
      <ul className="space-y-2 mb-5 font-mono text-xs text-ink">
        <li>• <Highlight text="Switch payout cadence (daily/weekly/monthly with any anchor day) inside Stripe" query={query} /></li>
        <li>• <Highlight text="Update your bank account, routing, or debit card from the same dashboard" query={query} /></li>
        <li>• <Highlight text="Plus members: card on file is also used for monthly listing-fee invoices" query={query} /></li>
      </ul>
      <div className="flex flex-wrap gap-2">
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
          <p className="font-mono text-xs text-brand">
            ◇ Connect Stripe first (Payment account → Connect Stripe).
          </p>
        )}
        {isPlus && (
          <button
            type="button"
            onClick={onOpenPortal}
            disabled={busy}
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-700 hover:text-emerald-700 border border-emerald-400/40 px-4 py-2 disabled:opacity-50"
            data-testid="payment-settings-portal"
          >
            Manage Plus billing ↗
          </button>
        )}
      </div>

      {/* Pre-paid listing credit packs — bulk discount alternative to the
          per-payout $0.20 cash settlement. Self-fetches and self-handles
          Stripe Checkout return; renders nothing while loading. */}
      <div className="mt-8" data-testid="payment-settings-credit-packs">
        <CreditPacksCard />
      </div>
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
      <p className="font-mono text-xs text-ink-muted mb-5 leading-relaxed max-w-xl">
        <Highlight text={cfg.blurb} query={query} />
      </p>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
        ◆ Columns
      </div>
      <div className="border border-line p-3 mb-5 font-mono text-[11px] text-ink flex flex-wrap gap-2">
        {cfg.columns.map((c) => (
          <code key={c} className="px-2 py-1 bg-surface text-ink-muted">{c}</code>
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
        <p className="font-mono text-xs text-ink-muted mt-3">
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
      <ul className="space-y-4 font-mono text-xs text-ink leading-relaxed">
        {items.map((it) => (
          <li key={it.heading}>
            <div className="text-brand uppercase tracking-[0.22em] text-[10px] mb-1">
              ◆ <Highlight text={it.heading} query={query} />
            </div>
            <Highlight text={it.body} query={query} />
          </li>
        ))}
      </ul>
      <p className="font-mono text-[10px] text-ink-muted mt-6 leading-relaxed">
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
    <section className="border border-line bg-paper p-5 md:p-6" data-testid={testId}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">
        ◆ {title}
      </div>
      {children}
    </section>
  );
}

// ============================================================================
// Shipping panel — Phase 2C. Shows "you owe $X on next invoice" pill,
// cadence toggle (weekly / biweekly), and the per-label table with
// tracking + PDF reprint links.
// ============================================================================
function ShippingPanel({ query }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [savingCadence, setSavingCadence] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      setData(await fetchMakerShippingLedger());
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't load shipping ledger.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const changeCadence = async (next) => {
    if (!data || data.cadence === next) return;
    setSavingCadence(true);
    try {
      await setMakerShippingCadence(next);
      setData({ ...data, cadence: next });
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't save cadence.");
    } finally {
      setSavingCadence(false);
    }
  };

  const q = (query || "").trim().toLowerCase();
  const rows = (data?.rows || []).filter((r) => {
    if (!q) return true;
    return (
      (r.tracking_number || "").toLowerCase().includes(q)
      || (r.provider || "").toLowerCase().includes(q)
      || (r.servicelevel_name || "").toLowerCase().includes(q)
      || (r.session_id || "").toLowerCase().includes(q)
    );
  });

  return (
    <Section title="Shipping labels" testId="financials-shipping">
      <p className="font-mono text-xs text-ink-muted mb-5 leading-relaxed max-w-xl">
        Crafters Market pays the carrier when you buy a label from the Orders tab.
        On your next invoice run (see cadence below) we'll charge your on-file
        card for the labels you've used.
      </p>

      {err && (
        <div className="border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-400 font-mono mb-4">
          {err}
        </div>
      )}

      {loading && !data && (
        <div className="space-y-5" data-testid="financials-loading">
          <StatsSkeleton count={4} />
          <RowsSkeleton count={4} />
        </div>
      )}

      {data && (
        <>
          {/* Unbilled pile — the headline */}
          <div
            className="grid md:grid-cols-3 gap-4 mb-6"
            data-testid="financials-shipping-summary"
          >
            <MetricCard
              label="Next invoice"
              value={`$${(data.unbilled_cents / 100).toFixed(2)}`}
              hint={`${data.unbilled_count} label${data.unbilled_count === 1 ? "" : "s"} pending`}
              accent
              testId="shipping-next-invoice-amount"
            />
            <MetricCard
              label="Billed to date"
              value={`$${(data.billed_cents / 100).toFixed(2)}`}
              hint="Settled on prior invoices"
            />
            <MetricCard
              label="Lifetime"
              value={`$${(data.lifetime_cents / 100).toFixed(2)}`}
              hint="All labels ever purchased"
            />
          </div>

          {/* Cadence toggle */}
          <div
            className="border border-line bg-paper p-4 mb-4 flex items-center justify-between gap-4 flex-wrap"
            data-testid="shipping-cadence-row"
          >
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">
                Invoice cadence
              </div>
              <p className="font-mono text-xs text-ink-muted leading-relaxed">
                Weekly runs every Monday · biweekly runs every other Monday.
                Missed a charge? We'll retry automatically for up to 3 days.
              </p>
            </div>
            <div className="flex border border-line" role="group" aria-label="Cadence">
              {["weekly", "biweekly"].map((c) => (
                <button
                  key={c}
                  onClick={() => changeCadence(c)}
                  disabled={savingCadence}
                  className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition ${
                    data.cadence === c
                      ? "bg-brand text-ink"
                      : "text-ink-muted hover:text-brand"
                  }`}
                  data-testid={`shipping-cadence-${c}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Monthly spend cap — safety guard for the unbilled pile. */}
          <CapRow data={data} reload={load} />

          {/* 30-day shipping analytics mini-chart, stacked by carrier. */}
          <ShippingAnalyticsCard />

          {/* Ledger table */}
          {rows.length === 0 ? (
            <p className="font-mono text-xs text-ink-muted py-6" data-testid="shipping-ledger-empty">
              {q
                ? <>No labels match "<span className="text-brand">{query}</span>".</>
                : "No shipping labels yet. Head to Orders to buy your first one."}
            </p>
          ) : (
            <div className="border border-line" data-testid="shipping-ledger-table">
              <div className="hidden md:grid grid-cols-[1fr_1fr_1fr_100px_110px_80px] gap-3 px-4 py-2 border-b border-line font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                <span>Date</span>
                <span>Carrier · Service</span>
                <span>Tracking</span>
                <span className="text-right">Amount</span>
                <span>Status</span>
                <span>Label</span>
              </div>
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="grid md:grid-cols-[1fr_1fr_1fr_100px_110px_80px] gap-3 px-4 py-3 border-b border-line last:border-b-0 font-mono text-xs text-ink items-center"
                  data-testid={`shipping-row-${r.id}`}
                >
                  <span className="text-ink-muted">{new Date(r.created_at).toLocaleDateString()}</span>
                  <span className="truncate">
                    <span className="text-brand">{r.provider}</span>
                    <span className="text-ink-muted"> · </span>
                    {r.servicelevel_name}
                  </span>
                  <span className="truncate">
                    {r.tracking_url_provider ? (
                      <a href={r.tracking_url_provider} target="_blank" rel="noopener noreferrer"
                         className="underline hover:text-brand">{r.tracking_number}</a>
                    ) : r.tracking_number}
                  </span>
                  <span className="text-right">${((r.billed_cents || 0) / 100).toFixed(2)}</span>
                  <span>
                    {r.billed_at ? (
                      <span className="px-1.5 py-0.5 border border-emerald-400/40 text-emerald-700 text-[9px] uppercase tracking-[0.18em]">
                        Billed
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 border border-yellow-400/40 text-brand text-[9px] uppercase tracking-[0.18em]">
                        Unbilled
                      </span>
                    )}
                  </span>
                  <span>
                    {r.label_url && (
                      <a
                        href={r.label_url}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand hover:underline"
                        data-testid={`shipping-row-pdf-${r.id}`}
                      >
                        <FileText size={11} /> PDF
                      </a>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function MetricCard({ label, value, hint, accent, testId }) {
  return (
    <div
      className={`border p-4 ${accent ? "border-brand/50 bg-brand/5" : "border-line bg-paper"}`}
      data-testid={testId}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">
        {label}
      </div>
      <div className={`font-display text-3xl ${accent ? "text-brand" : "text-ink"}`}>
        {value}
      </div>
      {hint && (
        <div className="font-mono text-[10px] text-ink-muted mt-1">{hint}</div>
      )}
    </div>
  );
}

function CapRow({ data, reload }) {
  // Initialise the input to the dollar value of the stored cap (0 = disabled).
  const [capInput, setCapInput] = useState(
    ((data.monthly_cap_cents || 0) / 100).toFixed(2),
  );
  const [saving, setSaving] = useState(false);
  const monthSpent = (data.month_spent_cents || 0) / 100;
  const cap = data.monthly_cap_cents || 0;
  const overCap = cap > 0 && (data.month_spent_cents || 0) >= cap;
  const near = cap > 0 && (data.month_spent_cents || 0) >= cap * 0.8 && !overCap;

  const save = async () => {
    setSaving(true);
    try {
      const usd = Math.max(0, parseFloat(capInput) || 0);
      await setMakerShippingCap(usd);
      toast.success(usd === 0 ? "Cap disabled." : `Cap set to $${usd.toFixed(2)}/mo.`);
      await reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save cap.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="border border-line bg-paper p-4 mb-6 flex items-center justify-between gap-4 flex-wrap"
      data-testid="shipping-cap-row"
    >
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">
          Monthly spend cap
        </div>
        <p className="font-mono text-xs text-ink-muted leading-relaxed">
          Set a safety limit on label spend — we'll block label purchases once
          this month's shipping exceeds it. <span className="text-ink-muted">Set to 0 to disable.</span>
        </p>
        <div className="mt-2 font-mono text-[11px]">
          <span className="text-ink-muted">This month: </span>
          <span className={overCap ? "text-red-400" : near ? "text-brand" : "text-ink"}>
            ${monthSpent.toFixed(2)}
          </span>
          {cap > 0 && (
            <span className="text-ink-muted"> / ${(cap / 100).toFixed(2)}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center border border-line bg-paper">
          <span className="px-2 font-mono text-xs text-ink-muted">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            className="w-24 bg-transparent outline-none px-2 py-2 font-mono text-xs text-ink"
            data-testid="shipping-cap-input"
          />
          <span className="px-2 font-mono text-[10px] text-ink-muted">/mo</span>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="btn-industrial disabled:opacity-50"
          data-testid="shipping-cap-save"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 30-day shipping analytics mini-chart, stacked by carrier.
// Pure-SVG so no chart lib cost. Each day is a vertical bar stacked by
// carrier (USPS / UPS / FedEx / DHL / Other). Toggle between 7/30/90 days.
// ────────────────────────────────────────────────────────────────────
const CARRIER_COLORS = {
  usps:  "#ff4500",           // brand orange
  ups:   "#8a5a2a",           // UPS brown
  fedex: "#7c3aed",           // violet-600
  dhl:   "#facc15",           // yellow-400
  other: "#a3a3a3",           // neutral
};
const CARRIER_LABELS = {
  usps: "USPS", ups: "UPS", fedex: "FedEx", dhl: "DHL", other: "Other",
};

function ShippingAnalyticsCard() {
  const [windowDays, setWindowDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchShippingAnalytics(windowDays)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [windowDays]);

  const series = data?.series || [];
  const totals = data?.totals || { total: 0, count: 0 };
  const maxDay = Math.max(1, ...series.map((s) => s.total || 0));
  // Viewbox uses logical units: 1 per day wide, 100 tall. CSS handles responsive scaling.
  const W = Math.max(series.length, 1);
  const H = 100;
  const barPad = 0.1; // 10% gap each side → 80% bar width

  return (
    <div
      className="border border-line bg-paper p-4 mb-6"
      data-testid="shipping-analytics-card"
    >
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            ◆ Shipping volume · last {windowDays} days
          </div>
          <div className="font-mono text-[11px] text-ink-muted mt-1">
            {totals.count > 0 ? (
              <>
                {totals.count} label{totals.count === 1 ? "" : "s"} · $
                {((totals.total || 0) / 100).toFixed(2)} spent
                {data?.top_carrier && (
                  <>
                    <span className="mx-1">·</span>
                    top carrier{" "}
                    <span style={{ color: CARRIER_COLORS[data.top_carrier] }}>
                      {CARRIER_LABELS[data.top_carrier]}
                    </span>
                  </>
                )}
              </>
            ) : loading ? "Loading…" : "No labels in this window yet."}
          </div>
        </div>
        {/* Window toggle */}
        <div className="flex border border-line" role="group" aria-label="Window">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setWindowDays(d)}
              className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                windowDays === d
                  ? "bg-brand text-ink"
                  : "text-ink-muted hover:text-brand"
              }`}
              data-testid={`shipping-analytics-window-${d}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-24 block"
        data-testid="shipping-analytics-svg"
      >
        {/* Zero-baseline */}
        <line x1="0" y1={H} x2={W} y2={H} stroke="#1f1f1f" strokeWidth="0.4" />
        {series.map((s, i) => {
          // Stack order (bottom-up): usps, ups, fedex, dhl, other
          const keys = ["usps", "ups", "fedex", "dhl", "other"];
          let yCursor = H;
          const x = i + barPad;
          const w = 1 - barPad * 2;
          return (
            <g key={s.date}>
              <title>{`${s.date} · $${(s.total / 100).toFixed(2)} · ${s.count} label${s.count === 1 ? "" : "s"}`}</title>
              {keys.map((k) => {
                const cents = s[k] || 0;
                if (cents <= 0) return null;
                const segH = (cents / maxDay) * (H - 2); // reserve 2u for baseline
                yCursor -= segH;
                return (
                  <rect
                    key={k}
                    x={x}
                    y={yCursor}
                    width={w}
                    height={segH}
                    fill={CARRIER_COLORS[k]}
                    opacity={0.95}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Axis labels — first + middle + last */}
      {series.length > 0 && (
        <div className="flex justify-between font-mono text-[9px] text-ink-muted mt-1">
          <span>{_fmtDay(series[0].date)}</span>
          {series.length > 2 && <span>{_fmtDay(series[Math.floor(series.length / 2)].date)}</span>}
          <span>{_fmtDay(series[series.length - 1].date)}</span>
        </div>
      )}

      {/* Legend — only carriers with data */}
      {totals.count > 0 && (
        <div className="flex flex-wrap gap-3 mt-3">
          {Object.keys(CARRIER_LABELS).map((k) => {
            const cents = totals[k] || 0;
            if (cents <= 0) return null;
            return (
              <div
                key={k}
                className="flex items-center gap-1.5 font-mono text-[10px] text-ink-muted"
                data-testid={`shipping-analytics-legend-${k}`}
              >
                <span
                  className="inline-block w-2 h-2"
                  style={{ backgroundColor: CARRIER_COLORS[k] }}
                />
                {CARRIER_LABELS[k]} · ${(cents / 100).toFixed(2)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function _fmtDay(iso) {
  if (!iso) return "";
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return iso; }
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
          <mark key={i} className="bg-brand/30 text-[#ffe5d6] px-0.5 rounded-sm">
            {p}
          </mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </>
  );
}
