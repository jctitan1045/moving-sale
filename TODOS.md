# TODOs

Last updated: 2026-07-02

## Next
- [ ] Create Cloudflare KV namespace and fill in `worker/wrangler.toml`
- [ ] Set all Worker secrets (`wrangler secret put`)
- [ ] Deploy the Worker and update `docs/js/config.js` with the live URL
- [ ] Add the two new secrets to `daily-assistant`'s Worker and redeploy it with the forwarding edit
- [ ] Create the `moving-sale` GitHub repo, push, enable Pages on `main`/`docs`
- [ ] Update `ALLOWED_ORIGIN`/`STOREFRONT_URL` in `wrangler.toml` to the live Pages URL and redeploy
- [ ] Confirm the Twilio sandbox join is still active
- [ ] Check the Cloudflare account's Workers plan tier (Free vs Paid) before relying on real-photo intake
- [ ] Send a real test photo end to end and verify a draft appears in admin

## Soon
- [ ] Set an initial `config:fx_rate` value from admin.html
- [ ] Walk through the storefront + cart + checkout flow as a test buyer
- [ ] Decide whether the repo should stay public or move private

## Someday
- [ ] Bilingual (Spanish) listings, if local buyers turn out to need it
- [ ] Simple photo gallery per item (multiple angles) instead of one image
