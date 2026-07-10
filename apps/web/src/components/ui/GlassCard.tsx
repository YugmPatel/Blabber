import type { HTMLAttributes } from 'react';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  /** `flat` for ordinary list rows, `elevated` for panels/modals/hero cards. */
  elevation?: 'flat' | 'elevated';
}

/**
 * The app's standard card/panel surface. In light mode this stays a plain
 * white card (unchanged look); in dark mode it becomes a layered glass
 * surface using the Blabber ink tokens instead of flat black.
 */
export default function GlassCard({ elevation = 'flat', className = '', children, ...rest }: GlassCardProps) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white dark:border-slate-700 ${
        elevation === 'elevated' ? 'dark:bg-slate-800 dark:shadow-[0_8px_40px_rgba(6,9,22,0.45)]' : 'dark:bg-slate-900'
      } ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
}
