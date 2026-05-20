import React from "react";
import { Headphones } from "lucide-react";

/**
 * PlusSlaBadge
 * -------------
 * Renders the "24h support SLA" trust pill on a Plus subscriber's
 * public shop page. Tells buyers that this seller has direct support
 * from the CraftersMarket team — a meaningful signal on high-ticket
 * custom orders where buyers want reassurance someone will pick up
 * the phone if something goes wrong.
 *
 * Visibility is purely cosmetic; the actual 24h SLA is enforced by
 * the maker_inbox notification system + admin escalation paths,
 * which are unchanged by rendering this badge.
 */
export default function PlusSlaBadge({ testId = "plus-sla-badge", className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border border-[#60a5fa]/50 bg-[#60a5fa]/10 text-[#7dd3fc] px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] font-mono ${className}`}
      data-testid={testId}
      title="Plus subscriber — 24-hour support response SLA backed by the CraftersMarket team"
    >
      <Headphones size={10} className="text-[#7dd3fc]" />
      <span>24h Support · Plus</span>
    </span>
  );
}
