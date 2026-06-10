import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Required-consent checkbox stamped on every order acceptance flow.
 * Returns the latest server-known policy version so the parent can ship
 * `{ policy_accepted: true, policy_version }` with their submit payload.
 *
 * Use:
 *   const consent = usePolicyConsent();
 *   <PolicyConsent consent={consent} testId="cart-policy" />
 *   ...
 *   if (!consent.accepted) toast.error("Accept policies to continue.");
 *   submit({ ...payload, policy_accepted: true, policy_version: consent.version })
 */
export function usePolicyConsent() {
  const [accepted, setAccepted] = useState(false);
  const [version, setVersion] = useState("2026.04");
  useEffect(() => {
    axios
      .get(`${API}/policy/version`)
      .then((r) => r.data?.version && setVersion(r.data.version))
      .catch(() => {});
  }, []);
  return { accepted, setAccepted, version };
}

export default function PolicyConsent({
  consent, testId = "policy-consent", required = true,
}) {
  return (
    <label
      className="flex gap-3 items-start cursor-pointer select-none border border-line bg-[#0f0f0f] p-4 hover:border-[#525252] transition"
      data-testid={testId}
    >
      <input
        type="checkbox"
        checked={consent.accepted}
        onChange={(e) => consent.setAccepted(e.target.checked)}
        required={required}
        className="mt-0.5 w-4 h-4 accent-[#ff4500] flex-shrink-0"
        data-testid={`${testId}-checkbox`}
      />
      <span className="font-mono text-xs text-ink leading-relaxed">
        I agree to the Crafters Market{" "}
        <Link
          to="/policy"
          target="_blank"
          rel="noreferrer"
          className="text-brand hover:underline"
          data-testid={`${testId}-link`}
        >
          Site Policies
        </Link>{" "}
        — including shipping, returns, custom-order non-refund terms, and the
        seller / buyer conduct rules.{" "}
        <span className="block mt-1 text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          ◆ Policy v{consent.version}
        </span>
      </span>
    </label>
  );
}
