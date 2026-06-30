# Release E Batch 1: Video Foundation

Batch 1 implements secure short-video upload, server validation, background processing, authorized playback, basic publishing, profile Reels, reporting, export/deletion compatibility, and documentation.

## API

- `POST /api/reels/upload-init`
- `PUT /api/reels/uploads/:reelId/source`
- `GET /api/reels/:reelId/status`
- `POST /api/reels`
- `GET /api/reels/:reelId`
- `PATCH /api/reels/:reelId`
- `DELETE /api/reels/:reelId`
- `GET /api/profiles/:handle/reels`
- `POST /api/reels/:reelId/playback-session`
- `GET /api/reels/playback/:sessionToken/manifest`
- `GET /api/reels/playback/:sessionToken/segment/:segmentToken`
- `GET /api/reels/playback/:sessionToken/fallback`
- `GET /api/reels/playback/:sessionToken/poster`
- `POST /api/reels/:reelId/report`

All routes are authenticated. Playback sessions are short-lived, user-bound, and hash-stored.

## Processing Lifecycle

`upload_initiated -> uploaded -> validating -> processing -> ready`

Failure states are `rejected` and `failed`; deletion sets `deleted`. Duplicate processor delivery is guarded by Mongo state transitions and deterministic output directories.

## Validation

ffprobe validates one H.264 video stream, optional single AAC audio stream, no subtitle/data/attachment streams, MP4 source, 3-90 second duration, bounded dimensions, bounded frame rate, and bounded bitrate. User-facing failures use generic video processing copy.

## UI

The web app adds:

- Create Reel page
- Profile Reels section
- Basic authorized Reel preview page

It does not add a swipe viewer, autoplay, recommendations, comments, reactions, shares, watch-time tracking, or analytics.

## Smoke

Run:

```bash
pnpm smoke:release-e-video-foundation
```

The smoke uses throwaway users and generated local MP4 fixtures through Docker. It checks upload gates, validation failures, processing, publishing, profile visibility, playback authorization, deletion, reporting, export/deletion lifecycle, and isolation from existing surfaces.
