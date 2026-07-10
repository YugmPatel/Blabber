# Push Production Readiness

No real push provider is enabled by this document.

## Ready In Repository

- Web push config/readiness paths exist.
- Mobile push registration, verification, deregistration, token hashing/encryption, invalid-token cleanup, and preference gating exist.
- Local fake mobile push provider exists for deterministic smoke validation.
- Production config verification rejects fake/mock push provider modes for production.

## Fake Provider Limitations

- It does not prove Expo, APNs, or FCM delivery.
- It does not validate native entitlements.
- It does not validate receipt monitoring.
- It must not silently run under production target configuration.

## Required Decisions

- Expo Push versus direct APNs/FCM.
- Credential ownership.
- Test account/device setup.
- Native entitlement/configuration.
- Token lifecycle validation.
- Provider receipt monitoring.
- Invalid token cleanup policy.
- Disable and rollback path.

## Staging Requirements

- Explicit staging push mode.
- Test devices only.
- No raw push tokens or payload content in logs.
- Provider receipts summarized safely.
- Human approval before enabling production delivery.

## Production Gate

Production push cannot be claimed until a real provider is configured and verified on real devices.
