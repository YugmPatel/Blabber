# Release G Production Readiness

Release G Batch 3 Stage 1 prepares repository-controlled launch artifacts only.

## Ready In Repository After Stage 1

- Full media-suite blocker is resolved through current secure upload contract coverage.
- Production config verifier exists and fails closed for unsafe production settings.
- Provider-neutral release candidate and launch-gate command contracts exist.
- Web production build path runs TypeScript build before Vite build.
- Web API URL no longer silently falls back to localhost in non-local builds.
- Docker Node base tags are pinned to a Node 20 patch compatible with current Expo validation.
- Mobile release-readiness check reports structural readiness and missing store items.
- Provider-neutral deployment, rollback, push, legal/privacy/support, and final gate docs exist.

## Still Requires Provider Or Human Decision

- Production runtime.
- Registry and immutable artifact promotion.
- Production MongoDB and Redis.
- Production media storage/CDN.
- Push provider strategy and credentials.
- CI provider.
- Domains and CORS allowlists.
- Monitoring and alerting.
- Store accounts and submissions.
- Legal review.
- Support process.

## Explicit Non-Actions

- No deployment occurred.
- No cloud resource was created.
- No real provider was configured.
- No secret was created or rotated.
- No real push delivery occurred.
- No store action occurred.
- No legal compliance or store approval is claimed.
