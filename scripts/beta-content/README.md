# Beta Content Seed System

Populates Blabber's Feed, Reels, Discover, and public profiles with realistic
demo content so the beta app never looks empty — 10 demo/community accounts,
60 feed posts, 30 reels, 10 Discover topics, 80-150 reactions, 25-40
comments, and a basic follow graph between the demo accounts.

Real photos/videos come from Pexels (primary), Pixabay (fallback), and
Unsplash (photo-only supplementary source), downloaded once during seeding
and stored as Blabber-owned media — **the running app never calls these
APIs**. If every provider comes up short for a given item, a small
Blabber-branded generated image/video fills the gap instead of leaving a
hole in the content.

The plan also includes seed-owned generated identity assets: deterministic
initials avatars for all 10 demo accounts, and five @blabber onboarding /
feature-tip image posts inside the 60-post feed target. These generated/local
assets are small, deterministic, and tagged with `source: "generated"` in
seed metadata; they do not call external image-generation APIs.

## Prerequisites

- The full Docker stack running locally (`pnpm docker:full:up`) — `--apply`,
  `--report`, and `--reset` all run inside the `media` container so they can
  reach Mongo, `LOCAL_MEDIA_DIR`, and the media service's own HTTP port,
  exactly like the existing `scripts/seed-demo-social.mjs` and
  `scripts/import-pexels-demo-content.mjs`.
- Free API keys for Pexels, Pixabay, and Unsplash in your local `.env`
  (never commit this file):

  ```
  PEXELS_API_KEY=...
  PIXABAY_API_KEY=...
  UNSPLASH_ACCESS_KEY=...
  ```

  Get them at:
  - Pexels: https://www.pexels.com/api/
  - Pixabay: https://pixabay.com/api/docs/
  - Unsplash: https://unsplash.com/developers (use the **Access Key**, not
    the secret)

  If a key is missing, every command that needs it fails immediately with a
  message naming exactly which env var is missing and where to get it — it
  never logs the key value itself, and never proceeds partway through with a
  provider silently disabled.

- `ffmpeg` plus a usable TrueType font inside the `media` container for the
  local-generated fallback path. The media image installs
  `fontconfig ttf-dejavu` on Alpine so `drawtext` can resolve a concrete
  font file. If a custom image changes font paths, set
  `BETA_SEED_FONT_FILE=/absolute/path/to/font.ttf`.

## Commands

```bash
# Fetch + plan + score against the real provider APIs, report the resulting
# inventory, and fail loudly if targets can't be met. No database writes.
# Runs entirely on the host — no Docker required.
pnpm seed:beta-content:dry-run

# Actually create everything: accounts, posts (through the real
# upload+malware-scan pipeline), reels (through the real
# upload+scan+ffmpeg-transcode pipeline), reactions, comments, and follows.
# Safe to re-run — every write is a seedKey-keyed idempotent upsert.
pnpm seed:beta-content:apply

# Print current seeded-content counts (from the beta_content_seed_records
# tracking collection), grouped by kind and by source provider.
pnpm seed:beta-content:report

# Remove beta content (soft-hide posts/reels, deactivate the demo accounts,
# hard-delete their reactions/comments/follows). Requires an explicit
# confirmation flag or it refuses to run.
node scripts/seed-beta-content.mjs --reset --confirm-reset-beta-seed-content

# Unit tests for the pure logic (scoring, content plan, provider parsing,
# inventory enforcement) — mocks every external API call, never hits the
# real Pexels/Pixabay/Unsplash endpoints.
pnpm test:beta-content
```

## How it works

1. **`content-plan.mjs`** deterministically builds the full plan (which
   accounts, which posts/reels go to which topics, who comments/reacts on
   what, who follows whom) — no randomness, no I/O. Re-running it always
   produces the exact same plan.
2. **`resolve-asset.mjs`** walks the fallback chain for each photo/video
   need: Pexels → Unsplash → Pixabay for photos (Unsplash is promoted to
   first place for ~35% of items to land near the task's ~20%
   content-mix target), Pexels → Pixabay for video (Unsplash has no video
   API). **`asset-score.mjs`** filters/ranks each provider's results
   (minimum 1080px width for photos, 5-20s duration target for video,
   portrait preference for Reels, duplicate-asset avoidance, a defensive
   unsafe-term/text-heavy text filter).
3. If every provider comes back empty for an item, **`local-assets.mjs`**
   generates a Blabber-teal-branded fallback image/clip with `ffmpeg` — the
   plan itself never comes up short, even if the real internet does.
4. **`inventory.mjs`** checks the resolved plan against the required
   minimums (60 posts, 30 reels split 5/5/5/4/4/4/3 across categories, 10
   topics, etc.) and throws a specific, actionable error — e.g. `ERROR:
   Required 30 reels, only 24 valid reels selected. Missing categories:
   campus, food.` — **before** `--apply` does any writes if it's clear the
   plan can't be met, or partway through `--apply` if something fails
   unexpectedly after some items already succeeded.
5. **`db-writer.mjs`** / **`apply.mjs`** perform the actual writes. Photos
   and reel source video are downloaded and then `PUT` through the exact
   same authenticated HTTP routes a real upload would use
   (`/local/:mediaId`, `/reels/uploads/:reelId/source` on the media
   service) — so ClamAV/mock malware scanning and, for reels, the real
   `ffmpeg` transcode always run for real. Reactions, comments, and follows
   are direct, idempotent Mongo upserts (there's no HTTP route for
   backfilling historical-looking engagement), keeping the denormalized
   `reactionCounts`/`commentCount` caches on each post/reel in sync.

### Idempotency

Every seeded document has a stable `seedKey` (e.g. `beta-user-blabber`,
`beta-post-studyhub-001`, `beta-reel-campusdaily-003`,
`beta-comment-techbytes-002`) that deterministically hashes to a fixed Mongo
`_id` (`seed-keys.mjs`). Every write in `db-writer.mjs` is a
`$setOnInsert`/`$set` upsert keyed by that `_id`, and a
`beta_content_seed_records` tracking collection records `seedKey → {kind,
mongoId, collection, source}` for every item created. Running `--apply`
twice in a row is a no-op the second time (aside from re-verifying nothing
regressed) — no duplicate accounts, posts, reels, reactions, comments, or
follow edges.

### Source/license metadata

Every seeded post/reel/media document carries an `importer` field recording
where it came from:

```json
{
  "source": "pexels",
  "sourceAssetId": "1234567",
  "sourceUrl": "https://images.pexels.com/...",
  "sourceAuthor": "Photographer Name",
  "sourceProviderUrl": "https://www.pexels.com/photo/1234567/",
  "license": "See provider terms (Pexels/Pixabay/Unsplash free-to-use license).",
  "downloadedAt": "2026-...",
  "seedKey": "beta-post-foodfinds-001",
  "searchQuery": "coffee shop",
  "originalWidth": 4000,
  "originalHeight": 3000
}
```

This isn't surfaced in the product UI (Blabber has no attribution UI today)
but is kept for later audit/removal/attribution needs — query
`beta_content_seed_records` or any seeded document's `importer` field.

### Removing beta content later

`--reset --confirm-reset-beta-seed-content` is deliberately conservative:
posts/reels are soft-hidden (`deletedAt` set, `discoverable`/
`reelDiscoverable` unset), matching how every other delete path in this app
works, and the 10 demo accounts are deactivated rather than deleted outright.
Reactions/comments/follow edges tied to seeded content are hard-deleted
since they're pure demo interaction data with no independent value. See
`reset.mjs` for the exact behavior.

## Production

Production-like runs are blocked by default. Production apply is allowed only
with every explicit confirmation below:

```bash
BLABBER_SEED_TARGET=production pnpm seed:beta-content --apply --allow-production --confirm-production-beta-seed-content
```

Before any production write, the script prints the target database name, a
credential-redacted Mongo host/database summary, expected counts (10
accounts, 60 posts, 30 reels, 10 topics, 80-150 reactions, 25-40 comments,
and the deterministic follow graph count), and this warning:

> This will create beta seed users, posts, reels, media records, reactions,
> comments, and follows in the target database.

Production apply also requires recent Mongo backup evidence. The script
checks `backups/mongo` by default, or `BLABBER_MONGO_BACKUP_DIR` if set. If
no recent backup archive/manifest is found, apply is blocked and the error
prints the command to run, for example:

```bash
BACKUP_MONGO_DB=blabber_full pnpm backup:mongo
```

Production reset is stricter because it is destructive for beta seed content
(posts/reels are hidden, demo accounts are deactivated, and seed
reactions/comments/follows are deleted). It requires all apply confirmations
plus both reset/delete confirmations:

```bash
BLABBER_SEED_TARGET=production pnpm seed:beta-content --reset --allow-production --confirm-production-beta-seed-content --confirm-reset-beta-seed-content --confirm-delete-production-beta-seed-content
```

Reset only targets records owned by the beta content seed tracking metadata;
it is not a general database wipe.
