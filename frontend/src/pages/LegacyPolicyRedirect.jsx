import { useRef } from "react";
import { Navigate } from "react-router-dom";

/**
 * LegacyPolicyRedirect
 *
 * Handles inbound traffic to the legacy `/policy` and `/policy#<anchor>`
 * URLs (used before we split policies into `/policies/<slug>` pages).
 *
 * The hash fragment never reaches the server, so this component runs
 * client-side, reads `window.location.hash` at the first render, maps
 * it to the canonical `/policies/<slug>` page, and issues a declarative
 * <Navigate> redirect. Unknown hashes fall through to the `/policies`
 * index.
 *
 * The hash is captured with a ref at first render so that React 18's
 * StrictMode double-invocation cannot corrupt the mapping (by the time
 * the effect might re-run, the browser hash is already empty).
 *
 * This component owns no policy content; it is a routing artifact
 * introduced to keep external referrers and Google OAuth verification
 * (which still lists `https://craftersmarket.org/policy#privacy`)
 * from landing on a stale page.
 */
const LEGACY_HASH_TO_SLUG = {
  // Direct policy anchors
  "privacy":              "privacy",
  "cookies":              "cookies",
  "terms":                "terms",
  "shipping":             "shipping",
  "returns":              "returns",
  "buyer-protection":     "buyer-protection",
  "fee-pricing":          "fee-pricing",
  "maker-agreement":      "maker-agreement",
  "community-guidelines": "community-guidelines",
  "accessibility":        "accessibility",
  "marketplace-promise":  "marketplace-promise",

  // Renamed / consolidated anchors
  "marketplace":          "fee-pricing",       // marketplace-fee section merged into fee-pricing
  "prohibited":           "prohibited-items",
  "ip":                   "ip-dmca",
  "privacy-at-a-glance":  "privacy-at-a-glance",
  "seller-misconduct":    "community-guidelines",
  "buyer-misconduct":     "community-guidelines",

  // ToS subsection anchors that used to live on the combined /policy page
  "custom":               "terms",
  "fulfillment":          "terms",
  "payment":              "terms",
};

function resolveLegacyTarget() {
  if (typeof window === "undefined") return "/policies";
  const raw = (window.location.hash || "").replace(/^#/, "").toLowerCase();
  const slug = LEGACY_HASH_TO_SLUG[raw];
  return slug ? `/policies/${slug}` : "/policies";
}

export default function LegacyPolicyRedirect() {
  // Capture the target on first render so React 18 StrictMode's
  // double-invocation cannot re-evaluate the (now-empty) hash.
  const targetRef = useRef(resolveLegacyTarget());
  return <Navigate to={targetRef.current} replace />;
}
