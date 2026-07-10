import type { ReactNode } from 'react';

interface SectionHeadingProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

/** Small heading row used above a card list/section, with an optional trailing action ("See all", filter, ...). */
export default function SectionHeading({ title, subtitle, action, className = '' }: SectionHeadingProps) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`.trim()}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
