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
