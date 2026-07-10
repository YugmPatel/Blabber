# Release G Cross-Platform QA

Release G Batch 1 adds the durable QA command:

```bash
pnpm smoke:release-g-cross-platform-qa
```

The suite contains 60 explicit checks across Docker health, auth/session contracts, web route protection, mobile secure storage, mobile exports/scripts, profile/post/community/Moment/Discover/Reels server contracts, Socket.IO, notifications, fake push foundation, accessibility contracts, theme contracts, fixture isolation, and sensitive-output boundaries.

## Product Fixes

- `apps/web/src/components/ProtectedRoute.tsx` received a minimal accessibility fix for the loading state.

## Test-Harness Additions

- `scripts/release-g-cross-platform-qa-smoke.mjs` adds the Release G QA smoke.
- `package.json` registers `smoke:release-g-cross-platform-qa`.

## Documentation Additions

- `docs/cross-platform-qa.md`
- `docs/accessibility-qa.md`
- `docs/release-g-cross-platform-qa.md`

## Validation Boundaries

The batch is not production deployment validation and is not store-launch validation. It does not claim browser automation, physical-device testing, emulator/simulator testing, real push-provider delivery, assistive-technology testing, TestFlight, Play Store, or App Store validation.

## Full Regression Requirement

Release A through Release F Batch 3 smoke suites remain the accepted regression boundary and must run alongside the new Release G QA smoke before claiming completion.
