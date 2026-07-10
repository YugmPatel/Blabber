# Release G Batch 2 Performance And Scale Notes

This document captures local performance and scale hardening for the accepted Blabber surfaces. It does not make production capacity, throughput, p95 latency, global-scale, high-availability, or zero-downtime claims.

## Index And Query Posture

Existing Mongo indexes cover the accepted Release A-F and Release G Batch 1 surfaces broadly. Batch 2 inspection focused on query shapes that are safety-critical or worker-critical.

Auth refresh remains intentionally bounded to active sessions for one user. The lookup filters by user and non-revoked state, then preserves bcrypt comparison semantics for refresh-token rotation. No behavior was weakened, and refresh credentials are never logged.

Reel processing now records a server-owned processing lease for each claimed job and has an index that supports scanning stale `validating` and `processing` jobs by `processingStartedAt`.

## Reel Worker Recovery

The Reel processor previously claimed only `uploaded` jobs. A worker crash could leave a Reel in `validating` or `processing` indefinitely.

Batch 2 adds bounded stale recovery:

- eligible jobs are `uploaded`, or stale `validating`/`processing`
- deleted or deleted-publish-state Reels are excluded
- each claim receives a processing lease ID
- transitions to `validating`, `processing`, and `ready` require the active lease
- late workers cannot publish duplicate ready output
- late workers cannot clean another worker's active output after lease loss

This is a local reliability improvement, not a production high-availability claim.

## Notification Delivery

Notification delivery remains bounded and inline for the local architecture. The send route selects a bounded number of active verified mobile devices, fake-provider mode remains isolated for local runtime, invalid-token cleanup is retained, and temporary failures are not expanded into a broad queue architecture.

This posture is acceptable for the local Release G Batch 2 scope. A production queue, provider account, retry scheduler, or external observability system belongs to a later deployment phase.

## Controlled Contention

`scripts/release-g-hardening-smoke.mjs` performs conservative local contention checks with configurable concurrency:

- `RELEASE_G_HARDENING_CONCURRENCY`, default `4`, capped at `8`

The smoke uses authorized generated fixtures only. It verifies bounded concurrent reads and safe mutations do not produce unexpected 5xx responses and that readiness remains healthy afterward. Valid 429 responses are treated as enforcement.

## Validation

Tracked validation:

- `pnpm smoke:release-g-hardening`

The smoke avoids emitting timing traces, raw endpoint payloads, generated IDs, tokens, private content, media paths, or ranking internals.
