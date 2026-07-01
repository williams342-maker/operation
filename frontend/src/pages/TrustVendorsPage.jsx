import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search, Shield, ArrowLeft, ExternalLink,
  CreditCard, Cloud, BarChart3, Megaphone, Mail, Truck, Bug, Sparkles,
} from "lucide-react";
import { VENDORS, VENDOR_CATEGORIES } from "../data/policies/vendors";
import { useStructuredData } from "../lib/seo";

// ============================================================
//  Trust · Vendors — /trust/vendors
//  A searchable, filterable presentation of the same
//  Third-Party Service Providers data that lives in
//  Privacy Policy §4a.
//
//  Purpose: give Buyers and Makers a "which company sees what
//  data, and why" view without asking them to read a §-numbered
//  policy. Backed by the same VENDORS array so the two views
//  can never drift.
//
//  Version 1.0 · 2026-06-30 · iter413v4-trust
// ============================================================

const CATEGORY_ICON = {
  payments:   CreditCard,
  hosting:    Cloud,
  analytics:  BarChart3,
  ads:        Megaphone,
  email:      Mail,
  shipping:   Truck,
  monitoring: Bug,
  ai:         Sparkles,
};

const CATEGORY_ACCENT = {
  payments:   "text-emerald-700 bg-emerald-50 border-emerald-200",
  hosting:    "text-sky-700 bg-sky-50 border-sky-200",
  analytics:  "text-violet-700 bg-violet-50 border-violet-200",
  ads:        "text-amber-800 bg-amber-50 border-amber-200",
  email:      "text-rose-700 bg-rose-50 border-rose-200",
  shipping:   "text-orange-700 bg-orange-50 border-orange-200",
  monitoring: "text-slate-700 bg-slate-100 border-slate-200",
  ai:         "text-indigo-700 bg-indigo-50 border-indigo-200",
};

function CategoryChip({ category, size = "sm", testId }) {
  const Icon = CATEGORY_ICON[category] || Shield;
  const label = VENDOR_CATEGORIES.find((c) => c.key === category)?.label || category;
  const cls = CATEGORY_ACCENT[category] || "text-slate-700 bg-slate-100 border-slate-200";
  const paddings = size === "lg" ? "px-3 py-1.5 text-sm" : "px-2 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${paddings} ${cls}`}
      data-testid={testId}
    >
      <Icon className={size === "lg" ? "w-4 h-4" : "w-3 h-3"} />
      {label}
    </span>
  );
}

function VendorCard({ vendor }) {
  return (
    <article
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
      data-testid={`vendor-card-${vendor.id}`}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-slate-900" data-testid={`vendor-name-${vendor.id}`}>
            {vendor.name}
          </h3>
          <p className="text-sm text-slate-600 mt-0.5">{vendor.role}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {vendor.categories.map((c) => (
            <CategoryChip
              key={c}
              category={c}
              testId={`vendor-${vendor.id}-chip-${c}`}
            />
          ))}
        </div>
      </div>

      <dl className="mt-5 space-y-3 text-sm">
        <div>
          <dt className="font-mono uppercase tracking-[0.12em] text-[11px] text-slate-500">
            Data received
          </dt>
          <dd className="text-slate-800 mt-0.5 leading-relaxed">
            {vendor.data_received}
          </dd>
        </div>
        <div>
          <dt className="font-mono uppercase tracking-[0.12em] text-[11px] text-slate-500">
            Why we send it
          </dt>
          <dd className="text-slate-800 mt-0.5 leading-relaxed">{vendor.purpose}</dd>
        </div>
        <div>
          <dt className="font-mono uppercase tracking-[0.12em] text-[11px] text-slate-500">
            Governing terms
          </dt>
          <dd className="text-slate-800 mt-0.5 leading-relaxed">
            {vendor.governing_terms}
          </dd>
        </div>
      </dl>

      {vendor.website && (
        <div className="mt-5">
          <a
            href={vendor.website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-900 hover:text-slate-700 underline underline-offset-4"
            data-testid={`vendor-${vendor.id}-external-link`}
          >
            View vendor privacy policy
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}
    </article>
  );
}

export default function TrustVendorsPage() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  useStructuredData({
    title: "Third-Party Vendors · Trust Center · Crafters Market",
    description:
      "Which vendors receive Crafters Market data, what data they receive, and why. Full transparency across payments, hosting, analytics, ads, email, shipping, monitoring, and AI providers.",
    url: "https://craftersmarket.org/trust/vendors",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Third-Party Vendors · Trust Center · Crafters Market",
      url: "https://craftersmarket.org/trust/vendors",
      isPartOf: {
        "@type": "WebSite",
        "@id": "https://craftersmarket.org/#website",
      },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Trust Center", item: "https://craftersmarket.org/trust" },
          { "@type": "ListItem", position: 2, name: "Vendors",       item: "https://craftersmarket.org/trust/vendors" },
        ],
      },
    },
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return VENDORS.filter((v) => {
      if (activeCategory !== "all" && !v.categories.includes(activeCategory)) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        v.name,
        v.role,
        v.data_received,
        v.purpose,
        v.governing_terms,
        ...v.categories,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query, activeCategory]);

  const categoryCounts = useMemo(() => {
    const map = { all: VENDORS.length };
    VENDOR_CATEGORIES.forEach((c) => {
      map[c.key] = VENDORS.filter((v) => v.categories.includes(c.key)).length;
    });
    return map;
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-5xl mx-auto px-6 py-16">

        {/* Breadcrumb */}
        <div className="mb-8 flex items-center gap-2 text-sm text-slate-600">
          <Link
            to="/trust"
            className="inline-flex items-center gap-1 hover:text-slate-900"
            data-testid="trust-vendors-breadcrumb-trust"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Trust Center
          </Link>
          <span className="text-slate-400">/</span>
          <span className="text-slate-900 font-medium">Vendors</span>
        </div>

        {/* Header */}
        <header className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-mono uppercase tracking-[0.18em] mb-6">
            <Shield className="w-3.5 h-3.5" />
            Transparency
          </div>
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-serif tracking-tight text-slate-900"
            data-testid="trust-vendors-heading"
          >
            Who sees your data, and why.
          </h1>
          <p className="text-base sm:text-lg text-slate-700 mt-6 max-w-3xl leading-relaxed">
            Every third-party service that touches Crafters Market data is listed here — what
            it does, what data it receives, and why we send it. This page reads from the same
            source as Privacy Policy §4a, so the two can never drift.
          </p>
          <p className="text-sm text-slate-500 mt-4">
            Version 1.0 · Last updated 2026-06-30 · {VENDORS.length} vendors ·{" "}
            <Link to="/policies/privacy" className="underline underline-offset-4 hover:text-slate-800">
              Read the full Privacy Policy
            </Link>
          </p>
        </header>

        {/* Search + filter */}
        <div className="mb-8 space-y-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              placeholder="Search vendors, categories, purposes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              data-testid="trust-vendors-search"
              aria-label="Search vendors"
            />
          </div>

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by category">
            <button
              type="button"
              onClick={() => setActiveCategory("all")}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                activeCategory === "all"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
              }`}
              data-testid="trust-vendors-filter-all"
            >
              All <span className="opacity-70">· {categoryCounts.all}</span>
            </button>
            {VENDOR_CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setActiveCategory(cat.key)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  activeCategory === cat.key
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                }`}
                data-testid={`trust-vendors-filter-${cat.key}`}
              >
                {cat.label}{" "}
                <span className="opacity-70">· {categoryCounts[cat.key] || 0}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        {filtered.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
            data-testid="trust-vendors-empty"
          >
            <p className="text-slate-600">
              No vendors match{" "}
              <span className="font-mono text-slate-900">&ldquo;{query}&rdquo;</span>
              {activeCategory !== "all" && (
                <>
                  {" "}in{" "}
                  <span className="font-mono text-slate-900">
                    {VENDOR_CATEGORIES.find((c) => c.key === activeCategory)?.label}
                  </span>
                </>
              )}
              .
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setActiveCategory("all");
              }}
              className="mt-3 text-sm underline underline-offset-4 text-slate-900"
              data-testid="trust-vendors-reset"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5" data-testid="trust-vendors-grid">
            {filtered.map((vendor) => (
              <VendorCard key={vendor.id} vendor={vendor} />
            ))}
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-slate-200 text-sm text-slate-600 leading-relaxed">
          <p>
            Each vendor listed above has its own privacy policy that governs its own
            processing. When we add, remove, or replace a vendor in a way that materially
            changes what information is shared, we update this list and, where required by
            law, notify affected users. See{" "}
            <Link to="/policies/privacy" className="underline underline-offset-4 hover:text-slate-900">
              Privacy Policy §4a
            </Link>{" "}
            for the authoritative legal text.
          </p>
        </footer>
      </div>
    </div>
  );
}
