import { useId, useState } from 'react';
import { useTheme } from '@/hooks/useTheme';

export type BlabberMarkVariant = 'icon' | 'tile' | 'lockup' | 'wordmark' | 'monochrome';
export type BlabberMarkSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type BlabberMarkMode = 'light' | 'dark' | 'auto';

const SIZE_PX: Record<BlabberMarkSize, number> = {
  xs: 20,
  sm: 28,
  md: 36,
  lg: 56,
  xl: 96,
};

interface BlabberMarkProps {
  /** A pixel number for exact control, or a named token (xs–xl). */
  size?: number | BlabberMarkSize;
  variant?: BlabberMarkVariant;
  /** Forces light/dark tile + wordmark colors regardless of the app's `.dark` class. Defaults to following it ("auto"). */
  mode?: BlabberMarkMode;
  /** Plays a gentle float + glow-pulse loop on the wrapper (reduced-motion-safe). Purely decorative. */
  alive?: boolean;
  className?: string;
}

// A near-spherical bubble: full circle body + a soft curled tail flick at the
// lower left, drawn as a second path filled with the SAME userSpaceOnUse
// gradient so the two read as one continuous jelly form.
const BALL_PATH =
  'M20 4C27.73 4 34 10.27 34 18C34 25.73 27.73 32 20 32C12.27 32 6 25.73 6 18C6 10.27 12.27 4 20 4Z';
const TAIL_PATH =
  'M13.6 30.4C12 33.2 10 35.2 6.9 36.4C8.7 32.9 9.1 29.8 8.6 26.4C9.9 28.3 11.6 29.7 13.6 30.4Z';

function sparklePath(cx: number, cy: number, s: number) {
  const k = s * 0.26;
  return `M${cx} ${cy - s} L${cx + k} ${cy - k} L${cx + s} ${cy} L${cx + k} ${cy + k} L${cx} ${cy + s} L${cx - k} ${cy + k} L${cx - s} ${cy} L${cx - k} ${cy - k} Z`;
}

/**
 * Blabber brand mascot: a glossy 3D mint jelly-bubble companion. Volume is
 * built from four stacked light passes — a userSpaceOnUse radial body
 * gradient (lit top-left, deepening to sea-teal at the edges), a bright
 * subsurface "backlight" crescent along the bottom rim, a broad soft sheen
 * across the upper dome, and a crisp glass-bead specular — plus a floating
 * soft shadow and tiny star sparkles at hero sizes. Rendered at full, stable
 * opacity always; this glyph is also the fallback when no production asset
 * exists (see `AssetOrGlyph`), so it must never look faded on its own.
 */
function BlabberGlyph({ monochrome, rich = false }: { monochrome: boolean; rich?: boolean }) {
  const id = useId();
  if (monochrome) {
    return (
      <svg width="100%" height="100%" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Blabber">
        <path d={TAIL_PATH} fill="#f4f5ff" />
        <path d={BALL_PATH} fill="#f4f5ff" />
        <ellipse cx="15.2" cy="16.9" rx="2.85" ry="3.45" fill="#0b0e24" />
        <ellipse cx="24.8" cy="16.9" rx="2.85" ry="3.45" fill="#0b0e24" />
        <path d="M17.4 21.9C18.15 24.35 21.85 24.35 22.6 21.9C21.1 22.95 18.9 22.95 17.4 21.9Z" fill="#0b0e24" opacity="0.88" />
      </svg>
    );
  }
  return (
    <svg width="100%" height="100%" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Blabber">
      <defs>
        <clipPath id={`${id}-clip`}>
          <path d={BALL_PATH} />
          <path d={TAIL_PATH} />
        </clipPath>
        {/* Shared body light: one absolute-coordinate gradient across ball AND
            tail so the flick shades continuously with the sphere. */}
        <radialGradient id={`${id}-body`} gradientUnits="userSpaceOnUse" cx="15.5" cy="10.5" r="27">
          <stop offset="0%" stopColor="#f6fffd" />
          <stop offset="18%" stopColor="#aaf6ea" />
          <stop offset="42%" stopColor="#4fe3d0" />
          <stop offset="68%" stopColor="#16bfaa" />
          <stop offset="100%" stopColor="#067a6c" />
        </radialGradient>
        {/* Subsurface backlight: bright aqua bleeding up through the bottom
            rim — the "lit jelly" signature of the reference. */}
        <radialGradient id={`${id}-crescent`}>
          <stop offset="0%" stopColor="#c2fff4" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#7cf0de" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#7cf0de" stopOpacity="0" />
        </radialGradient>
        {/* Broad soft sheen over the upper dome. */}
        <radialGradient id={`${id}-sheen`}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-blur`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="0.9" />
        </filter>
      </defs>

      {/* Floating contact shadow — grounds the mascot at hero sizes. */}
      {rich && <ellipse cx="19" cy="38.3" rx="8.8" ry="1.5" fill="#0f9887" opacity="0.35" filter={`url(#${id}-blur)`} />}

      <path d={TAIL_PATH} fill={`url(#${id}-body)`} />
      <path d={BALL_PATH} fill={`url(#${id}-body)`} />

      <g clipPath={`url(#${id}-clip)`}>
        <ellipse cx="20" cy="33.8" rx="12.5" ry="6.2" fill={`url(#${id}-crescent)`} />
        <ellipse cx="13.8" cy="10" rx="6.8" ry="4.6" fill={`url(#${id}-sheen)`} transform="rotate(-22 13.8 10)" />
        {/* Crisp glass-bead speculars. */}
        <ellipse cx="12.6" cy="8.6" rx="2.5" ry="1.5" fill="#ffffff" opacity="0.95" transform="rotate(-24 12.6 8.6)" />
        <circle cx="26.8" cy="7.8" r="1" fill="#ffffff" opacity="0.8" />
        {/* Faint cheek glow. */}
        <ellipse cx="12.4" cy="20.6" rx="1.9" ry="1.2" fill="#ffffff" opacity="0.16" />
        <ellipse cx="27.6" cy="20.6" rx="1.9" ry="1.2" fill="#ffffff" opacity="0.16" />
      </g>

      {/* Eyes: big, round, glossy — the baby-like focal point. */}
      <ellipse cx="15.2" cy="16.9" rx="2.85" ry="3.45" fill="#0a1322" />
      <ellipse cx="24.8" cy="16.9" rx="2.85" ry="3.45" fill="#0a1322" />
      <circle cx="16.25" cy="15.35" r="1.05" fill="#ffffff" opacity="0.97" />
      <circle cx="25.85" cy="15.35" r="1.05" fill="#ffffff" opacity="0.97" />
      <circle cx="14.35" cy="18.3" r="0.45" fill="#ffffff" opacity="0.55" />
      <circle cx="23.95" cy="18.3" r="0.45" fill="#ffffff" opacity="0.55" />

      {/* Tiny open smile. */}
      <path d="M17.4 21.9C18.15 24.35 21.85 24.35 22.6 21.9C21.1 22.95 18.9 22.95 17.4 21.9Z" fill="#0a1322" opacity="0.88" />

      {/* Star sparkles — hero sizes only, kept clear of the face. */}
      {rich && (
        <g fill="#bdfef2">
          <path d={sparklePath(36.3, 8.6, 1.7)} opacity="0.9" />
          <path d={sparklePath(3.9, 12.5, 1.15)} opacity="0.7" />
          <path d={sparklePath(34.6, 29.5, 0.95)} opacity="0.6" />
        </g>
      )}
    </svg>
  );
}

/**
 * Prefers a real production asset (public/brand/*.webp) when one exists;
 * silently falls back to the SVG glyph on load failure so nothing breaks
 * today. Drop matching files in apps/web/public/brand/ (see the README
 * there) to switch a surface over to a real exported mascot with zero code
 * changes.
 */
function AssetOrGlyph({
  lightSrc,
  darkSrc,
  mode,
  monochrome,
  rich = false,
}: {
  lightSrc: string;
  darkSrc: string;
  mode: BlabberMarkMode;
  monochrome: boolean;
  rich?: boolean;
}) {
  // Glyph-first strategy: the SVG glyph renders immediately and stays until a
  // production asset has ACTUALLY finished loading, then the image swaps in.
  // A missing, slow, or failed asset can therefore never paint a pending or
  // broken-image box — not on mount, and not while the theme is toggling.
  const [lightLoaded, setLightLoaded] = useState(false);
  const [darkLoaded, setDarkLoaded] = useState(false);
  const [lightDead, setLightDead] = useState(false);
  const [darkDead, setDarkDead] = useState(false);

  if (monochrome) return <BlabberGlyph monochrome />;

  const cell = (
    src: string,
    loaded: boolean,
    dead: boolean,
    onLoaded: () => void,
    onDead: () => void,
    visibilityClass: string
  ) => (
    <div className={`relative h-full w-full ${visibilityClass}`.trim()}>
      {!loaded && <BlabberGlyph monochrome={false} rich={rich} />}
      {!dead && (
        <img
          src={src}
          alt="Blabber"
          className={`absolute inset-0 h-full w-full object-contain ${loaded ? '' : 'opacity-0'}`.trim()}
          onLoad={onLoaded}
          onError={onDead}
        />
      )}
    </div>
  );

  if (mode === 'auto') {
    return (
      <>
        {cell(lightSrc, lightLoaded, lightDead, () => setLightLoaded(true), () => setLightDead(true), 'dark:hidden')}
        {cell(darkSrc, darkLoaded, darkDead, () => setDarkLoaded(true), () => setDarkDead(true), 'hidden dark:block')}
      </>
    );
  }

  return mode === 'dark'
    ? cell(darkSrc, darkLoaded, darkDead, () => setDarkLoaded(true), () => setDarkDead(true), '')
    : cell(lightSrc, lightLoaded, lightDead, () => setLightLoaded(true), () => setLightDead(true), '');
}

/**
 * Soft circular glow behind the glyph. Implemented as a radial gradient
 * fading to transparent — NOT a blurred solid circle: `filter: blur()`
 * bleeds a box-filling circle's color into the element's square corners,
 * which reads as a faint tile behind the mascot (worst on light surfaces).
 * A gradient's falloff is mathematically circular, so no box can appear.
 * Skipped at tiny sizes.
 */
function GlowHalo({ show, dark }: { show: boolean; dark: boolean }) {
  if (!show) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-[-35%]"
      style={{
        background: `radial-gradient(circle, ${dark ? 'rgba(45, 212, 191, 0.42)' : 'rgba(45, 212, 191, 0.26)'} 0%, rgba(45, 212, 191, 0) 68%)`,
      }}
    />
  );
}

function resolveSize(size: number | BlabberMarkSize): number {
  return typeof size === 'number' ? size : SIZE_PX[size];
}

export default function BlabberMark({ size = 32, variant = 'icon', mode = 'auto', alive = true, className = '' }: BlabberMarkProps) {
  const px = resolveSize(size);
  const monochrome = variant === 'monochrome';
  const tile = variant === 'tile';
  const lockup = variant === 'lockup';
  const wordmarkOnly = variant === 'wordmark';
  const { resolvedTheme } = useTheme();
  const isDarkGlow = mode === 'dark' || (mode === 'auto' && resolvedTheme === 'dark');

  const forcedDark = mode === 'dark';
  const forcedLight = mode === 'light';
  const tileBgClass = forcedDark ? 'bg-[#05201c]' : forcedLight ? 'bg-teal-50' : 'bg-teal-50 dark:bg-[#05201c]';
  const wordmarkClass = forcedDark ? 'text-white' : forcedLight ? 'text-[#10262a]' : 'text-[color:var(--bl-text)]';
  const showHalo = px >= 40;

  if (wordmarkOnly) {
    return (
      <span className={`font-brand whitespace-nowrap leading-none ${wordmarkClass} ${className}`.trim()} style={{ fontSize: px }}>
        Blabber
      </span>
    );
  }

  if (tile) {
    return (
      <div className={`relative inline-flex flex-shrink-0 items-center justify-center ${className}`.trim()} style={{ width: px, height: px }}>
        <GlowHalo show={showHalo} dark={isDarkGlow} />
        <div
          className={`blabber-mascot-tile ${alive ? 'blabber-mascot-animated' : ''} relative inline-flex items-center justify-center rounded-2xl ${tileBgClass}`}
          style={{ width: px, height: px, boxShadow: 'var(--bl-mascot-glow)' }}
        >
          <div style={{ width: Math.round(px * 0.78), height: Math.round(px * 0.78) }}>
            <AssetOrGlyph lightSrc="/brand/blabber-icon-light.webp" darkSrc="/brand/blabber-icon-dark.webp" mode={mode} monochrome={monochrome} />
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'icon') {
    // Hero-sized bare icons get the full treatment: floating shadow + sparkles.
    // Bare icons render the transparent SVG glyph directly — never an asset
    // probe — so no box/tile can ever flash during mount or theme changes.
    const rich = px >= 56;
    return (
      <div className={`relative inline-flex flex-shrink-0 items-center justify-center ${className}`.trim()} style={{ width: px, height: px }}>
        <GlowHalo show={showHalo} dark={isDarkGlow} />
        <div className="relative" style={{ width: px, height: px }}>
          <BlabberGlyph monochrome={monochrome} rich={rich} />
        </div>
      </div>
    );
  }

  if (lockup) {
    const iconSize = Math.round(px * 1.2);
    return (
      <div className={`inline-flex items-center gap-3 ${className}`.trim()}>
        <div className="relative flex flex-shrink-0 items-center justify-center" style={{ width: iconSize, height: iconSize }}>
          <GlowHalo show={true} dark={isDarkGlow} />
          <div className={`blabber-mascot-bare relative ${alive ? 'blabber-mascot-animated' : ''}`} style={{ width: iconSize, height: iconSize }}>
            <AssetOrGlyph lightSrc="/brand/blabber-lockup-light.webp" darkSrc="/brand/blabber-lockup-dark.webp" mode={mode} monochrome={monochrome} />
          </div>
        </div>
        <span className={`font-brand whitespace-nowrap leading-none ${wordmarkClass}`} style={{ fontSize: Math.round(px * 0.78) }}>
          Blabber
        </span>
      </div>
    );
  }

  // monochrome fallback (no dedicated asset — always the flat SVG glyph)
  return (
    <div className={className} style={{ width: px, height: px }}>
      <BlabberGlyph monochrome={monochrome} />
    </div>
  );
}
