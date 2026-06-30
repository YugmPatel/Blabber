# For You Ranking V1

For You V1 is an authenticated-only, rule-based recommendation feed for discoverable public personal-feed posts. It does not use ML training, embeddings, vector search, collaborative filtering, LLM ranking, image inference, global popularity, or anonymous public recommendations.

## Candidate Boundary

Candidates are limited to recent public personal-feed posts that are opted into Discover. Each page re-checks the current viewer against post, creator, block, mute, hide, topic, media, deletion, deactivation, profile visibility, verification, and creator discovery settings before returning anything. The viewer's own posts are excluded.

For You does not rank community posts, Moments, chats, comments as standalone items, AI content, documents, audio, video, polls, events, or sponsored content.

## Stored State

The recommender stores only bounded metadata:

- `discovery_affinities`: viewer ID, affinity type (`creator` or `topic`), affinity key, score, timestamps, expiry, and schema version.
- `discovery_for_you_sessions`: hash of an opaque session token, viewer ID, ranking model version, candidate post IDs, explanation codes, timestamps, expiry, and generation.
- `discovery_events`: existing Discover event metadata, extended with the `for_you` source context.

No raw post bodies, message bodies, Moment bodies, media paths, AI content, private community content, push endpoints, or viewer lists are stored in recommendation sessions.

## Scoring

Ranking model version: `for_you_v1`.

Signals are bounded and additive:

- followed creator: `+40`
- followed topic: `+18` per topic, max `+36`
- creator affinity: max `+30`
- topic affinity: max `+36`
- recent positive post signals: max `+20`
- freshness: max `+24`
- new creator/post exploration boost: `+8`
- recent open penalty: `-40`

Quality scoring is intentionally deferred in V1 and contributes `0`.

When personalization is disabled, candidates fall back to newest-first eligible posts and optional recommendation signals are not recorded.

## Diversity

After scoring, the feed applies a deterministic diversity pass:

- avoid adjacent posts by the same creator when alternatives exist
- cap a creator to two posts in the first page when enough alternatives exist
- cap a single topic to four posts in the first page when enough alternatives exist
- never duplicate a post within a session

## Explanations

Returned posts include a safe explanation code and text such as followed creator, followed topic, creator affinity, topic affinity, community topic interest, recent topic post, new public post, or recency fallback. Scores and raw affinity values are never exposed.

## Reset And Deletion

Personalization reset deletes discovery events, affinities, For You sessions, and candidate tokens for the viewer. Account deletion also removes owned affinities, sessions, candidate tokens, and sessions containing authored posts.
