# USER GUIDE

## What it does for you

You text a photo of something you're selling to your WhatsApp number. AI drafts a listing — title, description, condition, and a price range in both COP and USD — and pings you back. You review it on a simple admin page, tweak anything you want, and publish. It shows up on the public storefront immediately. When someone wants to buy something, they add it to a cart and submit their name and phone number, which sends you a WhatsApp message with everything they want — you take it from there (payment, pickup, whatever works).

## How to use it

**Listing an item:**
1. Take a photo of the item.
2. Send it to your WhatsApp number (the one you already use for daily digests), optionally with a caption noting anything worth mentioning (defects, brand, age).
3. Wait a few seconds — you'll get a WhatsApp reply confirming a draft was created, with a link to the admin page.
4. Open the admin link, enter your admin token, review the draft. Edit the title/description/price/category/condition if needed.
5. Click "Publish." It's now live on the storefront.

**Reviewing/managing listings:**
- `admin.html` has two sections: pending drafts (from WhatsApp) and published/sold listings.
- "Mark sold" keeps the listing visible with a SOLD badge rather than removing it — buyers browsing won't wonder why something vanished.
- "Delete" removes it permanently (and the photo).

**When a buyer checks out:**
- You get a WhatsApp message listing everything they want plus their name and phone number.
- Reply to them directly to confirm availability and arrange payment/pickup.
- Every checkout is also logged even if the WhatsApp message somehow doesn't arrive — if you ever suspect you missed one, that's a KV `inquiry` record (ask Claude Code to check `moving-sale-worker`'s KV if needed).

**Updating the exchange rate:**
- `admin.html` has a "COP per USD" field at the top. Update it occasionally — it only affects prices on listings you save/publish *after* the change, not retroactively.

## Settings

| Setting | Where |
|---|---|
| Admin token | `admin.html` login screen, stored in your browser's `localStorage` |
| Worker URL | `docs/js/config.js` — only needs updating if the Worker is ever redeployed under a new URL |
| Exchange rate | `admin.html`, top-right field |

## Common questions

**I sent a photo but never got a confirmation.** Check that you're still "joined" to the Twilio WhatsApp sandbox (same requirement as the daily-assistant digests — if you haven't messaged the number in a few days, you may need to re-join). Also check `admin.html` — the draft may have been created even if the confirmation text didn't arrive.

**A buyer said they submitted a request but I didn't get anything.** Same sandbox 24h-window issue can affect outbound messages to you specifically if you haven't texted the number recently. The request is still logged even when the WhatsApp ping fails — ask for it to be checked directly.

**The AI got the price wrong.** Just edit it in `admin.html` before publishing — nothing goes live until you publish it.

**A listing's photo isn't showing.** Reload — it can take up to about a minute for a just-published listing to be visible everywhere (Cloudflare KV propagation).

**Can buyers see a bigger version of a photo?** Yes — on the storefront, clicking any item photo opens it full-screen. Multi-photo listings get prev/next arrows and dots; close with the ✕, the Esc key, or by clicking outside the image.

## When something breaks

Check the browser console on the page that's misbehaving first. For anything server-side, `npx wrangler tail` (run from `moving-sale/worker/`) streams live logs from the Worker while you reproduce the issue.
