// iter413ca — Admin impersonation helpers.
// ──────────────────────────────────────────
// Mirror of the API contract returned by POST /api/admin/impersonate.
// Holds the impersonation JWT in the same localStorage slot the target
// role normally uses (cm_maker_jwt for makers, cm_buyer_jwt for buyers)
// so EVERY downstream API call automatically picks it up. A separate
// `cm_impersonating` blob records the meta (display name, target sub,
// who's impersonating, ms-epoch expiry) so the in-app banner can
// render and the admin can cleanly exit back to their own session.

const IMP_KEY = "cm_impersonating";

export function startImpersonation({ target_type, target_sub, target_email, target_name, token, imp_by, expires_in_seconds }) {
  const expires_at = Date.now() + (expires_in_seconds || 7200) * 1000;
  const meta = { target_type, target_sub, target_email, target_name, imp_by, expires_at };
  try {
    localStorage.setItem(IMP_KEY, JSON.stringify(meta));
    if (target_type === "maker") {
      localStorage.setItem("cm_maker_jwt", token);
      localStorage.setItem("cm_maker_slug", target_sub);
      // Mirror MakerVerify behavior: drop any explicit expiry stamp so
      // the session is treated as persistent for the impersonation window.
      localStorage.removeItem("cm_maker_jwt_exp");
    } else if (target_type === "buyer") {
      localStorage.setItem("cm_buyer_jwt", token);
    }
  } catch {
    // private mode / quota — silent. Caller will see no new tab launch.
  }
  return meta;
}

export function readImpersonation() {
  try {
    const raw = localStorage.getItem(IMP_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw);
    if (meta?.expires_at && Date.now() > meta.expires_at) {
      // Auto-clear expired impersonation so the banner doesn't linger.
      stopImpersonation();
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

export function stopImpersonation() {
  let meta = null;
  try { meta = JSON.parse(localStorage.getItem(IMP_KEY) || "null"); } catch { /* ignore parse error */ }
  try {
    localStorage.removeItem(IMP_KEY);
    if (meta?.target_type === "maker") {
      localStorage.removeItem("cm_maker_jwt");
      localStorage.removeItem("cm_maker_slug");
      localStorage.removeItem("cm_maker_jwt_exp");
    } else if (meta?.target_type === "buyer") {
      localStorage.removeItem("cm_buyer_jwt");
    }
  } catch { /* private mode — silent */ }
  return meta;
}

export function isImpersonating() {
  return !!readImpersonation();
}
