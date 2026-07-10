# Staging Rollout And Rollback

This is a provider-neutral launch artifact. It does not deploy anything.

## Staging Requirements

- Separate staging environment.
- Separate staging MongoDB, Redis, media storage, and secrets.
- Test accounts only.
- Explicit safe fake/test provider boundaries.
- Separate staging domains and CORS allowlist.
- Staging backup and restore plan.
- Full smoke and launch-gate validation.
- Human approval before production promotion.

## Rollout Requirements

- Deploy immutable artifact built once.
- Run readiness checks before traffic.
- Verify gateway, services, web, media, push-disabled or push-staging behavior, and mobile API compatibility.
- Keep previous artifact available.

## Rollback Requirements

- Roll back to the prior known-good artifact reference.
- Do not rebuild from a branch during rollback.
- Confirm database/schema compatibility before rollback.
- Prefer feature/config rollback when safer than binary rollback.
- Disable push delivery if provider behavior is suspect.
- Preserve media and queue safety; do not delete newly uploaded media during rollback unless a separate incident plan approves it.

## Incident Requirements

- Support escalation path.
- Status communication owner.
- Post-incident review.
- Follow-up action tracking.

## Requires Provider Decision

- Runtime deployment method.
- Database migration/backup tooling.
- Traffic shifting method.
- Monitoring and alerting system.
- Incident management process.
