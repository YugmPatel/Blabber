# Blabber brand assets

`BlabberMark` (`src/components/brand/BlabberMark.tsx`) automatically prefers a
real exported asset over its built-in SVG glyph. Drop transparent WebP files
here with these exact names and every `icon` / `tile` / `lockup` usage across
the app switches over instantly — no code changes needed.

| File | Used by | Suggested size |
|---|---|---|
| `blabber-icon-light.webp` | `variant="tile"`, light mode | 256×256, transparent |
| `blabber-icon-dark.webp` | `variant="tile"`, dark mode | 256×256, transparent |
| `blabber-lockup-light.webp` | `variant="lockup"`, light mode (icon only — the "Blabber" text stays a real HTML wordmark, not baked into the image) | 256×256, transparent |
| `blabber-lockup-dark.webp` | `variant="lockup"`, dark mode | 256×256, transparent |

Loading is glyph-first: the SVG mascot renders immediately and the asset only
swaps in after it has fully loaded, so a missing/slow/failed file can never
flash a placeholder or broken-image box. Bare `variant="icon"` surfaces
(empty states, loading screen, Moments hero) always use the SVG glyph and
never probe for assets.

Export requirements for a clean result:
- **Transparent background** — no baked-in card/tile/vignette. `BlabberMark`
  supplies its own tile background, glow, and rounding.
- **Cropped tight to the mascot silhouette**, not the full specimen-sheet
  composition (no "PRIMARY LOGO" labels, trait chips, or sparkle decorations
  baked in).
- Roughly square, mascot centered, some breathing room on all sides.
