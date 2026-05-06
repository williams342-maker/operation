import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchBuyerThreads, fetchBuyerThread, replyBuyerThread,
  patchBuyerThread, bulkPatchBuyerThreads, emptyBuyerTrash,
} from "../lib/api";
import { useStructuredData } from "../lib/seo";
import MessageCenter from "../components/MessageCenter";

/**
 * Buyer-side DM inbox at `/messages`.
 *
 * Thin wrapper around <MessageCenter> — same UI as the Maker dashboard
 * Messages tab, just with buyer-scoped API calls and the counterpart
 * labelled as "Maker".
 *
 * Requires a community-user JWT; redirects to /community/login if missing.
 */
export default function BuyerMessagesPage() {
  const navigate = useNavigate();

  useStructuredData({
    title: "Messages · Crafters Market",
    description: "Direct conversations with makers on Crafters Market.",
    url: `${window.location.origin}/messages`,
    jsonLd: null,
  });

  useEffect(() => {
    if (!localStorage.getItem("cm_buyer_jwt")) {
      navigate("/community/login?next=/messages", { replace: true });
    }
  }, [navigate]);

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="buyer-messages-page">
      <div className="w-full max-w-[1500px] mx-auto px-4 md:px-8">
        <header className="mb-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
            ◆ Messages
          </div>
          <h1 className="font-display text-4xl md:text-5xl uppercase">Inbox</h1>
          <p className="font-mono text-[11px] text-[#a3a3a3] mt-1">
            Conversations with the makers behind your orders + custom requests.
          </p>
        </header>
        <MessageCenter
          role="buyer"
          fetchThreads={fetchBuyerThreads}
          fetchThread={fetchBuyerThread}
          patchThread={patchBuyerThread}
          bulkPatch={bulkPatchBuyerThreads}
          replyThread={replyBuyerThread}
          emptyTrash={emptyBuyerTrash}
          counterpartLabel="Maker"
        />
      </div>
    </div>
  );
}
