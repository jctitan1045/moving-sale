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
