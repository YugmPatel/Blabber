interface BrandGlowProps {
  /** `subtle` for a light shell accent, `hero` for the full VEYRA backdrop. */
  variant?: 'subtle' | 'hero';
  className?: string;
}

/**
 * Purely decorative ambient background lighting built from layered blurred
 * gradients — no images, no WebGL/canvas. Always `aria-hidden`.
 */
export default function BrandGlow({ variant = 'subtle', className = '' }: BrandGlowProps) {
  const hero = variant === 'hero';
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`.trim()}
    >
      <div
        className={`absolute -left-[10%] -top-[15%] h-[55%] w-[55%] rounded-full bg-teal-400/20 blur-3xl dark:bg-teal-400/25 ${hero ? 'brand-mark-alive' : ''}`}
      />
      <div className="absolute right-[-12%] top-[5%] h-[60%] w-[45%] rounded-full bg-teal-300/15 blur-3xl dark:bg-teal-300/20" />
      <div className="absolute bottom-[-15%] left-[20%] h-[45%] w-[50%] rounded-full bg-emerald-300/10 blur-3xl dark:bg-emerald-300/15" />
    </div>
  );
}
