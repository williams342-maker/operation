import React from "react";
import {
  fetchMakerThreads, fetchMakerThread, replyMakerThread,
  patchMakerThread, bulkPatchMakerThreads, emptyMakerTrash,
} from "../../lib/api";
import MessageCenter from "../../components/MessageCenter";

/**
 * Maker Shop Manager → Messages tab.
 *
 * Thin wrapper around the shared MessageCenter component. All UI lives
 * in `<MessageCenter>` so the same code powers the buyer-side mailbox
 * with no branching. Only role-specific concerns (which API client
 * functions to call, what to label the counterpart) live here.
 */
export default function MessagesTab() {
  return (
    <div className="space-y-4" data-testid="messages-tab">
      <header>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
          ◆ Messages
        </div>
        <h2 className="font-display text-2xl uppercase">Inbox</h2>
        <p className="font-mono text-[11px] text-[#a3a3a3] mt-1">
          Buyer enquiries, custom-order discussions, and order help requests.
        </p>
      </header>
      <MessageCenter
        role="maker"
        fetchThreads={fetchMakerThreads}
        fetchThread={fetchMakerThread}
        patchThread={patchMakerThread}
        bulkPatch={bulkPatchMakerThreads}
        replyThread={replyMakerThread}
        emptyTrash={emptyMakerTrash}
        counterpartLabel="Buyer"
      />
    </div>
  );
}
