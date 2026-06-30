# Mobile Push Foundation

Release F Batch 3 introduces a native push foundation with explicit user consent, device verification, encrypted token storage, and generic payloads.

## Consent And Registration

- The app does not ask for notification permission at launch, sign-in, or session restore.
- Permission is requested only from the Mobile settings action.
- The app registers a native Expo token only after permission is granted.
- Logout/account deletion paths clear or disable device state through server-side ownership checks.

## Device Verification

- A registration creates a pending device record.
- Ordinary notification delivery requires `verifiedAt` and no `disabledAt`.
- Verification uses a short-lived challenge delivered through the configured provider.
- The challenge is not returned from normal API responses or deep links.
- Local smoke tests use the fake provider adapter to read the challenge without printing it.

## Server Storage

- Raw provider tokens are encrypted with AES-GCM using server-held key material.
- Token and installation identifiers are hashed for dedupe and lookup.
- Invalid-token results disable the device and increment push counters.
- Temporary failures increment failure counters without exposing provider tokens.

## Payloads And Navigation

- Mobile push payloads contain only a schema, kind, and opaque notification reference.
- Notification bodies, message bodies, Moment bodies, Reel captions, media paths, and private action content are not placed in native push payloads.
- Push taps resolve by fetching the server notification, then routing through the existing allowlisted mobile deep-link parser.
- No push-open analytics are added.
