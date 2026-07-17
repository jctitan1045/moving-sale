# TODOs

Last updated: 2026-07-17

## Next
- [ ] **Why is everything landing in `decor`?** 52 of the first 65 listings were categorised `decor` (Furniture later showed 7, so it may spread with volume). If the intake prompt is over-assigning it, the storefront category filter is near-useless to buyers. Check `PRICING_PROMPT` / the `category` enum description in `worker/worker.js`.
- [ ] **Validate Twilio's `X-Twilio-Signature` on `/twilio-webhook`.** It's currently unauthenticated and the Worker URL is public, so anyone who finds it can trigger paid Anthropic calls and junk drafts. The one real hardening item.
- [ ] Confirm the admin "👁 Storefront views" line renders real numbers (needs the admin token — Claude couldn't verify the authorized path). Baseline is 3 views, all from beacon testing.
- [ ] Send the drafted WhatsApp posts: the public/broadcast one and the friends-only early-access one (drafted 2026-07-17, not yet sent).

## Soon
- [ ] Consider a search box or sort-by-price if inventory grows past what category headings alone can organize (108 items and climbing)
- [ ] Revisit AI pricing accuracy periodically — spot-check a few listings against real Medellín secondhand comps
- [ ] Consider a secondary/burner number for the sale — `docs/js/config.js` publishes Jordan's personal number (`+15105522610`) on a public page and in a public repo
- [ ] Rotate the plaintext secrets in `~/Claude Code/.env` and `~/Claude Code/.claude/settings.local.json` (Cloudflare, Anthropic, Twilio) — long-standing, not specific to this repo

## Someday
- [ ] Social preview image (Open Graph tags) for nicer link previews when shared in WhatsApp/groups
- [ ] Freshness check before WhatsApp checkout (re-verify item isn't sold right before opening the wa.me link)
- [ ] Prune legacy `inquiry:*` KV records — nothing writes them since checkout moved to `wa.me`

## Done
- [x] Deploy the content-based grouping + duplicate detection Worker (2026-07-15) and push the admin frontend (2026-07-17)
- [x] Replace time-based photo batching with AI same-item grouping
- [x] Duplicate detection: auto at draft creation + on-demand "Scan for duplicates" rescan, badged in admin
- [x] "Split into separate items" for over-grouped listings (this rescued the stuck 50-photo listing)
- [x] Pending-drafts count in admin
- [x] Live per-category item counts in the storefront filter dropdown
- [x] Cart total in the WhatsApp checkout message (+ guarded a latent `$NaN USD` in the cart drawer)
- [x] Cloudflare Web Analytics on the storefront, with view counts surfaced in admin via a scoped read-only token
- [x] Repo public vs private — **resolved: stays public.** GitHub Pages on the Free plan only publishes from a public repo, so going private would take the storefront offline. No secrets are committed (all live in Worker secrets), so the exposure is source code only.
