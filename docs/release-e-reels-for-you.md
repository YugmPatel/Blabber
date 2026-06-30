# Release E Reels For You

Release E Batch 3 adds a transparent personalized Reels For You feed while preserving the accepted Reels Browse and viewer behavior.

## Surface

- Web: `/reels` with `For You` and `Browse` tabs.
- Mobile: `/reels` with `For You` and `Browse` tabs.
- API:
  - `GET /api/reels/for-you?cursor=`
  - `POST /api/reels/for-you/refresh`
  - `GET /api/reels/for-you/explanations/:reelId`

Browse remains authenticated, deterministic, newest-first, cursor-paginated, and non-personalized.

## Personalization Off

When `personalizedDiscoveryEnabled` is false, For You returns latest eligible public Reels and the response includes:

`Personalized discovery is off. You are seeing the latest public Reels.`

In this mode the API does not issue For You event tokens and optional Reel open/watch/completion/skip signals are not collected.

## Privacy Contract

The implementation is rule-based and does not use ML, LLM ranking, embeddings, global popularity, follower counts, view counts, raw watch time, raw completion percentages, external data, private conversations, Moments, AI content, or reports as ranking inputs.

Reel affinity is stored separately from post affinity using `surface: "reels"`.

## Validation

Durable smoke coverage is tracked by:

```text
pnpm smoke:release-e-reels-for-you
```

The suite covers authentication, eligibility, ranking inputs, event-token separation, bounded watch signals, explanations, personalization-disabled fallback, reset/export/deletion compatibility, Browse isolation, post For You isolation, and global search isolation.
