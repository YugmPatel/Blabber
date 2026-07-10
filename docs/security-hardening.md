# Release G Batch 2 Security Hardening

This document records the local hardening posture for Release G Batch 2. It is not a production deployment guide and does not introduce real provider credentials, cloud infrastructure, app-store work, or launch workflow changes.

## Request Body Limits

Small structured API bodies are parsed through `packages/config/src/request-body.ts`. Gateway and service apps use the shared JSON parser options, and services that accept form-style structured bodies use the shared URL-encoded parser options.

The limit is intended for ordinary API mutations such as captions, comments, profile updates, notification preference changes, device registration payloads, reports, account lifecycle requests, and similar JSON or URL-encoded requests.

Large binary surfaces stay on explicit raw-body limits in `services/media/src/app.ts`:

- local media upload
- multipart media upload
- Reel source upload

The hardening smoke verifies oversized structured JSON and URL-encoded requests return normalized safe errors without exposing the configured limit value.

## CORS

CORS allowlists are loaded by `packages/config/src/cors.ts`. Credentialed CORS rejects wildcard origins at startup/config validation. Local explicit origins remain valid for web development, Docker smoke runs, and native/mobile clients that do not rely on browser CORS.

The hardening smoke verifies:

- a valid local browser origin is reflected
- a disallowed origin is not reflected
- the wildcard-with-credentials guard exists in the tracked config source

Do not configure `ALLOWED_ORIGINS=*` while credentials are enabled.

## Logger Redaction

`packages/utils/src/logger.ts` redacts authentication credentials, cookies, invite and verification links, push endpoints, private message bodies, AI prompt/context data, and Release G Batch 2 sensitive fields.

Additional redaction coverage includes:

- storage/object keys and local media paths
- media upload, manifest, segment, fallback, poster, and HLS URLs
- Reel captions and comment bodies when accidentally attached to structured logs
- playback, session, event, and candidate tokens
- recommendation scores, affinity values, candidate lists, and ranking internals
- mobile push tokens, verification challenges, provider receipts, device and install identifiers
- report evidence

Operational correlation remains available through request ID, service name, severity, route category, method, status code, and duration.

## Secrets And Local Defaults

`docker-compose.full.yml` is a local deterministic stack. It uses local-only development/test values and fake or mock providers where appropriate. These values are not production secrets and must not be promoted to production configuration.

The hardening smoke and final reports must not print secrets, tokens, raw provider endpoints, storage paths, private message content, Moment/Reel bodies, ranking internals, report evidence, or backup contents.

## Validation

Tracked validation:

- `pnpm smoke:release-g-hardening`

The smoke uses synthetic sentinel fixtures only and reports pass/fail totals without sensitive values.
