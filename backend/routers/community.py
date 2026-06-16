"""Community routers — thin barrel.

The original ~2000-line module was split into four domain files in Feb 2026:
  • community_auth.py     — Google + magic-link sign-in, EUA, /me, avatar
  • community_showcase.py — showcase CRUD, analytics, AI describe, uploads
  • community_files.py    — design files: upload, variants, conversions, paywall, reports
  • community_forum.py    — forum: threads, replies, attachments
  • community_common.py   — shared bits (EUA version, ban check)

Live chat (WebSocket + history + presence) lives in `community_chat.py`.
Per-channel chat moderation (admin) lives in `chat_mod.py`.

This file keeps a single combined `router` so server.py is untouched, and
re-exports every name external callers (tests, other modules) depend on.
"""
from fastapi import APIRouter

# Sub-routers — each declares its own APIRouter and endpoints.
from . import community_auth as _auth
from . import community_files as _files
from . import community_forum as _forum
from . import community_showcase as _showcase

# Combined router for server.py.
router = APIRouter()
router.include_router(_auth.router)
router.include_router(_showcase.router)
router.include_router(_files.router)
router.include_router(_forum.router)

# ── Re-exports for legacy `from routers.community import X` callers ──
# Test files and a handful of other routers import functions, models, or
# constants directly from this module. Keep them aliased here so the
# refactor doesn't ripple outward.
#
# When patching with `unittest.mock.patch("routers.community.X")`, prefer
# patching the *defining* module instead (e.g. `routers.community_auth.X`).
# Attribute access through this barrel works for reads, but patch() needs
# the canonical home of the attribute to flow into the actual handlers.

# auth
from .community_auth import (  # noqa: F401  (re-exports)
    GoogleSessionRequest, MagicRequest, MagicVerifyRequest,
    community_auth_google, community_auth_magic_request,
    community_auth_magic_verify, community_eua, community_me,
    upload_avatar,
    _require_eua, _upsert_buyer,
)

# common
from .community_common import (  # noqa: F401
    CURRENT_EUA_VERSION, _ensure_user_can_post,
)

# showcase
from .community_showcase import (  # noqa: F401
    ShowcaseEdit, ShowcasePost, _ShowcaseAiBody, _ShowcaseEventBody,
    SHOWCASE_ALLOWED_IMG_EXT, SHOWCASE_ALLOWED_VIDEO_EXT,
    SHOWCASE_ALLOWED_VIDEO_MIME, SHOWCASE_AI_VISION_MAX_BYTES,
    SHOWCASE_AI_VISION_MAX_IMAGES, SHOWCASE_MAX_IMAGE_BYTES,
    SHOWCASE_MAX_VIDEO_BYTES,
    admin_approve_showcase, admin_delete_showcase, admin_edit_showcase,
    admin_list_showcase, admin_showcase_analytics,
    ai_describe_showcase,
    create_showcase, delete_showcase, edit_showcase, like_showcase,
    list_recent_showcase, list_showcase,
    list_showcase_report_reasons, report_showcase, SHOWCASE_REPORT_REASONS,
    record_showcase_click,
    upload_showcase_image, upload_showcase_video,
    _claude_vision_describe, _fetch_image_for_vision,
    _is_showcase_owner, _record_showcase_event, _showcase_owner_id,
)

# files
from .community_files import (  # noqa: F401
    DesignFileEdit, DesignFileMeta, FileReportRequest,
    DOWNLOAD_FREE_LIMIT, DOWNLOAD_WINDOW_DAYS, PAID_UNLOCK_AMOUNT,
    PROD_2D, PROD_3D, PROD_ALL, PROD_CNC, REPORT_REASONS,
    add_design_file_variants, convert_dxf_to_svg,
    delete_design_file_variant, download_design_file,
    files_leaderboard, files_trending, list_design_files,
    render_stl_thumbnail, report_design_file,
    unlock_checkout, update_design_file,
    upload_design_file, upload_design_file_direct,
    _compute_quality_score, _is_design_file_owner,
    _resolve_poster_email, _with_quality,
    grant_weekly_boost_credit,
)

# forum
from .community_forum import (  # noqa: F401
    ForumAttachment, ForumReplyCreate, ForumThreadCreate,
    FORUM_ALLOWED_DOC, FORUM_ALLOWED_EXT, FORUM_ALLOWED_IMAGE,
    FORUM_CATEGORIES, FORUM_CATEGORY_IDS,
    FORUM_MAX_DOC_BYTES, FORUM_MAX_IMAGE_BYTES,
    create_thread, get_thread, list_forum_categories,
    list_threads, reply_thread, trending_threads,
    upload_forum_attachment, _veil_if_removed,
)
