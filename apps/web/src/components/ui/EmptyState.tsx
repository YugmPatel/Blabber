import type { ReactNode } from 'react';
import BlabberMark from '@/components/brand/BlabberMark';

interface EmptyStateProps {
  heading: string;
  body?: string;
  action?: ReactNode;
  /** Pass a custom icon/illustration; defaults to the Blabber mark. */
  icon?: ReactNode;
  className?: string;
}

/** Standard empty-state layout: brand mark, heading, short body copy, optional action — no fabricated content. */
export default function EmptyState({ heading, body, action, icon, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex h-full flex-col items-center justify-center px-6 py-12 text-center ${className}`.trim()}>
      <div className="mx-auto mb-6">{icon ?? <BlabberMark size={64} variant="tile" />}</div>
      <h3 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{heading}</h3>
      {body && <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
