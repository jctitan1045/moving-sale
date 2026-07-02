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

## Key files

| File | Role |
|---|---|
| `docs/index.html` | Storefront shell |
| `docs/admin.html` | Admin review/publish page (token-gated) |
| `docs/js/config.js` | `WORKER_BASE_URL` constant — the one file to edit after a Worker redeploy |
| `docs/js/app.js` | Storefront logic: fetch listings, cart (localStorage), checkout |
| `docs/js/admin.js` | Admin logic: fetch/edit drafts, publish, mark sold, delete, fx rate |
| `worker/worker.js` | All backend routes (see Data flow) |
| `worker/wrangler.toml` | Worker config: KV binding, `ALLOWED_ORIGIN`, `STOREFRONT_URL` vars |
| `../daily-assistant/worker.js` | **Not part of this repo** — has one small edit (see below) that forwards incoming WhatsApp photos here |

## KV schema

- `listing:{id}` → `{ title, description, category, condition, price_cop_min/max, price_usd_min/max, image_key, status: draft|published|sold, created_at, source_phone }`
- `image:{id}` → raw image bytes, `metadata: { contentType }`
- `inquiry:{id}` → `{ items, buyer_name, buyer_phone, created_at, whatsapp_sent, whatsapp_error_code }` — written for every checkout, even if the WhatsApp send fails
- `config:fx_rate` → single value, COP per USD, admin-editable

Listings are enumerated via `KV.list({prefix:"listing:"})` rather than a separate index — simpler, and fine at this scale (a few hundred items). Known tradeoff: KV list/read is eventually consistent (up to ~60s propagation), so a just-published listing might not show immediately from every edge location.

## Data flow

**Photo intake:** Jordan texts a photo to the existing Twilio WhatsApp sandbox number → hits `daily-assistant/worker.js` → its one added branch (`NumMedia > 0`) forwards the form data via `ctx.waitUntil()` (non-blocking, avoids Twilio's ~15s webhook timeout) to `POST /twilio-intake` on this project's Worker, with a shared `X-Internal-Secret` → that handler downloads the image from Twilio (Basic Auth required on media URLs), stores it in KV, calls Anthropic vision with a Medellín-resale-market prompt, saves a `draft` listing, and WhatsApps Jordan a confirmation + admin link.

**Review/publish:** Jordan opens `admin.html`, enters the admin token (stored in `localStorage`), edits AI-drafted fields, publishes. `PATCH /api/admin/listings/:id` recomputes USD price at save time from the current `config:fx_rate`.

**Storefront:** `index.html` calls `GET /api/listings` (published + sold only), renders cards, images via `GET /images/:id`.

**Checkout:** cart lives entirely in `localStorage` until submit. `POST /api/checkout` looks up authoritative prices from KV, sends Jordan an itemized WhatsApp message, and always logs an `inquiry` record regardless of whether the WhatsApp send succeeds.

## Deployment

1. `cd worker && npx wrangler kv namespace create MOVING_SALE_KV` → id into `wrangler.toml`
2. `npx wrangler secret put <NAME>` for `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_TO`, `ADMIN_TOKEN`, `INTERNAL_FORWARD_SECRET`
3. `npx wrangler deploy` → note the `*.workers.dev` URL, put it in `docs/js/config.js`
4. Add `MOVING_SALE_WORKER_URL` + `INTERNAL_FORWARD_SECRET` secrets to the `daily-assistant` Worker, redeploy it with the forwarding edit
5. `gh repo create moving-sale --public --source=. --push`, then repo Settings → Pages → Deploy from branch → `main` / `/docs`
6. Update `ALLOWED_ORIGIN` / `STOREFRONT_URL` in `wrangler.toml` to the live Pages URL, redeploy the Worker

## Open architectural questions

- **Twilio WhatsApp Sandbox 24h session window.** Outbound freeform messages only deliver within 24h of Jordan last texting the sandbox number. The checkout notification is system-initiated (not a reply to Jordan), so it can silently fail to deliver if Jordan hasn't texted in recently. Mitigated by always writing the `inquiry` KV record regardless of send success — worst case, Jordan needs to check `admin.html`/KV directly rather than relying on the ping.
- **Cloudflare Workers CPU time limit.** If the account is on the Workers Free plan (10ms CPU budget per invocation), base64-encoding a multi-MB photo for the Anthropic request may exceed it. Untested against a real photo as of initial build — verify early, upgrade to Workers Paid ($5/mo) if needed.
- **`daily-assistant/worker.js` is not tracked in git** (confirmed during planning — it's a local file, deployed manually). The forwarding edit lives there as a local change; it needs to be deployed the same way that Worker was originally deployed (dashboard Quick Edit or manual `wrangler deploy`) for the photo-intake flow to actually work.
