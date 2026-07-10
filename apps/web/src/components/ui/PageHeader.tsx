import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

/** Standard page-level heading row (title + optional subtitle + trailing actions), used at the top of a page's main column. */
export default function PageHeader({ title, subtitle, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`.trim()}>
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-[color:var(--bl-text)]">{title}</h1>
        {subtitle && <p className="mt-2 text-[15px] leading-6 text-[color:var(--bl-text-secondary)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
