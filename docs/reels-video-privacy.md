# Reels Video Privacy

Release E Batch 1 adds the secure Reels foundation only. Reels are authenticated-only short videos with server-side upload, validation, processing, authorization, and profile listing.

## Scope

Supported source input is MP4 with H.264 video and optional AAC audio. Source videos must be 3 to 90 seconds, at most 100 MB, at most 1920 by 1920 pixels, at most 60 fps, and at most 20 Mbps. Batch 1 does not support MOV, WebM, AVI, MKV, GIF, HEVC, VP9, AV1, external imports, custom thumbnails, editing tools, Reels recommendations, autoplay, comments, reactions, shares, Community Reels, livestreaming, or anonymous pages.

## Processing

Source upload is owned by the media service. The source is scanned and stored as internal Reel source media. A background media processor runs ffprobe and FFmpeg outside request handlers. It validates container, streams, codecs, duration, dimensions, frame rate, and bitrate, then generates a normalized MP4 fallback, HLS segments, and a server-generated poster. Output commands use argument arrays and bounded timeouts. Metadata is stripped from normalized outputs.

## Playback

Playback uses short-lived opaque sessions stored by hash. Each manifest, segment, fallback MP4, and poster request re-checks the current session, viewer, Reel, author account, block state, profile visibility, follow relationship, processing status, deletion state, and moderation state. Raw storage paths, media IDs, HLS paths, segment paths, and source URLs are not exposed in the API.

## Visibility

Reels support Public and Followers visibility. Public Reels are still authenticated-only. Private profiles force non-owner access to accepted followers. Blocks, profile privacy changes, follow removal, account deactivation, deletion, and moderation removal revoke access because every playback request re-authorizes.

## Cleanup And Export

Reel deletion revokes playback sessions and marks source/derivative media deleted. Account deletion removes authored Reel records, playback sessions, and Reel media records. Data export includes safe authored Reel metadata only and excludes video files, playback tokens, manifests, segment URLs, storage paths, report evidence, viewer behavior, and unrelated chat/Moment/AI data.

## Isolation

Batch 1 Reels are not included in Feed, Discover, For You, Communities, Moments, chats, search, Shared Content, forwarding, saved messages, AI, or profile photo/text posts.
