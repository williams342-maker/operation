// ============================================================
//  Shared Terminology Glossary — Crafters Market Policy Suite
//  Version 1.0 · 2026-06-30
//
//  Every marketplace policy uses these terms consistently.
//  Deviations should be intentional and defined in the specific
//  policy that uses them. This file is the single source of truth.
// ============================================================

export const GLOSSARY = [
  {
    term: "Maker",
    definition:
      "An independent creator who lists items on Crafters Market. A Maker is the seller of record for their own Orders. Preferred over 'vendor,' 'merchant,' 'seller,' or 'creator.'",
  },
  {
    term: "Buyer",
    definition:
      "A person who purchases (or attempts to purchase) an item on Crafters Market. Buyers contract directly with the Maker for each Order.",
  },
  {
    term: "Platform",
    definition:
      "Crafters Market, the curated multi-vendor marketplace operated by Crafters Market. Includes the website, apps, APIs, and connected surfaces (Google Merchant, Meta, Pinterest, TikTok, etc.).",
  },
  {
    term: "Listing",
    definition:
      "A published item offered for sale by a Maker on the Platform, including its title, description, photos, price, variants, processing time, shipping options, and Shop Policies.",
  },
  {
    term: "Order",
    definition:
      "A completed purchase transaction between a Buyer and a Maker, processed through the Platform's checkout and payment systems.",
  },
  {
    term: "Shop Policies",
    definition:
      "A Maker's own published policies for their Listings (returns, exchanges, cancellations, processing times, custom orders, digital downloads). Sit below the marketplace policies in the hierarchy.",
  },
  {
    term: "User Content",
    definition:
      "Any content uploaded, posted, or transmitted through the Platform by a Maker or Buyer, including Listing photos, descriptions, journal posts, messages, reviews, and community showcase submissions.",
  },
  {
    term: "Digital Product",
    definition:
      "A Listing delivered electronically (e.g., SVG files, patterns, PDFs, digital downloads) rather than physically shipped.",
  },
  {
    term: "Custom Order",
    definition:
      "A Listing customized to a Buyer's specifications after purchase (personalization, sizing, materials, dedications, made-to-order work).",
  },
  {
    term: "Marketplace Assistance",
    definition:
      "The Platform's role in mediating a dispute between a Buyer and a Maker under the Buyer Protection Policy, including issuing marketplace-funded refunds where appropriate.",
  },
  {
    term: "Verified Maker",
    definition:
      "A Maker who has completed identity verification, Stripe onboarding, and passed the Platform's Seller Verification process.",
  },
  {
    term: "Founding Access / Founding Seller",
    definition:
      "Version 1 of Crafters Market. Founding participants receive early-adopter benefits described on the site.",
  },
];

export function glossaryLookup(term) {
  const t = String(term || "").trim().toLowerCase();
  return GLOSSARY.find((g) => g.term.toLowerCase() === t) || null;
}
