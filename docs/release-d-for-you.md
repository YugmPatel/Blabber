# Release D Batch 5: For You

Batch 5 adds a transparent For You post feed to Discover while preserving the existing Browse experience.

## API

- `GET /api/discovery/for-you?cursor=`
- `POST /api/discovery/for-you/refresh`
- `POST /api/discovery/for-you/events`
- `GET /api/discovery/for-you/explanations/:postId`

All routes require authentication. Cursor sessions are user-bound, short-lived, and stored by hash.

## UI

`/discover` now has two views:

- `For You`: personalized eligible public post recommendations with refresh and safe explanations.
- `Browse`: existing deterministic topic, creator, public post, and open Community browsing.

The Browse behavior from Batch 4 remains available and separate.

## Privacy And Safety

For You uses the existing Discover candidate token model, existing block/mute/hide feedback, controlled topics, creator discovery settings, and media approval checks. Every page fetch re-authorizes candidates before returning them.

Personalization opt-out keeps the feed usable as a recency fallback and prevents optional recommendation signals from being recorded. Reset clears events, affinities, sessions, and candidate tokens.

## Validation

Durable smoke command:

```bash
pnpm smoke:release-d-for-you
```

The suite validates authentication, candidate eligibility, self-post exclusion, creator/topic ranking signals, explanations, session pagination, user-bound cursors/tokens, event recording, opt-out fallback, reset cleanup, negative feedback, and isolation from non-personal-feed surfaces.
