# Cross-Platform QA

Release G Batch 1 is a deterministic QA baseline for the accepted Blabber web and mobile product. It does not add social features, recommendation features, production deployment work, store workflows, analytics, ads, or new provider integrations.

## Tools Actually Used

- Node smoke scripts through `pnpm`.
- Docker Compose full stack health/readiness checks.
- Supertest/Vitest-capable service and web test infrastructure where invoked by existing scripts.
- Web production build through `apps/web`.
- Expo mobile JavaScript checks and exports through `apps/mobile`.
- Static source checks for accessibility, routing, privacy, secure storage, deep links, push contracts, and lifecycle behavior.
- Existing fake mobile push provider contract only.

## Not Claimed

No browser automation, responsive screenshot testing, physical iOS or Android device testing, simulator/emulator testing, VoiceOver/TalkBack testing, formal WCAG certification, real APNs/FCM/Expo delivery, TestFlight, Play Store, App Store, or production deployment validation was performed.

## Matrix

- Auth/session: web `AuthContext`, web `ProtectedRoute`, mobile `AuthProvider`, mobile `Protected`, mobile SecureStore, logout cleanup, refresh failure cleanup, account deletion processors.
- Profiles/follows/blocks: server profile routes, relationship state, private/public visibility, block composition.
- Posts/media/comments/reactions: users posts routes, approved-media checks, comment/reaction/report authorization, feed isolation.
- Communities: community routes, membership/request/ban/restriction models, private/invite unavailable behavior, discussion isolation.
- Moments: audience routes, close friends, archive/viewer/reaction/reply protections, search/feed isolation.
- Discover and For You: users discovery routes, preference reset, hide/mute controls, candidate/session separation.
- Reels: media upload, scan, processing, playback sessions, Browse, Reels For You, interactions, hide/mute/block/delete revocation, mobile lifecycle.
- Messaging/notifications/push: Gateway Socket.IO auth, notification preferences, notification inbox, deep-link parsing, fake mobile push registration/verification/delivery cleanup.
- Web quality: route registration, protected route state, API client contract, production build.
- Mobile quality: typecheck, lint, unit, config validation, Android/iOS JS exports, no WebView/camera/analytics/private persistent cache.

## Fixtures And Rate Limits

The Release G smoke uses a unique `release-g-qa-*` run id and controlled throwaway account data. It avoids printing fixture values and uses existing Gateway rate limits. If a normal limiter window is hit during full regression validation, the affected suite is rerun from the beginning after cooldown rather than weakening product configuration.

## Sensitive Data Boundaries

The QA docs and smoke output avoid secrets, access tokens, refresh credentials, passwords, message/post/comment bodies, Moment audience/viewer data, media ids, local URIs, storage paths, playback URLs, push tokens, verification challenges, provider receipts, report evidence, ranking scores, affinity data, and private Community data.
