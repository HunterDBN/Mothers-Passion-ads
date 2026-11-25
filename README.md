# Mother's Passion ads

Ad images made in Canva and posted to Facebook and TikTok through Buffer.

## How posting works

- `ads/ads.json` lists every ad (id, caption, Canva link). Images live in `ads/images/<id>.jpg`.
- `.github/workflows/buffer-daily.yml` runs every 6 hours and tops up the Buffer queue (up to 14 days ahead, or until Buffer's queue limit) with 4 posts a day
  at **7:30 AM, 12:15 PM, 5:30 PM and 8:30 PM Vancouver time** (DST handled automatically).
  Each slot posts the next ad in the rotation to both the Facebook page and TikTok.
- `ads/state.json` remembers where the rotation is and which time slots are already scheduled on each channel, so no slot is ever posted twice.
- The Buffer token comes from the `BUFFER_ACCESS_TOKEN` repository secret.

## Adding a new ad

1. Make the ad in Canva at 1080x1920 with the logo and `amotherspassion.ca` on it.
2. Save the JPG as `ads/images/<id>.jpg` and add an entry to `ads/ads.json`.
3. Commit to `main`. It joins the rotation the next day.

## Manual run

Actions → "Buffer daily ads" → Run workflow. Set `dry_run` to 1 to preview without posting.

## Catalog ads (from Nov 25)

New posts are generated automatically from the live store instead of hand-made Canva copies:

- `scripts/catalog.mjs` snapshots every product and category from amotherspassion.ca into `site/catalog.json` (refreshed daily).
- `scripts/generate.mjs` renders 1080x1920 ads with `templates/ad.html` (four layouts: arch, framed, sale with was-price, and a category grid). Every image carries the logo (`assets/logo.png`) and amotherspassion.ca.
- Rotation: products round-robin across all categories, each product once before any repeats, with a category ad every 4th post. Wording per category lives in `ads/copy.json`.
- `scripts/buffer.mjs fill` posts generated ads first (`ads/generated.json`), falling back to the original Canva ads in `ads/ads.json`.
- "Render sample ads" (ads-samples.yml) renders a preview batch into `ads/samples/` whenever the templates or wording change.
