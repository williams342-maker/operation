# Loretta Production Verification Checklist (P1)

**Goal:** One complete production validation with our founding seller before
expanding feature work. Covers the 6 areas user-requested + the new Listing
Video Phase 1 (iter413cx).

**How to use:**
1. Run the automated preflight first (`pytest tests/test_loretta_production_preflight.py -v --base-url=https://craftersmarket.org`). All checks must be green before scheduling Loretta's time.
2. Walk through this checklist with Loretta on a screenshare on **craftersmarket.org** (NOT the preview env).
3. Tick each row. Capture findings in the "Notes" column.
4. Anything that fails → file as an `ai_diagnosed_bug` via the Help widget's Report Issue flow (the report lands in `db.contact_messages` with `kind="ai_diagnosed_bug"` and surfaces on the Operations Dashboard automatically).

---

## ✓ Item 1 — Fiber & Textile techniques

| # | Test | Expected | Notes |
| --- | --- | --- | --- |
| 1.1 | In the Listing Editor, set Category = "Fiber & Textiles". | The Technique dropdown shows category-aware options including **Sewing** (added in iter413co), embroidery, weaving, etc. | |
| 1.2 | Try to type a freeform technique that's NOT in the list. | The editor allows "Other" as the fallback option. No CNC-only options leak into Fiber & Textiles. | |
| 1.3 | Save a Fiber & Textile listing with technique = Sewing. | Listing saves, surfaces on `/shop?category=fiber-textiles`, technique label renders on PDP. | |

## ✓ Item 2 — Existing CNC URLs (regression)

| # | Test | Expected | Notes |
| --- | --- | --- | --- |
| 2.1 | Visit Loretta's existing CNC listings (her catalogue). | All URLs resolve 200 OK. No technique field shows blank/`null`. | |
| 2.2 | Open one in the editor. | Original technique value preserved (no "Custom" → silent corruption). | |
| 2.3 | Spot-check 3 random CNC listings. | Cover photo, gallery, price, tax, shipping all render correctly. | |

## ✓ Item 3 — Product Guide logic

| # | Test | Expected | Notes |
| --- | --- | --- | --- |
| 3.1 | Open a Fiber & Textile listing in the editor. | Only relevant product guides surface (no Outdoor Mounting guide leaking in — that bug was the iter413cp fix). | |
| 3.2 | Open a CNC mounted-sign listing. | Outdoor Mounting guide renders (it should — that's the legitimate use case). | |
| 3.3 | Open a Pottery listing. | No Outdoor Mounting / no CNC-only guides leak in. | |

## ✓ Item 4 — Listing Video upload (iter413cx · NEW)

| # | Test | Expected | Notes |
| --- | --- | --- | --- |
| 4.1 | Open the editor → Media → Product Video section. | New "Product Video (optional · 1 max)" subsection visible with copy mentioning 60s & 100 MB. Empty-state drop zone shown. | |
| 4.2 | Try to upload a 65-second MP4 (over the cap). | Server returns `video_too_long` with the actual duration. Inline error in the editor. | |
| 4.3 | Try to upload a 120 MB MP4 (over the size cap). | Inline error before the network call: "Video must be 100 MB or smaller." | |
| 4.4 | Try to upload an MP3 (wrong MIME). | Inline error: "Video must be MP4 or MOV." | |
| 4.5 | Upload a valid 30s MP4 ≤ 100 MB. | Progress shows "Uploading…" → "Processing…" → preview appears with native `<video controls>` + duration/size badge. | |
| 4.6 | Click Replace. | File picker reopens, second upload replaces the first cleanly. | |
| 4.7 | Click Remove. | Preview clears, empty state returns. | |
| 4.8 | Save the listing. | `listing_video` persists to Mongo (or unsets if removed). | |

## ✓ Item 5 — PDP video render

| # | Test | Expected | Notes |
| --- | --- | --- | --- |
| 5.1 | Visit the PDP of a listing with a video. | A new thumbnail with ▶ overlay appears in the gallery strip. | |
| 5.2 | Click the video thumb. | Hero swaps to a native HTML5 video player with controls, listing cover as poster, no autoplay, muted until interact. | |
| 5.3 | On mobile (Safari iOS + Chrome Android), test the video thumb. | Same UX: native controls, plays inline, no fullscreen forced. | |
| 5.4 | Visit a PDP **without** a video. | Photo strip unchanged. No `product-video-thumb` in the DOM. | |

## ✓ Item 6 — Technique SEO

| # | Test | Expected | Notes |
| --- | --- | --- | --- |
| 6.1 | View source of a Fiber & Textile listing PDP. | `<meta name="description">` contains the technique. | |
| 6.2 | Open the PDP in a logged-out incognito window. | Schema.org `Product` JSON-LD includes `material` and `additionalType` derived from the technique. | |
| 6.3 | Run a fresh URL through Google Rich Results test. | Product schema validates (no warnings about missing technique). | |

## ✓ Item 7 — Compass accuracy

| # | Test | Expected | Notes |
| --- | --- | --- | --- |
| 7.1 | Click "Ask Compass" or the floating Compass button. | Widget opens. Header shows ◈ COMPASS / YOUR MARKETPLACE ASSISTANT. Welcome message starts "Hi! I'm Compass." | |
| 7.2 | Ask: *"Can I upload a video to my listing?"* | Compass answers **YES** with the 60s + 100 MB + MP4/MOV constraints (NOT "not supported yet"). | |
| 7.3 | Ask: *"What techniques can I use for fiber arts?"* | Compass lists Fiber & Textile techniques INCLUDING Sewing. | |
| 7.4 | Ask: *"The checkout button doesn't work."* | Compass acknowledges, gives a quick diagnosis, AND surfaces the "Report Issue" CTA. | |
| 7.5 | Click Report Issue with a real description. | Modal opens with page URL + role pre-filled. Submission lands in the admin Contact Inbox tagged `ai_diagnosed_bug`. Operations Dashboard's "AI-diagnosed issues" card shows it within 60s. | |

---

## Sign-off

| | Name | Date | Pass/Fail |
| --- | --- | --- | --- |
| Founding seller | Loretta Alvarado | | |
| Engineering | Williams (Crafters Market) | | |

When all 7 items pass, comment **VERIFIED iter413cy** on this doc and proceed to P2 (Listing Quality Score).
