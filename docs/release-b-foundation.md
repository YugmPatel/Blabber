# Release B Foundation Notes

## Test Isolation

Service Vitest setup files should call `configureTestServiceEnv` from `@repo/config`.
It normalizes `TEST_MONGO_URI`, `TEST_MONGO_DB_NAME`, and service defaults into the runtime env before service modules load.

Test database names must be visibly test-only. Allowed names start with `test_`, end with `_test`, or contain `_test_`.
Production-like database names are rejected in test mode.

Local service tests expect isolated Mongo and Redis instances. A safe local dependency-only startup is:

```sh
docker compose -f docker-compose.full.yml up -d mongodb redis
```

Run DB-backed suites with explicit test env names and host ports:

```sh
TEST_MONGO_URI=mongodb://localhost:27018 TEST_MONGO_DB_NAME=test_auth TEST_REDIS_PORT=6380 corepack pnpm --filter @services/auth test
TEST_MONGO_URI=mongodb://localhost:27018 TEST_MONGO_DB_NAME=test_chats TEST_REDIS_PORT=6380 corepack pnpm --filter @services/chats test
TEST_MONGO_URI=mongodb://localhost:27018 TEST_MONGO_DB_NAME=test_messages TEST_REDIS_PORT=6380 corepack pnpm --filter @services/messages test
```

Never point `TEST_MONGO_URI` or `TEST_MONGO_DB_NAME` at development, staging, or production data. The guard fails closed for non-test database names, and suites clean only their selected test database collections.

Messages and chats run DB-heavy tests in a single fork so per-file cleanup cannot race shared chat/user fixtures.
If a suite needs new cross-service fixtures, seed them inside the selected test database and include matching cleanup in that suite.

## Runtime Config Safety

Config loaders use safe parse errors from `@repo/config` and do not log raw env payloads.
Production rejects unsafe defaults such as localhost Mongo/Redis and development-looking JWT secrets.

## Health And Readiness

Services expose:

- `/healthz` for liveness.
- `/readyz` for dependency readiness.

Readiness responses include dependency names and status only.

## Logging And Errors

Shared HTTP middleware adds request IDs, structured request logs, and production-safe error responses.
Logger redaction covers auth tokens, reset/invite tokens, push endpoints, request bodies, prompts, and context fields.

Gateway socket logs should pass safe error summaries, not full Axios errors, to avoid leaking internal URLs or request config.

## Rate Limiting

Gateway sensitive route limiting is Redis-backed when Redis is available and emits `Retry-After` on `429`.
It targets auth entry points and high-risk messaging/collaboration mutations.

## Refresh Tokens

Refresh tokens are SHA-256 digested before bcrypt hashing so bcrypt's 72-byte input limit cannot create token-prefix collisions.
Legacy device sessions stored with raw refresh-token bcrypt hashes are intentionally rejected after this change; users with those sessions must sign in again.
