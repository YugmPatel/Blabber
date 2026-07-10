import { useId } from 'react';

interface VeyraMarkProps {
  size?: number;
  /** Plays a very slow, reduced-motion-safe glow pulse. Purely decorative. */
  alive?: boolean;
  className?: string;
}

/**
 * Original VEYRA mark: a faceted diamond housing a waveform-through-orb
 * silhouette — deliberately more angular/spatial than the rounded Blabber
 * mark, so the ambient-AI identity reads as distinct at a glance.
 */
export default function VeyraMark({ size = 28, alive = true, className = '' }: VeyraMarkProps) {
  const gradientId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="VEYRA"
      className={`${alive ? 'brand-mark-alive' : ''} ${className}`.trim()}
    >
      <defs>
        <linearGradient id={`${gradientId}-facet`} x1="2" y1="20" x2="38" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2ac8bd" />
          <stop offset="50%" stopColor="#8eebdd" />
          <stop offset="100%" stopColor="#13c8b1" />
        </linearGradient>
        <radialGradient id={`${gradientId}-core`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#05100f" />
          <stop offset="100%" stopColor="#0d2624" />
        </radialGradient>
      </defs>

      {/* Faceted diamond shell */}
      <path
        d="M20 2 L34 20 L20 38 L6 20 Z"
        fill="none"
        stroke={`url(#${gradientId}-facet)`}
        strokeWidth="2.1"
        strokeLinejoin="round"
      />

      {/* Inner orb */}
      <circle cx="20" cy="20" r="9.4" fill={`url(#${gradientId}-core)`} stroke={`url(#${gradientId}-facet)`} strokeWidth="1.1" />

      {/* Waveform through the orb */}
      <path
        d="M12.5 20h3.2l1.6-5.4 2.3 10.8 2.1-7.4 1.5 2h4.3"
        fill="none"
        stroke={`url(#${gradientId}-facet)`}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
