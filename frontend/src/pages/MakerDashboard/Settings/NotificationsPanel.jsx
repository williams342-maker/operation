import React, { useEffect, useState } from "react";
import { Bell, Users, Globe, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  fetchMakerPushStats, setMakerPushOnShipOptout,
  fetchPricingDigestPreference, setPricingDigestPreference,
} from "../../../lib/api";

/**
 * Settings → Notifications panel.
 *
 * Surfaces transparent stats so makers know exactly how many of their
 * past customers will receive a Web Push notification when an order
 * ships or gets delivered, plus a single toggle to suppress the
 * shipped-push if the maker prefers email-only.
 *
 * Web Push replaced the deferred Twilio SMS nudge — see CHANGELOG
 * 2026-05-06 "SMS deferred → Buyer Web Push as the delivery nudge".
 */
export default function NotificationsPanel() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  // iter334f — Weekly AI pricing digest opt-out.
  const [pricingOptOut, setPricingOptOut] = useState(null);  // null = loading
  const [pricingBusy, setPricingBusy] = useState(false);

  const refresh = () =>
    fetchMakerPushStats()
      .then(setData)
      .catch(() => setData({ error: true }));

  useEffect(() => { refresh(); }, []);

  // Load pricing digest preference once on mount.
  useEffect(() => {
    fetchPricingDigestPreference()
      .then((r) => setPricingOptOut(!!r.opt_out))
      .catch(() => setPricingOptOut(false));
  }, []);

  const toggle = async (next) => {
    setBusy(true);
    try {
      await setMakerPushOnShipOptout(next);
      toast.success(
        next
          ? "Buyer push on shipment turned OFF — buyers still get the email."
          : "Buyer push on shipment turned ON — buyers get a real-time browser notification.",
      );
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed.");
    } finally { setBusy(false); }
  };

  const togglePricingDigest = async (nextOptOut) => {
    setPricingBusy(true);
    try {
      await setPricingDigestPreference(nextOptOut);
      setPricingOptOut(nextOptOut);
      toast.success(
        nextOptOut
          ? "Weekly pricing digest turned OFF — you won't get the Monday email."
          : "Weekly pricing digest turned ON — you'll get a Monday email when listings drift 20%+ above market.",
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed.");
    } finally { setPricingBusy(false); }
  };

  if (!data) {
    return <p className="font-mono text-xs text-[#525252] py-6">Loading notification stats…</p>;
  }
  if (data.error) {
    return <p className="font-mono text-xs text-red-400 py-6">Could not load notification stats. Refresh the page to retry.</p>;
  }

  const reach = data.subscribed_buyers || 0;
  const totalBuyers = data.total_buyers || 0;
  const reachPct = totalBuyers > 0 ? Math.round((reach / totalBuyers) * 100) : 0;

  return (
    <div className="space-y-6" data-testid="settings-notifications">
      {/* Hero — what is this? */}
      <div className="border border-[#262626] bg-[#0d0d0d] p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 border border-[#ff4500] bg-[#1a0a05] flex items-center justify-center shrink-0">
            <Bell size={18} className="text-[#ff4500]" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-2xl md:text-3xl mb-1">Buyer push notifications</h2>
            <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed max-w-2xl">
              When you mark an order shipped, we send a real-time browser push
              notification to the buyer (in addition to the standard email).
              When the package is delivered, a second push fires with a quick
              review prompt. Free, instant, and zero carrier paperwork — this
              replaced our planned SMS integration.
            </p>
          </div>
        </div>
      </div>

      {/* Reach stats */}
      <div className="grid sm:grid-cols-3 gap-4" data-testid="settings-push-stats">
        <Stat
          icon={Users}
          label="Your buyers reached"
          value={reach}
          sub={
            totalBuyers > 0
              ? `${reachPct}% of your ${totalBuyers} past customers`
              : "no past customers yet"
          }
          tone="orange"
          testId="push-stat-mine"
        />
        <Stat
          icon={Globe}
          label="Marketplace-wide"
          value={data.marketplace_buyer_subs || 0}
          sub="total buyers subscribed"
          testId="push-stat-marketplace"
        />
        <Stat
          icon={Bell}
          label="Push system"
          value={data.vapid_configured ? "Live" : "Off"}
          sub={data.vapid_configured ? "VAPID keys configured" : "VAPID keys missing — contact ops"}
          tone={data.vapid_configured ? "emerald" : "red"}
          testId="push-stat-system"
        />
      </div>

      {/* Toggle: auto-fire on shipment */}
      <div className="border border-[#262626] bg-[#0d0d0d]">
        <label
          htmlFor="push-on-ship-toggle"
          className="flex items-start gap-4 p-5 cursor-pointer"
        >
          <input
            id="push-on-ship-toggle"
            type="checkbox"
            // The DB stores the *opt-out*; surface as inverted "auto-send is ON"
            checked={!data.push_on_ship_optout}
            disabled={busy}
            onChange={(e) => toggle(!e.target.checked)}
            className="mt-1 w-5 h-5 accent-[#ff4500] cursor-pointer"
            data-testid="push-on-ship-toggle"
          />
          <div className="min-w-0">
            <div className="font-mono text-sm text-[#e5e5e5] mb-1">
              Auto-send a buyer push when I mark an order shipped
            </div>
            <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
              Default ON. The push includes the item title, carrier, and a deep-link
              to the buyer's order page. Turn this OFF if you'd rather the buyer
              hear from email only — the delivered-confirmation push always fires
              regardless of this setting.
            </p>
          </div>
        </label>
      </div>

      {/* iter334f — Weekly AI pricing digest opt-out. Sits next to the
          push toggle because it's the same shape of decision (an
          outgoing email I might or might not want every Monday). */}
      <div className="border border-[#262626] bg-[#0d0d0d]" data-testid="pricing-digest-card">
        <label
          htmlFor="pricing-digest-toggle"
          className="flex items-start gap-4 p-5 cursor-pointer"
        >
          <input
            id="pricing-digest-toggle"
            type="checkbox"
            // DB stores the opt-out; surface as inverted "digest is ON"
            checked={pricingOptOut === null ? false : !pricingOptOut}
            disabled={pricingBusy || pricingOptOut === null}
            onChange={(e) => togglePricingDigest(!e.target.checked)}
            className="mt-1 w-5 h-5 accent-[#ff4500] cursor-pointer"
            data-testid="pricing-digest-toggle"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={12} className="text-cyan-400" />
              <div className="font-mono text-sm text-[#e5e5e5]">
                Weekly AI pricing digest
              </div>
            </div>
            <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
              When ON, you get a single Monday morning email any week where one
              or more of your listings is priced <strong className="text-[#ff4500]">20%+
              above the AI-derived market median</strong> (from the ◆ AI Price
              Check tool in the listing editor). Skipped automatically when
              nothing is flagged. Default ON.
            </p>
          </div>
        </label>
      </div>

      {/* How buyers subscribe */}
      <div className="border border-dashed border-[#262626] p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#ff4500] mb-2">
          ◆ How buyers subscribe
        </div>
        <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
          Buyers see a small "Enable order updates" prompt the first time they
          land on the site after a purchase. They tap allow, and from then on
          every shipped + delivered notification reaches them within seconds —
          on desktop, Android, and the installed PWA. iOS support requires the
          buyer to install the PWA from Safari first.
        </p>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, tone, testId }) {
  const accent = tone === "emerald"
    ? "text-emerald-300"
    : tone === "red"
      ? "text-red-300"
      : tone === "orange"
        ? "text-[#ff4500]"
        : "text-[#e5e5e5]";
  return (
    <div className="border border-[#262626] bg-[#0d0d0d] p-5" data-testid={testId}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={12} className="text-[#a3a3a3]" />
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          {label}
        </div>
      </div>
      <div className={`font-display text-3xl md:text-4xl leading-none ${accent}`}>{value}</div>
      <div className="font-mono text-[10px] text-[#525252] mt-2">{sub}</div>
    </div>
  );
}
