# Accessibility QA

Release G Batch 1 accessibility QA is static and component-contract based. No screen-reader software, physical device, emulator, browser automation, or formal WCAG certification tooling is configured in this repository, so those claims are intentionally not made.

## Checks Performed

- Web protected-route loading state exposes `role="status"`, `aria-live="polite"`, and `aria-busy="true"`.
- Web private routes remain guarded by `ProtectedRoute`.
- Newly added web product pages are statically checked for loading/error/empty/unavailable state text.
- Mobile shared primitives expose `accessibilityRole="button"` and `accessibilityLabel`.
- Mobile `LoadingState`, `EmptyState`, and `ErrorState` provide visible and accessibility-role based state cues.
- Mobile screens use native React Native controls rather than WebView wrappers.
- Deep-link and notification-target parsers reject token-like and unsafe route parameters.
- Static checks guard against private content being embedded in unauthorized state labels or persisted storage.

## Fixes

- Product accessibility fix: `apps/web/src/components/ProtectedRoute.tsx` now marks auth-restoration loading as a polite status region and hides the decorative spinner from assistive technologies.

## Limitations

- No VoiceOver or TalkBack test was run.
- No browser keyboard traversal or focus-order automation was run.
- No color-contrast analyzer was run.
- No responsive screenshot or visual rendering test was run.

These limitations are tracked as launch-readiness boundaries, not as passed tests.
