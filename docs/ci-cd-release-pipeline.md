# CI/CD Release Pipeline Contract

No CI provider is selected yet. Do not add provider-specific workflow files until the provider, registry, deployment platform, database, Redis, media/CDN, and push strategy are selected.

## Ready In Repository

- Provider-neutral command contract: `pnpm verify:release-candidate`
- Production config verifier: `pnpm verify:production-config`
- Launch artifact gate: `pnpm verify:launch-gate`
- Existing release smoke scripts from Release A through Release G.

## Release Candidate Contract

Future CI must execute the same immutable command contract against the same source and artifacts:

```sh
pnpm verify:release-candidate
```

Current Stage 1 behavior is dry-run only. It lists the required commands and performs no deployment, upload, tag creation, or provider call.

## Future Artifact Promotion Model

1. Build once.
2. Produce immutable artifact/image reference.
3. Test exactly that artifact in staging.
4. Record human approval.
5. Promote the same artifact reference to production.
6. Retain the prior known-good artifact reference.
7. Roll back by redeploying the prior artifact, not rebuilding from a branch.

## Requires Provider Decision

- CI platform
- container registry
- artifact retention policy
- vulnerability scanning approach
- staging deployment target
- production deployment target
- approval and rollback mechanism

## Not Included

- No `.github/workflows` or equivalent provider file.
- No registry integration.
- No deployment automation.
- No release/tag creation.
