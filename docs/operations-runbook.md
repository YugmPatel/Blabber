# Release G Batch 2 Operations Runbook

This runbook covers the local Docker full stack for Release G Batch 2 validation. It is not a production deployment plan.

## Local Stack

Start or rebuild the full stack with:

```sh
docker compose -f docker-compose.full.yml up -d --build
```

Check service state with:

```sh
docker compose -f docker-compose.full.yml ps
```

Expected application services:

- gateway
- auth
- users
- chats
- messages
- media
- notifications
- web

Expected dependencies:

- mongodb
- redis
- clamav
- livekit

## Health And Readiness

Each application service exposes inexpensive non-sensitive health and readiness endpoints.

Gateway readiness checks downstream application services and returns only summarized check names/statuses. Service readiness checks required dependencies such as Mongo, Redis, email configuration, and push configuration where applicable.

Readiness must not expose connection strings, queue contents, credentials, storage paths, provider tokens, private counts, or raw topology details.

## Local Restart Guidance

For local validation, restart dependencies before application services when recovering from a failed dependency state:

```sh
docker compose -f docker-compose.full.yml restart mongodb redis
docker compose -f docker-compose.full.yml restart auth users chats messages media notifications gateway web
```

If only Reel processing behavior changed, rebuilding/restarting `media` is usually sufficient after dependencies are healthy.

This runbook does not claim zero-downtime restart behavior.

## Diagnostics

Push diagnostics are guarded by the notifications ops token and must not be exposed publicly. Local fake push mode is the expected validation mode unless explicitly configured otherwise.

Logs should retain operational correlation fields such as service, request ID, route category, status, and duration. Logs must not contain raw tokens, cookies, media paths, private content, ranking internals, provider receipts, or report evidence.

## Tracked Validation

Run Release G Batch 2 validation through the repository Docker workspace pattern where `pnpm` is available:

```sh
pnpm smoke:release-g-hardening
```

After product code changes, rerun the accepted smoke matrix as required by the release task.
