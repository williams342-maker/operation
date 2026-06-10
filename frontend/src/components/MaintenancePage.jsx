import React from "react";
import { Link } from "react-router-dom";

export default function MaintenancePage({ message }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-20 grain bg-paper"
      data-testid="maintenance-page"
    >
      <div className="max-w-2xl w-full text-center space-y-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
          ◆ Workshop · Closed for Maintenance
        </div>
        <h1 className="font-display text-[64px] md:text-[120px] leading-[0.9] uppercase">
          We'll be<br />
          <span className="text-outline-orange">right back.</span>
        </h1>
        <p className="font-mono text-base text-ink-muted max-w-lg mx-auto leading-relaxed">
          {message ||
            "We're making the workshop better. We'll be back shortly."}
        </p>
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="mailto:team@craftersmarket.org"
            className="btn-industrial border border-line hover:border-brand inline-flex"
            data-testid="maintenance-contact-link"
          >
            team@craftersmarket.org
          </a>
          <Link
            to="/admin/login"
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition"
            data-testid="maintenance-admin-link"
          >
            Admin sign-in →
          </Link>
        </div>
      </div>
    </div>
  );
}
