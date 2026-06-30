# Release F Mobile Social

Release F Batch 2 adds the mobile core social experience on top of the Release F mobile foundation.

## Mobile Workflows

- Home supports native text/photo post publishing, reactions, comments, and reporting.
- Profile supports safe-field edits, approved avatar upload, follow request decisions, and follower removal.
- Public profiles support follow, unfollow, and request cancellation.
- Moments has a native tab for text/photo creation, viewing, reactions, replies, and archive actions.
- Communities support join/request/cancel, member text posts, reactions, comments, and reports.
- Notifications support inbox read state and safe in-app routing.
- Mobile settings expose existing notification and discovery preferences.

## Validation

Run:

```bash
pnpm mobile:typecheck
pnpm mobile:lint
pnpm mobile:test
pnpm mobile:config-check
pnpm mobile:export:android
pnpm mobile:export:ios
pnpm smoke:release-f-mobile-foundation
pnpm smoke:release-f-mobile-social
```

Expected Release F Batch 2 smoke result:

```text
34 passed, 0 failed
```

Full release acceptance also requires all previously accepted Release A, B, C, D, E, and Release F foundation smoke suites to pass unchanged.
