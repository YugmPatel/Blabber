# Release D Discovery

Batch 4 adds the candidate, eligibility, feedback, and telemetry foundation for future personalized recommendations. It does not add a For You ranking engine.

## Scope

Implemented:

- Creator discovery opt-in for public verified profiles with handles.
- Controlled creator, post, and Community topics.
- Explicit post Discover opt-in for public profile posts.
- Owner-only listing for open Communities.
- Authenticated `/discover` browsing for topics, creators, public posts, and open Communities.
- Topic follow/mute controls.
- Not interested, muted creator, and muted Community controls.
- Personalized discovery setting and clear personalization action.
- Opaque candidate-token based Discover event collection.
- Bounded dwell buckets and event dedupe.
- 180-day optional signal retention.
- Safe export and account deletion cleanup.

## Non-Goals

Not implemented in this batch:

- Full For You ranking.
- Trending feed.
- Popularity ranking.
- Suggested people or Communities algorithm.
- Recommendation ML, embeddings, or collaborative filtering.
- Automatic text or image topic inference.
- Free-form tags or hashtags.
- Public anonymous discovery or web indexing.
- Video/Reels, audio posts, livestreams.
- Creator analytics, paid subscriptions, payouts.
- External analytics providers.

## Eligibility

Creator discovery requires an active verified account, claimed handle, public profile, explicit creator discovery toggle, and one to five controlled topics. Block relationships and viewer creator mutes suppress creator cards and posts.

Post discovery requires creator eligibility, public post visibility, explicit post Discover toggle, one to three controlled topics, active/non-deleted state, approved author-owned image media, no block relationship, and no viewer hide/mute suppression.

Community listing requires an active open Community, owner listing toggle, one to three controlled topics, active owner, no viewer ban, no applicable block restriction, and no viewer Community/topic mute. Private and approval-required Communities are never listed.

## Browsing

Discover browsing is deterministic newest-first with cursor pagination. There is no hidden recommendation score, popularity ranking, follower-count ranking, member-count ranking, or Trending logic.

## UI

The web app adds:

- `/discover` page with Browse topics, Discover creators, Public posts, Open Communities, and Your interests.
- Sidebar Discover navigation.
- Settings > Creator discovery.
- Settings > Discovery and personalization.
- Author-owned public post Discover controls.
- Owner-only open Community listing controls.

The UI uses existing light/dark theme patterns, accessible labels, safe empty states, and neutral Batch 4 copy.

## Privacy And Safety

Discovery is authenticated-only, server-authorized, block-aware, moderation-aware, media-safe, and deactivation/deletion-aware. Candidate tokens are opaque and hashed at rest. Dwell telemetry uses bounded buckets only. User feedback is private and never notifies the target.

Discovery data remains isolated from Feed authorization, Community member content, Moments, chat search, Shared Content, forwarding, AI, and Actions.

## Known Limitations

- No full For You ranking yet.
- No Trending feed.
- No video/Reels.
- No automatic topic inference.
- No free-form tags or hashtags.
- No recommendation ML model.
- No public anonymous browsing.
- No creator analytics dashboard.
- No push notification for new Discover content.
