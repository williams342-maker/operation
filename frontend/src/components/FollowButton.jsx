import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { fetchFollowStatus, followMaker, unfollowMaker } from "../lib/api";

const COMMUNITY_JWT_KEY = "cm_buyer_jwt";

/**
 * FollowButton — sits on /makers/:slug. Shows live follower count and
 * toggles follow state via the community-auth'd buyer JWT. Unauthed
 * visitors see a "Sign in to follow" button that redirects to /community/login.
 */
export default function FollowButton({ makerSlug, makerName }) {
  const [status, setStatus] = useState({ is_following: false, follower_count: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const jwt = typeof window !== "undefined" ? localStorage.getItem(COMMUNITY_JWT_KEY) : null;

  const refresh = async () => {
    try {
      const s = await fetchFollowStatus(makerSlug, jwt);
      setStatus(s);
    } catch {
      // best-effort; keep previous status
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!makerSlug) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [makerSlug]);

  const onClick = async () => {
    if (!jwt) {
      // redirect after auth back to this page so the button toggles inline.
      const back = encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/");
      window.location.href = `/community/login?next=${back}`;
      return;
    }
    setBusy(true);
    try {
      const next = status.is_following
        ? await unfollowMaker(makerSlug, jwt)
        : await followMaker(makerSlug, jwt);
      setStatus(next);
      toast.success(
        next.is_following
          ? `Following ${makerName}. You'll get an email when they post.`
          : `Unfollowed ${makerName}.`,
      );
    } catch (e) {
      const msg = e?.response?.data?.detail || "Couldn't update follow status.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div
        className="inline-flex items-center px-4 py-2 border border-line font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted"
        data-testid="follow-button-loading"
      >
        ◆ Loading…
      </div>
    );
  }

  const isFollowing = !!jwt && status.is_following;
  return (
    <div className="inline-flex items-stretch border border-line" data-testid="follow-cluster">
      <button
        onClick={onClick}
        disabled={busy}
        className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50 ${
          isFollowing
            ? "bg-paper text-brand hover:bg-brand/10"
            : "bg-brand text-[#0a0a0a] hover:bg-brand-hover"
        }`}
        data-testid={isFollowing ? "follow-btn-following" : "follow-btn-follow"}
      >
        {busy ? "…" : isFollowing ? "✓ Following" : jwt ? "+ Follow" : "+ Sign in to follow"}
      </button>
      <Link
        to={`/makers/${makerSlug}#followers`}
        className="px-4 py-2 border-l border-line font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink"
        data-testid="follow-count"
        title="Followers"
      >
        {status.follower_count} {status.follower_count === 1 ? "follower" : "followers"}
      </Link>
    </div>
  );
}
