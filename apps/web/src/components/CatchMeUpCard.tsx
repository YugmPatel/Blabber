import { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import type { ChatIntelligenceSummary } from '@repo/types';
import ChatSummaryPanel from './ChatSummaryPanel';

interface CatchMeUpCardProps {
  summary: ChatIntelligenceSummary | null;
  isLoading: boolean;
  isGenerating: boolean;
  errorMessage?: string;
  onCatchMeUp: () => void;
}

export default function CatchMeUpCard({
  summary,
  isLoading,
  isGenerating,
  errorMessage,
  onCatchMeUp,
}: CatchMeUpCardProps) {
  const [expanded, setExpanded] = useState(false);
  const unreadCount = summary?.sourceMessageIds?.length ?? 0;

  return (
    <section className="border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Compact header row — always visible */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Sparkles size={14} className="flex-shrink-0 text-teal-500" />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-teal-600 dark:text-teal-400">
            Catch-Me-Up
          </span>
          {summary && !expanded && (
            <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
              {unreadCount} messages summarised
            </span>
          )}
          {!summary && !isLoading && !errorMessage && (
            <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
              No summary yet
            </span>
          )}
          {isLoading && (
            <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">Loading…</span>
          )}
          {errorMessage && (
            <span className="ml-2 text-xs text-rose-500">{errorMessage}</span>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onCatchMeUp}
            disabled={isGenerating}
            className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            {isGenerating ? 'Summarising…' : 'Catch Me Up'}
          </button>

          {summary && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Collapse summary' : 'Expand summary'}
              className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Expandable summary body */}
      {expanded && summary && (
        <div className="border-t border-slate-100 px-4 pb-3 pt-2 dark:border-slate-800">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
                Messages
              </p>
              <p className="mt-0.5 text-xl font-semibold text-slate-900 dark:text-white">
                {unreadCount}
              </p>
              <p className="text-[10px] text-teal-600 dark:text-teal-400">AI summarised</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
                Est. Read
              </p>
              <p className="mt-0.5 text-xl font-semibold text-slate-900 dark:text-white">
                {Math.max(1, Math.ceil(unreadCount / 18))}s
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">vs manual</p>
            </div>
          </div>
          <ChatSummaryPanel summary={summary} />
          <p className="mt-2 text-[10px] italic text-slate-400 dark:text-slate-500">
            *Noise skipped: {(summary.noise || []).length} filler messages ignored
          </p>
        </div>
      )}
    </section>
  );
}
