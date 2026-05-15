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
  const unreadCount = summary?.sourceMessageIds?.length ?? 0;
  const estimatedRead = summary ? Math.max(1, Math.ceil(unreadCount / 18)) : 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#0f766e]">Intelligence</p>
            <h2 className="text-sm font-semibold text-slate-900">Catch-Me-Up</h2>
            <p className="text-xs text-slate-500">Updated from chat context</p>
          </div>
          <button
            type="button"
            onClick={onCatchMeUp}
            disabled={isGenerating}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? 'Summarizing...' : 'Catch Me Up'}
          </button>
        </div>

      {summary && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Unread Messages</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{unreadCount}</p>
            <p className="text-xs text-[#0f766e]">AI summarized</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Estimated Read</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{estimatedRead}s</p>
            <p className="text-xs text-slate-500">vs manual</p>
          </div>
        </div>
      )}

      {isLoading && <p className="mt-3 text-sm text-slate-500">Loading latest summary...</p>}

      {!isLoading && !summary && !errorMessage && (
        <p className="mt-3 text-sm text-slate-500">No summary yet. Click Catch Me Up to generate one.</p>
      )}

      {errorMessage && <p className="mt-3 text-sm text-red-600">{errorMessage}</p>}

      {summary && (
        <>
          <ChatSummaryPanel summary={summary} />
          <p className="mt-3 text-xs text-slate-400 italic">
            *Noise Skipped: {(summary.noise || []).length} filler messages ignored
          </p>
        </>
      )}
    </section>
  );
}