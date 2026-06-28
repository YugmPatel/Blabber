# Release B Operations

Release B operations coverage is exercised by:

```bash
pnpm smoke:release-b-operations
```

The smoke runs through the gateway and checks:

- gateway health and readiness
- clean media pending-to-approved upload flow
- unsafe upload rejection with the generic user message
- approved media attachment to a message
- group AI Intelligence disable and re-enable behavior
- personal AI history clearing
- protected push diagnostics with counters and no endpoints
- Mongo backup, guarded restore, and verification into a non-production DB
- output redaction guard for tokens and private payload bodies

Email readiness validates configuration only and does not send live mail. In production, email delivery fails startup if enabled without SMTP configuration unless account mail capture is explicitly enabled. Push readiness validates configuration only and does not send live push notifications. In production, push fails startup if enabled without VAPID configuration unless explicit mock mode is set.

Local Docker sets account mail capture on and push notifications off so local regression smokes do not depend on external providers.
