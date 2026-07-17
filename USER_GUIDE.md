# USER GUIDE

## What it does for you

You text a photo of something you're selling to your WhatsApp number. AI drafts a listing — title, description, condition, and a price range in both COP and USD — and pings you back. You review it on a simple admin page, tweak anything you want, and publish. It shows up on the public storefront immediately. When someone wants to buy, they add items to a cart and click through to WhatsApp with a pre-written, itemized message (including a total) that they send you from their own phone — you take it from there (payment, pickup, whatever works).

## How to use it

**Listing an item:**
1. Take a photo of the item.
2. Send it to the moving-sale WhatsApp number, optionally with a caption noting anything worth mentioning (defects, brand, age).
3. Wait a few seconds — you'll get a WhatsApp reply confirming a draft was created, with a link to the admin page.
4. Open the admin link, enter your admin token, review the draft. Edit the title/description/price/category/condition if needed.
5. Click "Publish." It's now live on the storefront.

**Sending several photos:** you don't need to do anything special. The AI looks at each new photo and decides whether it's *the same item* as the one you just sent (another angle → added to that listing) or *a different item* (→ its own listing). So you can photograph one item from 3 sides, or send 20 different items, and it sorts itself out. It's not perfect on a huge rapid burst — a short pause between different items gives the cleanest result, and anything mis-grouped is fixable with "Split" below.

**Reviewing/managing listings:**
- `admin.html` has two sections: pending drafts (from WhatsApp) and published/sold listings. The drafts heading shows a **"N pending"** count.
- **⚠️ Possible duplicate** badge — appears when a listing looks like the same item as another one. Click the badge to jump to the match. **"Scan for duplicates"** (top of the page) runs a deeper check across everything and flags any it finds.
- **"Split into separate items (N)"** — appears on any draft with more than one photo. Turns each photo into its own AI-drafted listing. Use this if several different items got merged into one listing by mistake.
- **👁 Storefront views** — shows how many people viewed the storefront in the last 24h / 7 days / 30 days. Your admin page is deliberately *not* tracked, so this is real visitors, not you.
- "Mark sold" keeps the listing visible with a SOLD badge rather than removing it — buyers browsing won't wonder why something vanished.
- "Delete" removes it permanently (and the photo).

**When a buyer checks out:**
- They get a WhatsApp message pre-filled with their items and a suggested total, which they send to you from their own number. So it arrives as a normal chat from them.
- Reply directly to confirm availability and arrange payment/pickup.
- Because they send it themselves, there's nothing to "miss" on the server — if you got no message, they didn't hit send.

**Updating the exchange rate:**
- `admin.html` has a "COP per USD" field at the top. Update it occasionally — it only affects prices on listings you save/publish *after* the change, not retroactively.

## Settings

| Setting | Where |
|---|---|
| Admin token | `admin.html` login screen, stored in your browser's `localStorage` |
| Worker URL | `docs/js/config.js` — only needs updating if the Worker is ever redeployed under a new URL |
| Exchange rate | `admin.html`, top-right field |
| Analytics dashboard | [Cloudflare Web Analytics](https://dash.cloudflare.com) → site `jctitan1045.github.io` — full detail (referrers, countries, devices); admin just shows the headline view counts |

## Common questions

**I sent a photo but never got a confirmation.** Check that you're still "joined" to the Twilio WhatsApp sandbox (same requirement as the daily-assistant digests — if you haven't messaged the number in a few days, you may need to re-join). Also check `admin.html` — the draft may have been created even if the confirmation text didn't arrive.

**A buyer said they submitted a request but I didn't get anything.** Checkout now opens WhatsApp on *their* phone with the message pre-written — they still have to hit send. If nothing arrived, it wasn't sent. Nothing is logged server-side any more, by design.

**Two photos of the same item became two listings (or two items got merged into one).** The AI decides this per photo and occasionally gets it wrong, especially in a big fast burst. Merged-by-mistake → use "Split into separate items" on that draft. Split-by-mistake → delete one draft and use the "+" on the other to add the photo.

**The AI got the price wrong.** Just edit it in `admin.html` before publishing — nothing goes live until you publish it.

**"Storefront views unavailable" in admin.** The Worker needs three secrets: `CF_ANALYTICS_TOKEN` (a Cloudflare API token scoped to `Account → Account Analytics → Read`), `CF_ACCOUNT_ID`, and `CF_SITE_TAG`. Numbers are cached 5 minutes, so a fresh visit won't show instantly.

**A listing's photo isn't showing.** Reload — it can take up to about a minute for a just-published listing to be visible everywhere (Cloudflare KV propagation).

**Can buyers see a bigger version of a photo?** Yes — on the storefront, clicking any item photo opens it full-screen. Multi-photo listings get prev/next arrows and dots; close with the ✕, the Esc key, or by clicking outside the image.

## When something breaks

Check the browser console on the page that's misbehaving first. For anything server-side, `npx wrangler tail` (run from `moving-sale/worker/`) streams live logs from the Worker while you reproduce the issue.
