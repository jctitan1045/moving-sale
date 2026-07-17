# ARCHITECTURE

## What this project is

A marketplace site for Jordan's household moving sale in Medellín. Jordan photographs an item on WhatsApp, AI drafts a listing (title, description, condition, price range in COP + USD), he reviews/publishes it from an admin page, buyers browse the storefront and submit a cart, and checkout sends Jordan a WhatsApp message with the buyer's contact info to close the sale manually — no payment processing.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Static HTML/CSS/vanilla JS, no build step |
| Frontend hosting | GitHub Pages (`main` branch, `/docs` folder) |
| Backend | Cloudflare Worker (`moving-sale-worker`) |
| Storage | Cloudflare KV (no D1 — item count is small, query needs are basic) |
| AI | Anthropic API, `claude-sonnet-4-6`, vision request for listing drafts |
| Messaging | Twilio WhatsApp (shared account with the `daily-assistant` project) |
| Analytics | Cloudflare Web Analytics (cookieless beacon, storefront only; read back through the Worker) |

## Key files

| File | Role |
|---|---|
| `docs/index.html` | Storefront shell; also carries the Cloudflare Web Analytics beacon (admin is deliberately untracked) |
| `docs/admin.html` | Admin review/publish page (token-gated) |
| `docs/js/config.js` | `WORKER_BASE_URL` + `JORDAN_WHATSAPP` — the one file to edit after a Worker redeploy |
| `docs/js/app.js` | Storefront logic: fetch listings, category filter w/ live counts, cart (localStorage), wa.me checkout w/ total |
| `docs/js/admin.js` | Admin logic: drafts + pending count, edit/publish, mark sold, delete, fx rate, duplicate badges, split, duplicate rescan, view counts |
| `worker/worker.js` | All backend routes (see Data flow) |
| `worker/wrangler.toml` | Worker config: KV binding, `ALLOWED_ORIGIN`, `STOREFRONT_URL` vars |
| `../daily-assistant/worker.js` | **Not part of this repo** — has one small edit (see below) that forwards incoming WhatsApp photos here |

## KV schema

- `listing:{id}` → `{ title_en/es, description_en/es, category, condition, price_new_cop, price_cop_min/max, price_usd_min/max, inventory, image_keys[], possible_duplicate_of[], status: draft|published|sold, created_at, source_phone }`
  - `image_keys` is an array (multi-photo listings); older records may carry a single `image_key`, handled by an `imagesOf()`/`imagesOfListing()` fallback duplicated in `app.js`, `admin.js` and `worker.js`.
  - `possible_duplicate_of` holds ids of listings believed to be the same item (set at draft creation, rewritten by the rescan endpoint).
- `image:{id}` → raw image bytes, `metadata: { contentType }`
- `recent_draft:{from}` → `{ listingId }`, TTL `RECENT_DRAFT_WINDOW_MS` (15min). The sender's most recent draft, used as the *comparison anchor* for the next incoming photo. It does **not** decide grouping — the vision model does.
- `cache:analytics` → cached Cloudflare view counts, TTL 5min
- `config:fx_rate` → single value, COP per USD, admin-editable
- `inquiry:{id}` → **legacy.** Written by the old server-relay checkout, which was replaced by the `wa.me` click-to-chat flow (see Checkout). Nothing writes these any more; old records may still exist.

Listings are enumerated via `KV.list({prefix:"listing:"})` rather than a separate index — simpler, and fine at this scale (a few hundred items). Known tradeoff: KV list/read is eventually consistent (up to ~60s propagation), so a just-published listing might not show immediately from every edge location.

## Data flow

**Photo intake:** Jordan texts a photo to the moving-sale WhatsApp number (`+15559155529`) → Twilio calls `POST /twilio-webhook` directly. (The older path — forwarding from `daily-assistant/worker.js` to `POST /twilio-intake` behind a shared `X-Internal-Secret` — still exists.) The handler downloads the image from Twilio (Basic Auth required on media URLs) and stores it in KV.

**Grouping (content-based):** If the sender has a recent draft (`recent_draft:{from}`), its first photo is sent to the vision model *alongside* the new photo, and the `create_listing` tool returns `is_same_item_as_reference`. True → append the photo to that draft (another angle). False → draft a new listing. This replaced a fixed 60s batch window, which lumped every photo in a burst into one listing regardless of content. Known limit: a large rapid burst hits the webhook near-concurrently, so the anchor a given photo compares against may be stale — grouping is best-effort, and mis-groups are fixed via Split in admin.

**Duplicate detection:** at draft creation, `findPossibleDuplicates()` flags same-category listings with ≥60% title-token overlap into `possible_duplicate_of`. `POST /api/admin/rescan-duplicates` does a deeper semantic pass (whole catalog's titles/categories → model → duplicate groups) and rewrites the field across all active listings. Both surface as a badge in admin.

**Split:** `POST /api/admin/split-photo {listing_id, image_key}` re-drafts a single photo into its own listing, reusing the existing image bytes. The admin client calls it once per photo, then detaches images from the original (`image_keys: []`) and deletes it — one request per photo keeps each call small enough to avoid per-request subrequest limits on a big split.

**Review/publish:** Jordan opens `admin.html`, enters the admin token (stored in `localStorage`), edits AI-drafted fields, publishes. `PATCH /api/admin/listings/:id` recomputes USD price at save time from the current `config:fx_rate`.

**Storefront:** `index.html` calls `GET /api/listings` (published + sold only), renders cards, images via `GET /images/:id`. The category dropdown is built from the loaded listings with live per-category counts; empty categories are hidden and sold items excluded.

**Checkout:** cart lives entirely in `localStorage`. There is no server-side checkout — clicking through opens a `wa.me` click-to-chat link with an itemized message plus a `Total (suggested)` line (matching the cart drawer's total) pre-filled, which the buyer sends to Jordan's personal number from their own WhatsApp. This sidesteps Twilio's 24h session-window problem entirely, since it's a real person-to-person message.

**Analytics:** the storefront carries the Cloudflare Web Analytics beacon. Admin reads counts via `GET /api/admin/analytics`, which queries Cloudflare's GraphQL RUM dataset **server-side** — `admin.html` is a public static page, so the API token can never live in it — and caches the result in `cache:analytics` for 5 minutes.

## Deployment

1. `cd worker && npx wrangler kv namespace create MOVING_SALE_KV` → id into `wrangler.toml`
2. `npx wrangler secret put <NAME>` for `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_TO`, `ADMIN_TOKEN`, `INTERNAL_FORWARD_SECRET`, plus (for admin view counts) `CF_ANALYTICS_TOKEN`, `CF_ACCOUNT_ID`, `CF_SITE_TAG`
   - `CF_ANALYTICS_TOKEN` must be a **scoped** Cloudflare API token with only `Account → Account Analytics → Read`. Do not reuse the deploy token. Account id + site tag are secrets rather than `wrangler.toml` vars purely to keep Cloudflare identifiers out of the public repo.
   - Note `wrangler deploy` needs `CLOUDFLARE_API_TOKEN` in the environment when run non-interactively.
3. `npx wrangler deploy` → note the `*.workers.dev` URL, put it in `docs/js/config.js`
4. Add `MOVING_SALE_WORKER_URL` + `INTERNAL_FORWARD_SECRET` secrets to the `daily-assistant` Worker, redeploy it with the forwarding edit
5. `gh repo create moving-sale --public --source=. --push`, then repo Settings → Pages → Deploy from branch → `main` / `/docs`
6. Update `ALLOWED_ORIGIN` / `STOREFRONT_URL` in `wrangler.toml` to the live Pages URL, redeploy the Worker

## Open architectural questions

- **`/twilio-webhook` is unauthenticated.** It does not validate Twilio's `X-Twilio-Signature`, and the Worker URL is public (it's in `docs/js/config.js` in a public repo). Anyone who finds it can POST a fake webhook with their own `MediaUrl0` and trigger paid Anthropic calls + junk drafts. It can't reach the public storefront (drafts need review), but it's a cost/spam vector. Fix: validate the signature.
- **Repo visibility vs. GitHub Pages.** The repo is public. No secrets are committed (all live in Worker secrets), so this is low-risk, but note that on the GitHub **Free** plan Pages only publishes from a *public* repo — making it private would take the storefront offline. Pages sites are publicly reachable regardless of repo visibility.
- **Twilio WhatsApp Sandbox 24h session window.** Outbound freeform messages only deliver within 24h of Jordan last texting the sandbox number. The checkout notification is system-initiated (not a reply to Jordan), so it can silently fail to deliver if Jordan hasn't texted in recently. Mitigated by always writing the `inquiry` KV record regardless of send success — worst case, Jordan needs to check `admin.html`/KV directly rather than relying on the ping.
- **Cloudflare Workers CPU time limit.** If the account is on the Workers Free plan (10ms CPU budget per invocation), base64-encoding a multi-MB photo for the Anthropic request may exceed it. Untested against a real photo as of initial build — verify early, upgrade to Workers Paid ($5/mo) if needed.
- **`daily-assistant/worker.js` is not tracked in git** (confirmed during planning — it's a local file, deployed manually). The forwarding edit lives there as a local change; it needs to be deployed the same way that Worker was originally deployed (dashboard Quick Edit or manual `wrangler deploy`) for the photo-intake flow to actually work.
