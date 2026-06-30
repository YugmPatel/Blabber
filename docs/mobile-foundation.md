# Mobile Foundation

Release F Batch 1 introduces the Expo mobile workspace at `apps/mobile`.

## Stack

- Expo SDK 56 with Expo Router.
- React Native 0.86 and React 19.
- TypeScript strict mode.
- `expo-secure-store` for the mobile refresh credential.
- `socket.io-client` for Gateway Socket.IO connections.
- `expo-video` for authorized Reel playback readiness.
- `expo-image-picker` and `expo-file-system` are present for future user-initiated media upload flows.

## Configuration

The app requires `EXPO_PUBLIC_API_BASE_URL`.

No production localhost fallback is provided. Local insecure HTTP is accepted only when all of the following are true:

- `NODE_ENV` is not `production`.
- `EXPO_PUBLIC_ALLOW_INSECURE_LOCAL_API=true`.
- The configured host is explicitly local.

Use `apps/mobile/.env.example` as the template.

## Authentication

Mobile auth uses Gateway-routed endpoints:

- `POST /api/auth/mobile/register`
- `POST /api/auth/mobile/login`
- `POST /api/auth/mobile/refresh`
- `POST /api/auth/mobile/logout`
- `GET /api/auth/mobile/session`

The access token is memory-only. The refresh credential is stored in SecureStore and rotated by the server during refresh. Logout clears the server session when possible and always clears local private state.

The existing web cookie refresh flow remains unchanged.

## Protected Navigation

The root app waits for auth restoration before rendering protected routes. Anonymous users are redirected to sign-in. Private screens do not render cached private content before restore completes.

## Deep Links

Only these route targets are accepted:

- profile
- community
- reel
- chat
- discover
- notifications

Links carrying token, refresh, playback, manifest, invite, reset, verification, media, or storage-style parameters are rejected.

## Messaging And Sockets

The mobile app reads chats and messages through Gateway APIs and sends text messages through the existing message contract. Socket.IO authenticates with the `auth` payload and does not place tokens in query strings. Socket lifecycle follows app foreground/background state.

## Reels

The Reel detail screen fetches Reel metadata, requests an authorized playback session, and passes the access token as a request header to the native video player. Playback URLs, manifests, segments, and storage paths are not persisted by the mobile app.

## Notifications

Release F Batch 1 adds an authorized in-app notification inbox read path. Native push registration and device push tokens are deliberately not activated in this batch.

## Privacy Boundaries

The mobile foundation does not include:

- AsyncStorage for private app data.
- WebView auth bridges.
- analytics SDKs.
- crash reporting SDKs.
- push token registration.
- durable private timeline, message, notification, or playback caches.

