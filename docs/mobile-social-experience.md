# Mobile Social Experience

Release F Batch 2 extends the Expo app with native social workflows that use the existing Gateway APIs.

## Included

- Text and photo post creation from the Home tab.
- Mobile image upload through `POST /api/media/presign` followed by authenticated `PUT /api/media/local/:id`.
- Profile editing for name, bio, HTTPS website, visibility, and approved uploaded avatar images.
- Follow, follow-request cancel, incoming request approval or decline, and follower removal.
- Moments viewing, text/photo creation, view marking, reactions, replies, and archive actions.
- Community join/request/cancel, text post creation, reactions, comments, and reporting.
- Notification inbox read state and mobile settings for notification and discovery preferences.

## Privacy And Storage

The mobile app keeps access tokens in memory and stores only the refresh credential in SecureStore. Upload URLs, picked local URIs, raw media identifiers, audience snapshots, viewer lists, notification bodies, and message bodies are not persisted by the mobile app.

Upload cancellation clears in-memory upload controllers and transient references during logout/session cleanup. The app does not add background or resumable uploads.

## Explicitly Not Included

- WebView wrappers.
- Native push registration.
- Camera capture.
- Native Reel publishing or recording.
- Analytics, tracking, crash-reporting SDKs.
- Persistent private media cache.

## Server Authority

Authorization, rate limits, media scanning, profile privacy, Moment audience checks, Community membership, reporting, and notification preference ownership remain enforced by backend services. The mobile app only presents controls and sends requests through Gateway.
