# Reels For You Ranking

Reels For You is a rule-based, privacy-preserving recommendation surface for public, discoverable Reels. It does not use ML, LLMs, embeddings, vector search, popularity, follower counts, view counts, global engagement totals, watch-time leaderboards, device fingerprints, external browsing data, private messages, Moments, AI data, reports, or Community member rosters.

## Eligibility

A Reel must be rechecked before each page and playback:

- viewer is an active authenticated user
- Reel is active, published, ready, public, discoverable, and has one to three controlled Reel topics
- media remains approved and deliverable
- author is active, email verified, has a handle, has a public profile, and has creator discovery enabled
- viewer and author have no block relationship
- Reel is not hidden by the viewer
- creator is not muted by the viewer
- Reel topics are not all muted by the viewer
- Reel is not authored by the viewer

Browse uses the same safety eligibility and remains deterministic newest-first.

## Candidate Generation

Candidate generation is bounded to public discoverable Reels from the last 30 days, sorted newest-first, with a hard maximum of 500 candidates before eligibility filtering. It uses indexed Reel fields and does not scan private content or store candidate lists in exports.

## Ranking Inputs

When personalization is enabled, the scorer can use:

- followed creators
- followed topics
- Reel-surface creator affinity
- Reel-surface topic affinity
- positive Reel interactions: reactions, comments, saves
- bounded watch events: open, watch bucket, completion bucket, quick skip
- freshness
- non-sensitive topic overlap from joined open/listed Communities

Affinity is isolated with `surface: "reels"` so text/photo For You affinity remains separate from Reel affinity.

When personalization is disabled, Reels For You falls back to latest public eligible Reels and does not use follows, followed topics, affinities, interactions, or watch signals as ranking inputs.

## Sessions And Explanations

Each For You request uses a short-lived user-bound session. The client receives an opaque cursor. The database stores only:

- a hash of the session token
- user id
- ranking model version
- ordered Reel ids
- safe explanation codes and optional safe labels
- timestamps and expiry

Sessions do not store scores, raw tokens, media paths, candidate lists, captions as ranking state, viewer lists, or other-user behavior.

Explanations are safe text derived from stored explanation codes, such as followed creator, followed topic, creator affinity, topic affinity, fresh topic Reel, new public Reel, or latest public Reel. Explanations do not reveal scores, watch behavior, other users, Community membership details, private content, tokens, or storage paths.

## Controls And Lifecycle

Personalization reset deletes Reel personalization events, candidate tokens, Reel affinities, and For You sessions. It keeps intentional controls such as hides, mutes, reactions, comments, saves, follows, and topic preferences.

Account export includes `my-reel-personalization-data.json` with safe signal categories and affinity metadata. It excludes scores, tokens, raw watch time, raw completion percentages, candidate lists, media paths, and private content.

Account deletion and Reel deletion remove or invalidate associated Reel For You session state.
