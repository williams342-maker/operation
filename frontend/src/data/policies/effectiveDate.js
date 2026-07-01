// ============================================================
//  Effective Date — single source of truth for the Trust &
//  Policy Center. All 13 policies read from this file.
//
//  Deployment hook (Priority 2 · iter413ef):
//    Set REACT_APP_POLICY_EFFECTIVE_DATE=YYYY-MM-DD at build time
//    (either in frontend/.env for local, or via the deployment
//    platform environment variables) and every policy — cover
//    sheet, /policies index, /policies/:slug, counsel packet,
//    and the printable PDF — will show the substituted date.
//
//    If the env variable is not set, the parked label
//    "On production launch (date set at go-live)" is displayed.
//    This prevents pre-baked calendar dates from leaking to
//    counsel or production if the deploy step is skipped.
//
//  Format: YYYY-MM-DD (ISO 8601, no timezone).
// ============================================================

const RAW = (process.env.REACT_APP_POLICY_EFFECTIVE_DATE || "").trim();
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const POLICY_EFFECTIVE_DATE_ISO = ISO.test(RAW) ? RAW : null;

export const POLICY_EFFECTIVE_DATE = POLICY_EFFECTIVE_DATE_ISO
  ? POLICY_EFFECTIVE_DATE_ISO
  : "On production launch (date set at go-live)";

export const POLICY_EFFECTIVE_DATE_IS_PARKED = !POLICY_EFFECTIVE_DATE_ISO;
