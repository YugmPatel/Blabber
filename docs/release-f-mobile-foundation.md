# Release F Mobile Foundation

## Scope

Release F Batch 1 adds the mobile app foundation, secure mobile auth, protected navigation, read-focused product surfaces, messaging core, and authorized Reel playback readiness.

Implemented surfaces:

- Sign-in, sign-up, forgot-password guidance, and secure logout.
- Protected app tabs for Home, Discover, Messages, Notifications, and Profile.
- Profile, Community, Chat, and Reel detail routes.
- Read-only feed, discovery, profile, community, Reel, and notification views.
- Text message send in existing chats.
- Socket.IO lifecycle with auth payload token delivery.
- Future upload picker helpers without automatic camera or push permission prompts.

## Backend Contracts

Auth service:

- Adds mobile JSON-token endpoints under `/mobile/*`.
- Stores refresh credential hashes in the existing device session collection.
- Rotates refresh credentials on refresh.
- Keeps the existing web cookie flow intact.

Notifications service:

- Adds an authorized inbox list endpoint.
- Adds an authorized read marker endpoint.
- Records in-app inbox items from existing notification send events.
- Does not register mobile push tokens.

Gateway:

- Existing proxy routing exposes the mobile contracts through `/api/*`.
- Mobile auth endpoints use the existing auth/session rate limit buckets.

## Validation Commands

Mobile checks:

```sh
EXPO_PUBLIC_API_BASE_URL=https://api.example.invalid pnpm mobile:typecheck
EXPO_PUBLIC_API_BASE_URL=https://api.example.invalid pnpm mobile:lint
EXPO_PUBLIC_API_BASE_URL=https://api.example.invalid pnpm mobile:test
EXPO_PUBLIC_API_BASE_URL=https://api.example.invalid pnpm mobile:config-check
EXPO_PUBLIC_API_BASE_URL=https://api.example.invalid pnpm mobile:export:android
EXPO_PUBLIC_API_BASE_URL=https://api.example.invalid pnpm mobile:export:ios
pnpm smoke:release-f-mobile-foundation
```

Regression acceptance still requires the tracked Release A through Release F smoke suites against the rebuilt Docker stack.

## Known Limits

No physical device or emulator QA is claimed from static export validation. App Store, Play Store, push notification registration, analytics, crash reporting, offline private cache, and background media upload are not part of this batch.

