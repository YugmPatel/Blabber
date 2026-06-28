# Upload Security

Blabber uploads are quarantined by default. A media record starts as `pending`, moves to `scanning`, and is attachable or downloadable only after it becomes `approved`.

The server validates filenames, extensions, declared MIME type, and magic bytes. Images allow JPEG, PNG, WebP, and GIF. Documents allow PDF, TXT, CSV, DOC, DOCX, XLS, XLSX, PPT, and PPTX. Existing audio types remain allowed. Executables, scripts, installers, disk images, archives, HTML, SVG, macro Office files, unknown types, and deceptive double extensions are rejected with the generic user message `This file could not be uploaded.`

Default limits are 10 MB for images, 25 MB for documents, 25 MB for audio, 30 MB per message attachment payload, and 500 MB per user per rolling day. These can be overridden with `MEDIA_MAX_IMAGE_BYTES`, `MEDIA_MAX_DOCUMENT_BYTES`, `MEDIA_MAX_AUDIO_BYTES`, `MEDIA_MESSAGE_TOTAL_BYTES`, and `MEDIA_USER_DAILY_QUOTA_BYTES`.

Scanning is pluggable through `MEDIA_SCANNER_MODE`. Production defaults to `clamav` and fails closed if the scanner is unavailable. Local Docker explicitly uses `mock` unless overridden, and includes a ClamAV container for production-like runs.

Approved media is rechecked before message creation, forwarding, shared content listing, and local file serving. Local file responses use `nosniff`, private cache control, sanitized inline filenames, and cross-origin resource policy headers for the web client.
