# Release D Communities

Release D Batch 3 adds authenticated Communities, membership modes, roles, Community posts, interactions, and moderation foundations.

## Scope

Included:

- Community creation and profile editing
- Canonical lowercase handles under `/c/:handle`
- Open, approval-required, and private membership modes
- Hashed invite tokens for private joining
- Owner, admin, moderator, and member roles
- Community-only posts, flat comments, and fixed reactions
- Posting policy and individual posting restrictions
- Basic member moderation controls and moderation activity logs
- Community target support in protected reports
- Account export/deletion compatibility

Excluded:

- Public anonymous Community pages
- Discovery, recommendations, trending, global Community search
- Chat channels inside Communities
- Events, polls, reposts, mentions, hashtags, nested comments, comment reactions
- Push notifications for Community posts
- AI summaries or shared-content indexing for Community content

## Service Ownership

Communities are owned by the `users` service. Community memberships are not chat participants, and Community posts are not profile feed posts. This separation prevents Community content from appearing in chat search, shared content, profile feeds, global feed routes, AI summaries, Moments, or chat exports.

## API Surface

The gateway proxies:

- `/api/communities`
- `/api/community-posts`

All routes require authentication. Authorization is enforced by active account state, membership, role, ban state, posting policy, individual restrictions, and block relationships.

## Validation

Durable validation is provided by:

- `pnpm smoke:release-d-communities`

The smoke suite should be run with the full Docker stack rebuilt and healthy, alongside the accepted Release A, B, C, D profiles, and D feed smoke suites.
