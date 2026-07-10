import type { ReactNode } from 'react';

interface GlowBorderProps {
  /** Only active/selected/premium states get the luminous border — keep this rare. */
  active?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Wraps content with a thin cyan-violet-pink border + soft glow, reserved for
 * hierarchy-signaling states (active nav, selected card, focused premium
 * action). Renders a plain neutral border when inactive so glow never becomes
 * the default look of ordinary UI.
 */
export default function GlowBorder({ active = false, className = '', children }: GlowBorderProps) {
  return (
    <div
      className={`rounded-2xl border transition-colors ${
        active ? 'border-transparent' : 'border-slate-200 dark:border-slate-700'
      } ${className}`.trim()}
      style={
        active
          ? {
              borderImage: 'linear-gradient(135deg, var(--blabber-cyan), var(--blabber-violet), var(--blabber-pink)) 1',
              borderWidth: 1,
              borderStyle: 'solid',
              boxShadow: 'var(--blabber-glow-violet)',
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
