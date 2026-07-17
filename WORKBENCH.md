## 2026-07-17 09:20, Claude Code

**Focus:** Ship the content-based grouping work (deploy + push), then a run of storefront/admin additions: category counts, WhatsApp cart total, and Cloudflare Web Analytics wired through to admin.

**Next session, start here:**
- Read: `worker/worker.js` — `processPhotoIntake` (grouping) and `handleGetAnalytics` (views)
- In flight: nothing half-built; everything below is deployed and live
- Single next move: work out why ~52 of the first 65 listings landed in `decor` — check whether the AI intake prompt is over-assigning that category, since it makes the storefront filter near-useless

**What happened:**
- Deployed the Worker and pushed `docs/` — the previous session's grouping/dupe/split work is now live. Confirmed new routes return 401 (not 404) after edge propagation lag.
- Storefront: category dropdown now shows live per-category item counts and hides empty categories; WhatsApp checkout message now includes a `Total (suggested)` line summing the cart (quantities respected), matching the drawer total.
- Admin: added a "N pending" count on the drafts heading.
- Analytics: added the Cloudflare Web Analytics beacon to the storefront (`index.html` only — admin deliberately untracked), created the RUM site, and added an admin-gated `GET /api/admin/analytics` that proxies Cloudflare's GraphQL RUM dataset server-side and renders views for 24h/7d/30d in admin.
- Fixed a latent `$NaN USD` in the cart drawer when a listing lacks a price (guarded with `|| 0`); confirmed all 108 live listings currently have prices, so it was never buyer-facing.

**Decisions:**
- [DECISION] Analytics is proxied through the Worker rather than called from admin.html, because admin is a public static page and the API token would be readable by anyone.
- [DECISION] Used a scoped read-only Cloudflare token (Account Analytics: Read) as `CF_ANALYTICS_TOKEN` rather than reusing the deploy-capable token — verified it can read RUM and is blocked from Workers. `CF_ACCOUNT_ID`/`CF_SITE_TAG` are secrets too, keeping Cloudflare identifiers out of the public repo.
- [DECISION] Declined to mint the API token via browser automation despite an active session — creating credentials in the user's cloud account is his to do.
- [DECISION] Rescan duplicates stays a text/semantic pass, not vision over every image — impractical at catalog scale.

**Still open:**
- `decor` over-assignment (52/65 at the time; Furniture later showed 7, so it may spread as volume grows).
- `/twilio-webhook` has no Twilio signature validation — an open endpoint that triggers paid Anthropic calls; the one real hardening item.
- Admin analytics' authorized path unverified by me (needs the ADMIN_TOKEN); Jordan to confirm the views line renders.
- Repo is public: fine while the sale runs (no secrets committed), but note Pages on the Free plan requires a public repo — going private would take the storefront offline.

**Files touched:** `worker/worker.js`, `docs/index.html`, `docs/admin.html`, `docs/js/app.js`, `docs/js/admin.js`, `docs/css/style.css`, `WORKBENCH.md`, `TODOS.md`, `ARCHITECTURE.md`, `USER_GUIDE.md`

---

## 2026-07-15, Claude Code

**Focus:** Replace time-based photo batching with content-based (AI) same-item grouping; add duplicate-listing detection flagged in admin; add a photo-split tool to fix over-grouped listings.

**Next session, start here:**
- **Not deployed yet.** Run `cd worker && npx wrangler deploy` to make any of this live. Frontend is verified in a local preview; the worker logic is written but untested against the real WhatsApp/Anthropic path.
- Single next move: deploy, then send a burst of photos of *different* items and confirm they land as separate listings (the whole point of this change).
- Then use admin → "Split into separate items" on the stuck 50-photo mega-listing to fan it out.

**What happened:**
- **Grouping is now content-based, not time-based.** Removed `BATCH_WINDOW_MS` (60s window that lumped every burst photo into one listing). New `RECENT_DRAFT_WINDOW_MS` (15min) only bounds which recent draft is the *comparison anchor*. On each incoming photo, if the sender has a recent draft, its first image is sent to the vision model alongside the new photo, and a new `is_same_item_as_reference` boolean on the `create_listing` tool decides: same physical unit → append as another angle; different item → new listing. KV pointer renamed `pending_batch:` → `recent_draft:`.
- Refactored the intake AI call into a reusable `analyzePhoto({ reference })` + `buildListingObject()` so the same drafting path is shared by intake and split.
- **Duplicate detection, two tiers:** (1) automatic at draft creation — `findPossibleDuplicates()` flags same-category listings with ≥60% title-token overlap, stored on `listing.possible_duplicate_of`; the WhatsApp confirmation notes a possible dupe. (2) On-demand `POST /api/admin/rescan-duplicates` — hands the whole catalog (titles/categories) to the model via a `report_duplicate_groups` tool for a semantic pass that catches synonyms/translations, then rewrites every listing's `possible_duplicate_of`. Admin shows a clickable orange "⚠️ Possible duplicate (N)" badge that scrolls to + flashes the match; header has a "Scan for duplicates" button.
- **Photo split:** `POST /api/admin/split-photo {listing_id, image_key}` re-drafts one photo into its own listing (reusing the existing image bytes). Admin "Split into separate items (N)" button on any multi-photo draft loops one request per photo (keeps each call small — avoids Worker subrequest limits on a 50-photo split), then detaches images from the original (`image_keys:[]`) and deletes it so shared bytes survive.

**Decisions:**
- [DECISION] Rescan uses a *text/semantic* pass (titles+categories in one call), not vision over every image — impractical/costly at catalog scale. The cheap token-overlap check runs inline at creation; the AI pass is the "deeper" on-demand option.
- [DECISION] Split is client-orchestrated (one request per photo) rather than one big server request, to stay under Cloudflare per-request subrequest limits for large batches.

**Verified:** Local static preview (`moving-sale-docs`) with injected mock listings — dup badge renders with correct count, split button appears only on multi-photo drafts with correct count, "Scan for duplicates" present, badge-click applies the flash-highlight. `node --check` passes on worker.js and admin.js. Worker path (vision same-item call, rescan, split) NOT yet exercised live — needs deploy.

**Still open:**
- Deploy + real-photo verification of all three features (carried into TODOS).
- Race note: a 50-photo burst hits the webhook near-concurrently, so the "recent draft" anchor each photo compares against can be stale — same-item grouping is best-effort at high burst rates; mis-groups are correctable via Split / manual merge.

**Files touched:** `worker/worker.js`, `docs/js/admin.js`, `docs/admin.html`, `docs/css/style.css`, `WORKBENCH.md`, `TODOS.md`

---

## 2026-07-07 17:28, Claude Code

**Focus:** Storefront image lightbox — click any card image to view it full-screen.

**Next session, start here:**
- Read: `worker/worker.js`'s `processPhotoIntake` for the batching logic
- In flight: multi-photo WhatsApp batching remains deployed but never tested with a real photo burst
- Single next move: send 2-3 photos of one item within ~60s and confirm they land as one listing with a working carousel

**What happened:**
- Added a full-screen lightbox to the storefront: clicking a card image opens it on a dark backdrop, with ‹ › arrows + dot indicators for multi-photo listings (arrows hidden for single-photo). Closes via backdrop click, ✕ button, or Esc; ← / → navigate. Background scroll locked while open.
- Reused the existing carousel styling conventions. Card images now show a `zoom-in` cursor.
- Verified in preview against mock listings (the live Worker's CORS blocks localhost, so real listings don't load in the preview) — open on click, image cycling with wraparound + matching dots, nav hidden for single-image, closes on backdrop/Esc but not on image-click.
- Deployed: committed + pushed to `main` (commit 20c4207) → GitHub Pages auto-redeploy.

**Decisions:**
- [DECISION] Lightbox on the storefront only. Admin page keeps its flat removable thumbnail strip — review wants everything visible at once, not a paged viewer.

**Still open:**
- Real-photo-burst test of multi-photo batching (carried over, still untested).

**Files touched:** `docs/index.html`, `docs/js/app.js`, `docs/css/style.css`, `WORKBENCH.md`

---

## 2026-07-04 14:25, [tool: Claude Code]

**Focus:** Multi-photo listings (batched WhatsApp sends → one listing with a carousel), plus a run of smaller storefront UX iterations (category headings, bilingual category labels, alphabetical sort, payment badges, pickup map).

**Next session, start here:**
- Read: `worker/worker.js`'s `processPhotoIntake` for the batching logic
- In flight: multi-photo batching is deployed but not yet tested with a real WhatsApp burst
- Single next move: send 2-3 photos of one item within ~60s and confirm they land as one listing with a working carousel

**What happened:**
- Listings moved from a single `image_key` to an `image_keys` array. Old listings keep working via an `imagesOf(l)` fallback helper (duplicated in app.js/admin.js, matching the existing pattern for title/description fallbacks).
- Added time-window batching: photos from the same WhatsApp number within 60s of each other join the same draft listing instead of creating a new one, tracked via a short-TTL `pending_batch:{from}` KV key. Only the first photo in a batch triggers the AI call — later photos just append to `image_keys` and send a lightweight "photo added" confirmation.
- Storefront cards with >1 photo get a simple carousel (prev/next arrows + dot indicator, no library). Admin shows all photos as a removable thumbnail strip instead — review needs to see everything at once, not page through it.
- Along the way: reorganized the storefront into per-category heading sections (removed the redundant per-photo category icon click-filter once headings made it unnecessary), added bilingual category labels, alphabetized listings within each section, added a "Pay by" badge row and an OpenStreetMap pickup pin, and reworked the AI pricing prompt to reason from a new-retail-price anchor instead of guessing a used price directly (catches cases like "actually brand new" that a blind guess gets wrong).
- Fixed a real WhatsApp checkout flow: replaced the old form-based checkout (name/phone fields + server relay, which hit Twilio's 24h session-window limit) with a `wa.me` click-to-chat link that lets the buyer message Jordan directly — sidesteps the API session-window problem entirely since it's a real person-to-person message.

**Decisions:**
- [DECISION] Batch grouping by time window rather than by NumMedia>1 in a single webhook call — WhatsApp actually delivers a multi-photo send as separate rapid messages, not one message with multiple attachments, so time-window grouping is what actually works.
- [DECISION] Only the first photo in a batch calls the AI — cheaper, and subsequent photos are just more angles of the same item, not new information worth re-analyzing.
- [DECISION] Admin shows all photos as a flat removable strip, not a carousel — review workflow wants to see everything at once.

**Still open:**
- Batching hasn't been tested with a real WhatsApp photo burst yet — only deployed and syntax-checked.
- GitHub Pages deploys have been intermittently flaky (transient failures, and the Pages status API lagging behind what's actually served) — direct `curl` checks of served content have been the more reliable verification method today.

**Files touched:** `worker/worker.js`, `docs/js/app.js`, `docs/js/admin.js`, `docs/css/style.css`, `docs/index.html`, `TODOS.md`

---

## 2026-07-02 09:15, [tool: Claude Code]

**Focus:** Initial build of the moving-sale marketplace — full frontend, Worker backend, and the one integration edit to `daily-assistant/worker.js`.

**Next session, start here:**
- Read: `TODOS.md` "Next" section
- In flight: nothing built yet is deployed — everything below is local code only
- Single next move: run through the deployment steps in `ARCHITECTURE.md` (KV namespace, secrets, `wrangler deploy`, GitHub repo + Pages)

**What happened:**
- Planned architecture with the user: WhatsApp photo intake reusing existing Twilio/Cloudflare infra from `daily-assistant`, GitHub Pages storefront + separate Cloudflare Worker backend, WhatsApp-only checkout handoff (no payment processing).
- Built `worker/worker.js`: full API (`/twilio-intake`, `/api/listings`, `/images/:id`, admin drafts/publish/delete/config, `/api/checkout`), CORS, chunked base64 image encoding (avoids a stack-overflow bug that would only show up on real-sized photos), Anthropic vision call for AI-drafted listings, always-log-the-inquiry checkout behavior.
- Built the storefront (`docs/index.html`, `docs/js/app.js`) and admin page (`docs/admin.html`, `docs/js/admin.js`), plain HTML/CSS/JS, no build step.
- Edited `daily-assistant/worker.js`: widened the handler to `fetch(request, env, ctx)`, added a `NumMedia > 0` branch that forwards photo messages to this project's Worker via `ctx.waitUntil()` (non-blocking, so it doesn't risk timing out Twilio's webhook). Everything else in that file is untouched.

**Decisions:**
- [DECISION] Pure Cloudflare KV, no D1 — item count is small (a house's worth of goods) and query needs are basic list/filter the frontend can do client-side. Avoids a second storage system for no real benefit at this scale.
- [DECISION] New standalone Cloudflare Worker rather than adding all this logic into `daily-assistant/worker.js` directly — keeps the already-working chief-of-staff automation isolated from a new, unrelated project. The only shared touchpoint is the one forwarding branch.
- [DECISION] Sold items stay visible with a badge rather than being hidden — avoids buyers wondering why something disappeared.
- [DECISION] Exchange rate is a manually-set admin value, not a live FX API call — USD is computed server-side at save time, so the static frontend just renders whatever price fields the API returns.

**Still open:**
- Nothing is deployed yet — Cloudflare KV namespace, Worker secrets, `wrangler deploy`, GitHub repo/Pages all still need to happen.
- `daily-assistant/worker.js` is not tracked in git (confirmed during planning) and has no CI deploy — the forwarding edit needs to be pushed live the same way that Worker is normally deployed.
- Haven't verified against a real WhatsApp photo yet — the base64-chunking fix and Cloudflare Workers CPU-time limit (Free vs Paid plan) are both real risks worth testing early rather than assuming away.

**Files touched:** `moving-sale/worker/worker.js`, `moving-sale/worker/wrangler.toml`, `moving-sale/docs/index.html`, `moving-sale/docs/admin.html`, `moving-sale/docs/js/config.js`, `moving-sale/docs/js/app.js`, `moving-sale/docs/js/admin.js`, `moving-sale/docs/css/style.css`, `moving-sale/ARCHITECTURE.md`, `moving-sale/USER_GUIDE.md`, `moving-sale/TODOS.md`, `daily-assistant/worker.js`

---
