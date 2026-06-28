import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { canJumpToSource } from '@/lib/source-jump';
import type { SourceReference } from '@repo/types';

interface SourceEvidenceProps {
  sources?: SourceReference[];
  fallbackText?: string;
  compact?: boolean;
  collapsedInitially?: boolean;
  onJump?: (source: SourceReference) => void;
}

function formatSourceTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function SourceEvidence({
  sources,
  fallbackText = 'Source unavailable',
  compact = false,
  collapsedInitially = false,
  onJump,
}: SourceEvidenceProps) {
  const [expanded, setExpanded] = useState(false);
  const safeSources = Array.isArray(sources) ? sources.filter(Boolean) : [];

  if (safeSources.length === 0) {
    return <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">{fallbackText}</p>;
  }

  const collapsedCount = compact ? 1 : 2;
  const visibleSources = collapsedInitially && !expanded
    ? []
    : expanded
      ? safeSources
      : safeSources.slice(0, collapsedCount);

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
        {safeSources.length > 1 ? 'Supporting Messages' : 'Source'}
      </p>
      {visibleSources.map((source) => {
        const canJump = canJumpToSource(source);
        return (
          <div
            key={source.messageId}
            className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  {source.senderDisplayName}
                  <span className="font-normal text-slate-400 dark:text-slate-500">
                    {' '}· {formatSourceTime(source.createdAt)}
                  </span>
                </p>
                {(!compact || expanded) && (
                  <p className="mt-1 max-h-10 overflow-hidden text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    “{source.snippet}”
                  </p>
                )}
              </div>
              {canJump && (
                <button
                  type="button"
                  onClick={() => onJump?.(source)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-teal-700 transition hover:bg-teal-50 dark:border-slate-700 dark:bg-slate-900 dark:text-teal-300 dark:hover:bg-slate-800"
                >
                  <ExternalLink size={11} />
                  Jump
                </button>
              )}
            </div>
          </div>
        );
      })}
      {(collapsedInitially || safeSources.length > collapsedCount) && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="rounded-md px-1 py-0.5 text-left text-[11px] font-semibold text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-slate-800"
        >
          {expanded
            ? 'Hide supporting messages'
            : collapsedInitially
              ? `Sources (${safeSources.length})`
              : `View ${safeSources.length - collapsedCount} more supporting message${safeSources.length - collapsedCount === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}
