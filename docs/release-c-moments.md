# Release C Moments

Batch 1 adds the rich Moments foundation:

- Text Moments with controlled styles.
- Photo Moments through the existing approved upload pipeline.
- Moment privacy audiences: contacts, contacts except, only share with, and Close Friends Moments.
- Moment viewers for authors.
- Private Moment archive with 24-hour expiry processing.
- Block, account-state, and media authorization checks.

Video Moments, reactions, replies, notifications, reporting, public feeds, public profiles, and screenshot detection are intentionally deferred.

The public app language is Moments. Legacy internal `status` code and `/api/users/statuses` remain only for backward compatibility with the previous lightweight update implementation.

Validation:

- `pnpm smoke:release-c-moments`
- Existing Release A and Release B smokes remain required before acceptance.
