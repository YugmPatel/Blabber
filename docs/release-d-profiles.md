# Release D Profiles

Release D Batch 1 adds the social foundation for profiles and follow relationships without adding posts, discovery, recommendations, public Moments, mentions, or creator tools.

## Architecture

- Users service owns profile fields, handle validation, profile serialization, and follow relationships.
- Gateway proxies `/api/profiles/*` to the users service and rate-limits profile updates, views, and follow actions.
- Realtime profile/follow events are minimal invalidations delivered only to affected authenticated user rooms.
- Auth account deletion/export processors remove or export the new profile/follow data safely.

## API Surface

All routes require authentication.

- `GET /api/profiles/me`
- `PATCH /api/profiles/me`
- `PATCH /api/profiles/me/handle`
- `GET /api/profiles/:handle`
- `POST /api/profiles/:handle/follow`
- `DELETE /api/profiles/:handle/follow`
- `POST /api/profiles/:handle/cancel`
- `GET /api/profiles/:handle/followers`
- `GET /api/profiles/:handle/following`
- `GET /api/profiles/requests/incoming`
- `POST /api/profiles/requests/:requesterHandle/approve`
- `POST /api/profiles/requests/:requesterHandle/decline`
- `DELETE /api/profiles/:handle/follower`

## UI

Settings includes social profile controls for handle, bio, website, visibility, counts, and incoming follow request review. `/p/:handle` renders the authenticated profile view with follow, requested, following, and locked-private states.

## Smoke

Run:

```sh
pnpm smoke:release-d-profiles
```

The smoke validates health/readiness, optional handles, handle validation, private/public profile visibility, follow request approval/decline/cancel, public follow/unfollow, block revocation, and that follow relationships do not grant Moment access.
