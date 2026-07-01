// ============================================================
//  Third-Party Service Providers (Vendor Inventory)
//
//  This is the structured source for the /trust/vendors
//  transparency page and mirrors Privacy Policy §4a.
//
//  When you add, remove, or replace a production vendor,
//  update THIS file AND the §4a bullet list in
//  /app/frontend/src/pages/PolicyPage.jsx.
//
//  Categories are display tags only — a vendor may carry more
//  than one tag if it does multiple jobs.
//
//  Version 1.0 · 2026-06-30 · iter413v4-trust
// ============================================================

export const VENDOR_CATEGORIES = [
  { key: "payments",   label: "Payments" },
  { key: "hosting",    label: "Hosting / CDN" },
  { key: "analytics",  label: "Analytics" },
  { key: "ads",        label: "Advertising" },
  { key: "email",      label: "Email" },
  { key: "shipping",   label: "Shipping" },
  { key: "monitoring", label: "Monitoring" },
  { key: "ai",         label: "AI" },
];

export const VENDORS = [
  {
    id: "stripe",
    name: "Stripe",
    role: "Payments, Stripe Connect, subscriptions",
    categories: ["payments"],
    data_received:
      "Buyer billing information (card metadata, address), Maker identity and banking information for KYC, transaction metadata, dispute and chargeback data.",
    purpose:
      "Process Buyer payments, Maker payouts, Crafters Plus subscription billing, and dispute/chargeback workflows.",
    governing_terms: "Stripe Privacy Policy · Stripe Connected Account Agreement · Stripe Services Agreement",
    website: "https://stripe.com/privacy",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    role: "CDN, DDoS protection, edge security",
    categories: ["hosting"],
    data_received:
      "IP addresses, request metadata, and (where TLS is terminated at the edge) request contents in transit.",
    purpose:
      "Performance, abuse mitigation, DDoS protection. Not used for advertising.",
    governing_terms: "Cloudflare Privacy Policy",
    website: "https://www.cloudflare.com/privacypolicy/",
  },
  {
    id: "ga4",
    name: "Google Analytics 4 (GA4)",
    role: "Product analytics",
    categories: ["analytics"],
    data_received:
      "Pseudonymous identifiers, page-view events, coarse geolocation. Configured with IP anonymization where supported.",
    purpose: "Measure site usage, funnels, and retention.",
    governing_terms: "Google Analytics Terms of Service · Google Privacy Policy",
    website: "https://policies.google.com/privacy",
  },
  {
    id: "google-ads",
    name: "Google Ads",
    role: "Advertising, conversion tracking",
    categories: ["ads"],
    data_received:
      "Hashed identifiers and conversion metadata. No plaintext personal information is transmitted.",
    purpose:
      "Run off-site ad campaigns; import conversion events for attribution.",
    governing_terms: "Google Ads Terms · Google Privacy Policy",
    website: "https://policies.google.com/privacy",
  },
  {
    id: "gsc",
    name: "Google Search Console",
    role: "SEO / indexing telemetry",
    categories: ["analytics"],
    data_received:
      "Aggregated query and click data. Does not receive user personal information.",
    purpose: "Monitor organic-search performance and site health.",
    governing_terms: "Google Privacy Policy",
    website: "https://policies.google.com/privacy",
  },
  {
    id: "meta-ads",
    name: "Meta Ads & Conversions API",
    role: "Advertising on Facebook / Instagram",
    categories: ["ads"],
    data_received:
      "Hashed identifiers and conversion metadata.",
    purpose:
      "Run off-site ad campaigns on Meta surfaces; import conversion events.",
    governing_terms: "Meta Privacy Policy · Meta Business Tools Terms",
    website: "https://www.facebook.com/privacy/policy",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    role: "Advertising and catalog feed (if enabled)",
    categories: ["ads"],
    data_received:
      "Catalog metadata for Maker Listings and hashed identifiers for conversion attribution.",
    purpose: "Product catalog syndication and ads attribution.",
    governing_terms: "Pinterest Privacy Policy · Pinterest Business Terms",
    website: "https://policy.pinterest.com/en/privacy-policy",
  },
  {
    id: "tiktok",
    name: "TikTok",
    role: "Pixel and Events API (if enabled)",
    categories: ["ads"],
    data_received: "Hashed identifiers and conversion events.",
    purpose: "Ads attribution on TikTok surfaces.",
    governing_terms: "TikTok Privacy Policy · TikTok Commercial Terms",
    website: "https://www.tiktok.com/legal/privacy-policy",
  },
  {
    id: "sentry",
    name: "Sentry",
    role: "Error monitoring (if enabled)",
    categories: ["monitoring"],
    data_received:
      "Client and server error stack traces, request metadata, pseudonymous user identifiers.",
    purpose: "Find and fix bugs.",
    governing_terms: "Sentry Privacy Policy",
    website: "https://sentry.io/privacy/",
  },
  {
    id: "mailgun",
    name: "Mailgun",
    role: "Transactional email delivery",
    categories: ["email"],
    data_received: "Recipient email addresses and message content.",
    purpose:
      "Deliver Order confirmations, security notices, dispute updates, payout notifications.",
    governing_terms: "Mailgun Privacy Policy",
    website: "https://www.mailgun.com/privacy-policy/",
  },
  {
    id: "shippo",
    name: "Shippo",
    role: "Shipping-label purchase and rate lookup",
    categories: ["shipping"],
    data_received:
      "Shipping address, package dimensions, payment metadata (when Maker uses on-Platform label purchase).",
    purpose: "Purchase and track shipping labels.",
    governing_terms: "Shippo Privacy Policy",
    website: "https://goshippo.com/policies/privacy/",
  },
  {
    id: "ai-providers",
    name: "AI Service Providers (OpenAI, Anthropic, Google Gemini)",
    role: "Operational AI (search, listing optimization, translation, moderation, ad copy)",
    categories: ["ai"],
    data_received:
      "Prompts and content necessary to perform the specific task. Not sent for AI Model Training under the Creator-Owned AI Policy.",
    purpose:
      "Power search relevance, listing optimization, translations, on-platform moderation, and ad-copy generation.",
    governing_terms:
      "Provider-specific: OpenAI Privacy Policy · Anthropic Privacy Policy · Google AI / Cloud Terms",
    website: "https://openai.com/policies/privacy-policy",
  },
  {
    id: "emergent-key",
    name: "Emergent Universal Key",
    role: "LLM aggregator / key management",
    categories: ["ai"],
    data_received:
      "Server-side only — routes AI requests to the underlying provider without exposing plaintext keys to the Platform runtime.",
    purpose:
      "Aggregate LLM access across providers under a single managed key.",
    governing_terms: "Emergent Terms of Service",
    website: "https://emergent.sh",
  },
];
