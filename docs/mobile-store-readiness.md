# Mobile Store Readiness

This document separates structural mobile configuration from actual App Store or Play Store readiness.

## Ready In Repository

- Expo app configuration exists.
- API base URL is required explicitly.
- Local insecure API use requires explicit local-development opt-in.
- App scheme, iOS bundle identifier, and Android package identifier are configured.
- Mobile typecheck, lint, unit, config-check, and export scripts exist.
- `pnpm mobile:release-readiness` reports structural gaps without contacting stores.

## Requires Store Account Setup

- Expo/EAS account.
- Apple Developer account.
- Google Play Console account.
- Signing credentials.
- TestFlight setup.
- Android internal testing track.
- Store app records.

## Requires Assets And Metadata

- App icon.
- Splash screen.
- Screenshots.
- Support URL.
- Privacy Policy URL.
- Terms URL.
- App description and category.
- Account deletion disclosure.
- Data Safety and App Privacy source material.

## Requires Real-Device Testing

- Physical iOS device.
- Physical Android device.
- Push permission flows.
- Media picker/upload flows.
- Reels playback.
- Deep links.
- Accessibility checks.
- Offline/background lifecycle checks.

## Current Gaps

- Native build number/versionCode strategy is absent.
- Icon and splash assets are absent.
- Real store metadata is absent.
- Real device and store review validation are not claimed.
- Push entitlement/provider delivery is not production-ready.

## Node Requirement

Expo SDK 56 validation should run with Node `>=20.19.4`.
