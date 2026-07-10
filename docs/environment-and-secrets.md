# Environment And Secrets Readiness

This document classifies configuration. It must not contain real secret values.

## Ready In Repository

- `.env` files are ignored by Git.
- `.env.example` documents local configuration categories.
- Shared config modules validate MongoDB, Redis, JWT, CORS, request body limits, VAPID, and safe test database behavior.
- `pnpm verify:production-config` provides provider-neutral fail-closed production config validation.

## Environment Separation

Every release environment must be explicit:

- `local`
- `test`
- `staging`
- `production`

Production verification requires `NODE_ENV=production` and `APP_ENV=production`.

## Server-Only Categories

These categories must never use public web/mobile prefixes:

- database URLs
- Redis credentials
- JWT secrets
- encryption keys
- SMTP credentials
- OAuth credentials
- VAPID private key
- provider API tokens
- internal service tokens
- ops diagnostic tokens

## Public Runtime Categories

Only intentional public values may use `VITE_` or `EXPO_PUBLIC_`:

- public API base URL
- public socket URL
- public LiveKit URL
- public media URL when safe for clients
- explicit local-development toggles

## Production Rejects

Production config must fail closed for:

- localhost or local-only endpoints
- deterministic development secrets
- placeholder-looking values
- wildcard CORS origins
- insecure production cookie settings
- fake/mock provider modes
- mock media scanner mode
- fake mobile push mode
- public secret-like variable names
- missing production API URLs

## Validation

```sh
pnpm verify:production-config -- --fixture scripts/fixtures/production-config.valid.json
pnpm verify:production-config:test
```

The fixtures are synthetic and harmless. The verifier prints only categories, variable names, and pass/fail summaries.
