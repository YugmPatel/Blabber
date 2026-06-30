# Release F Mobile Reliability

Release F Batch 3 completes mobile reliability work across native Reel publishing, playback lifecycle handling, and the push foundation.

## Implemented

- Native Reel upload from camera roll using the existing secure Reels backend.
- Upload states for selection, preparation, upload, scanning, processing, ready, publish, cancel, retry, and unavailable outcomes.
- Single-active-player Reels feed behavior with background pause/release and foreground reauthorization.
- Detail-screen playback lifecycle cleanup and bounded retry.
- Explicit opt-in native push registration in Mobile settings.
- Server-side mobile push device registration, verification, encrypted token storage, dedupe, invalid-token cleanup, and generic delivery payloads.
- Safe notification tap routing through server notification lookup and the allowlisted parser.

## Guardrails Preserved

- No camera capture or camera permission.
- No WebView.
- No analytics/ad SDK.
- No background resumable uploads.
- No persistent local video draft URI.
- No persistent video/playback cache.
- No raw provider token, push endpoint, invite URL, storage path, private content, viewer list, or AI content in smoke output.

## Validation

The tracked command is:

```bash
pnpm smoke:release-f-mobile-reliability
```

It validates the mobile static contract and backend push/Reel delivery guardrails against the rebuilt Docker stack.
