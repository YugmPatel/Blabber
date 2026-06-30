# Mobile Reels Reliability

Release F Batch 3 adds native camera-roll Reel publishing and tightens mobile playback reliability without adding camera capture, WebView playback, or persistent video caches.

## Publishing Contract

- Reel creation starts only from an explicit user action in the native Reel creator.
- The app requests media-library access only when the user chooses a video.
- The selected local URI, upload URL, and draft Reel id are held only in transient memory.
- Retry starts a fresh server upload contract rather than reusing an expired URL.
- Cancel aborts the active controller and asks the backend to delete the draft Reel.
- Publishing is allowed only after the server reports the Reel is ready.
- Public discoverability remains server-authoritative; the client may request topics and discoverability, but the backend enforces creator/profile eligibility.

## Playback Contract

- The Reels tab has one active Reel at a time.
- Only the active Reel requests a playback session and event token.
- Inactive and adjacent Reels are limited to metadata/poster-level preparation.
- Backgrounding the app clears playback state and pauses the player.
- Returning to foreground requires fresh authorization through a new playback session.
- Playback retries are bounded to avoid repeated session creation on unstable networks.
- Watch/open signals are not sent while the app is backgrounded or when session/event authorization fails.
- No persistent HLS, segment, fallback, poster, playback token, or event token cache is used.

## Exclusions

- No camera capture or camera permission.
- No persistent local drafts containing device file URIs.
- No WebView playback.
- No new ranking/watch telemetry outside the existing Reels event-token flow.
